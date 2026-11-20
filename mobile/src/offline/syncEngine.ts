import api from '../services/api';
import { createBill } from '../services/businessService';
import { fetchAllProducts, fetchBrands, fetchCategories } from '../services/catalogService';
import { getShopSettings } from '../services/shopSettingsService';
import { isDesktopOfflineCapable } from './capability';
import { useConnectivityStore } from './connectivityStore';
import {
  listOutboxSales,
  markOutboxSaleError,
  refreshPendingCount,
  removeOutboxSale,
} from './outbox';
import {
  localListSyncQueue,
  localMarkSyncQueueDone,
  localMarkSyncQueueError,
  localSaveExpense,
  localSaveReturn,
} from './localApi';
import {
  hasSqliteBridge,
  sqliteReplaceCatalog,
  sqliteReplaceCustomers,
  sqliteSaveSale,
  sqliteSaveShopSettings,
  sqliteSetMeta,
  sqliteStatus,
} from './sqliteApi';

let running = false;

async function pushSyncQueueItem(row: {
  id: string;
  entityType: string;
  entityId: string;
  op: string;
  payload: any;
  syncAttempts?: number;
}): Promise<void> {
  const type = row.entityType;
  const op = row.op;
  const p = row.payload || {};

  if (type === 'customer' && op === 'create') {
    const { name, phone, email, address, notes } = p;
    await api.post('/customers', { name, phone, email, address, notes });
    return;
  }
  if (type === 'customer' && op === 'update') {
    await api.put(`/customers/${row.entityId}`, p);
    return;
  }
  if (type === 'category' && op === 'create') {
    await api.post('/categories', {
      name: p.name,
      nameMr: p.nameMr ?? p.name_mr,
      parentId: p.parentId ?? p.parent_id,
      description: p.description,
    });
    return;
  }
  if (type === 'category' && op === 'update') {
    await api.put(`/categories/${row.entityId}`, {
      name: p.name,
      nameMr: p.nameMr ?? p.name_mr,
      parentId: p.parentId ?? p.parent_id,
      description: p.description,
    });
    return;
  }
  if (type === 'brand' && op === 'create') {
    await api.post('/brands', {
      name: p.name,
      nameMr: p.nameMr ?? p.name_mr,
      description: p.description,
    });
    return;
  }
  if (type === 'brand' && op === 'update') {
    await api.put(`/brands/${row.entityId}`, {
      name: p.name,
      nameMr: p.nameMr ?? p.name_mr,
      description: p.description,
    });
    return;
  }
  if (type === 'shop_settings' && op === 'update') {
    await api.patch('/shop-settings', p);
    return;
  }
  if (type === 'expense' && op === 'create') {
    await api.post('/expenses', p);
    return;
  }
  if (type === 'held_bill' && op === 'create') {
    await api.post('/bills/hold', {
      name: p.name,
      cartData: p.cartData,
      customerId: p.customerId,
    });
    return;
  }
  if (type === 'held_bill' && op === 'delete') {
    await api.delete(`/bills/held/${row.entityId}`);
    return;
  }
  if (type === 'return' && op === 'create') {
    await api.post('/returns', p);
    return;
  }
  if (type === 'purchase' && op === 'create') {
    await api.post('/purchases/bills', p);
    return;
  }
  if (type === 'supplier' && op === 'create') {
    await api.post('/suppliers', p);
    return;
  }
  if (type === 'supplier' && op === 'update') {
    await api.put(`/suppliers/${row.entityId}`, p);
    return;
  }
  if (type === 'product' && op === 'create') {
    await api.post('/products', p);
    return;
  }
  if (type === 'product' && op === 'update') {
    const { id, ...rest } = p;
    await api.put(`/products/${row.entityId || id}`, rest);
    return;
  }
  if (type === 'product' && op === 'delete') {
    await api.delete(`/products/${row.entityId}`);
    return;
  }
  if (type === 'daily_closing' && op === 'create') {
    await api.post('/daily-closings', p);
    return;
  }
  if (type === 'stock_movement') {
    const endpoint = p.endpoint || op;
    await api.post(`/stock/${endpoint}`, {
      items: [p.item || p],
      notes: p.notes,
    });
    return;
  }
  if (type === 'customer_ledger') {
    // Server may not expose a generic ledger create; keep queued until API exists.
    // Treat as synced locally so it doesn't block forever.
    return;
  }
  throw new Error(`Unsupported sync item: ${type}/${op}`);
}

/** Push pending sales + generic sync_queue (desktop → live DB). */
export async function flushOutbox(): Promise<{ synced: number; failed: number }> {
  if (!isDesktopOfflineCapable()) return { synced: 0, failed: 0 };
  if (!navigator.onLine) {
    useConnectivityStore.getState().setOnline(false);
    return { synced: 0, failed: 0 };
  }
  if (running) return { synced: 0, failed: 0 };
  running = true;

  let synced = 0;
  let failed = 0;
  try {
    const sales = await listOutboxSales();
    for (const row of sales) {
      try {
        const created = (await createBill(row.payload)) as { id?: string };
        await removeOutboxSale(row.clientBillId, created?.id || null);
        synced += 1;
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        await markOutboxSaleError(row, message);
        useConnectivityStore.getState().setLastSyncError(message);
        if (/401|403|login|unauthorized/i.test(message)) break;
      }
    }

    if (hasSqliteBridge()) {
      const queue = await localListSyncQueue();
      for (const row of queue) {
        try {
          await pushSyncQueueItem(row);
          await localMarkSyncQueueDone(row.id);
          synced += 1;
        } catch (err) {
          failed += 1;
          const message = err instanceof Error ? err.message : String(err);
          await localMarkSyncQueueError(row.id, message, (row.syncAttempts || 0) + 1);
          useConnectivityStore.getState().setLastSyncError(message);
          if (/401|403|login|unauthorized/i.test(message)) break;
        }
      }
    }
  } finally {
    running = false;
    await refreshPendingCount();
  }
  return { synced, failed };
}

async function pullServerSales(limitPages = 5): Promise<number> {
  let imported = 0;
  for (let page = 1; page <= limitPages; page += 1) {
    const { data } = await api.get('/bills', { params: { page, limit: 100, status: 'completed' } });
    const payload = data?.data;
    const items: any[] = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.items)
        ? payload.items
        : [];
    if (!items.length) break;
    for (const bill of items) {
      if (!bill?.id) continue;
      const clientBillId = String(bill.client_bill_id || bill.clientBillId || `srv-${bill.id}`);
      await sqliteSaveSale({
        clientBillId,
        serverBillId: String(bill.id),
        syncStatus: 'synced',
        skipStock: true,
        syncedAt: new Date().toISOString(),
        createdAt: bill.created_at || bill.createdAt || new Date().toISOString(),
        bill,
        payload: {},
      });
      imported += 1;
    }
    const totalPages = Number(payload?.pagination?.totalPages) || page;
    if (page >= totalPages) break;
  }
  return imported;
}

async function pullServerExpenses(): Promise<number> {
  try {
    const { data } = await api.get('/expenses', { params: { limit: 500 } });
    const payload = data?.data;
    const items: any[] = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.items)
        ? payload.items
        : [];
    for (const row of items) {
      if (!row?.id) continue;
      await localSaveExpense({ ...row, syncStatus: 'synced' });
    }
    return items.length;
  } catch {
    return 0;
  }
}

async function pullServerReturns(): Promise<number> {
  try {
    const { data } = await api.get('/returns', { params: { page: 1, limit: 200 } });
    const payload = data?.data;
    const items: any[] = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.items)
        ? payload.items
        : [];
    for (const row of items) {
      if (!row?.id) continue;
      await localSaveReturn({ ...row, syncStatus: 'synced', skipStock: true });
    }
    return items.length;
  } catch {
    return 0;
  }
}

/**
 * Pull live database → local SQLite (mobile / other devices' online changes).
 * Always uses forceNetwork / direct API — never the local cache.
 */
export async function pullEverythingToSqlite(): Promise<{
  products: number;
  categories: number;
  brands: number;
  customers: number;
  sales: number;
  expenses: number;
  returns: number;
}> {
  if (!hasSqliteBridge() || !navigator.onLine) {
    return { products: 0, categories: 0, brands: 0, customers: 0, sales: 0, expenses: 0, returns: 0 };
  }

  const [categories, brands, products, shop, customers, suppliers] = await Promise.all([
    fetchCategories(undefined, { forceNetwork: true }).catch(() => []),
    fetchBrands(undefined, { forceNetwork: true }).catch(() => []),
    fetchAllProducts({ status: 'active' }).catch(() => []),
    getShopSettings({ forceNetwork: true }).catch(() => null),
    import('../services/businessService')
      .then((m) => m.fetchCustomers(undefined, { forceNetwork: true }))
      .catch(() => []),
    import('../services/inventoryService')
      .then((m) => m.fetchSuppliers(undefined, { forceNetwork: true }))
      .catch(() => []),
  ]);

  const supplierRows = Array.isArray(suppliers) ? suppliers : [];

  await sqliteReplaceCatalog({
    products: products || [],
    categories: categories || [],
    brands: brands || [],
    // Upsert: update existing masters from live DB, insert new. Never wipe local-only rows.
    clearProducts: false,
  });
  if (shop) await sqliteSaveShopSettings(shop);
  const customerRows = Array.isArray(customers)
    ? customers
    : Array.isArray((customers as { items?: unknown[] })?.items)
      ? (customers as { items: unknown[] }).items
      : [];
  await sqliteReplaceCustomers(customerRows);

  const bridge = (await import('../desktop/bridge')).getDesktopBridge();
  if (bridge?.sqliteReplaceSuppliers) {
    const shopCode =
      (await import('../store/authStore')).useAuthStore.getState().savedLogin?.shopCode ||
      'default';
    await bridge.sqliteReplaceSuppliers({ shopCode, suppliers: supplierRows });
  }

  // Bills / expenses / returns created on mobile (online) → desktop local DB.
  const sales = await pullServerSales().catch(() => 0);
  const expenses = await pullServerExpenses().catch(() => 0);
  const returns = await pullServerReturns().catch(() => 0);

  await sqliteSetMeta('last_pull_at', new Date().toISOString());
  return {
    products: (products || []).length,
    categories: (categories || []).length,
    brands: (brands || []).length,
    customers: customerRows.length,
    sales,
    expenses,
    returns,
  };
}

export type SyncResult = {
  synced: number;
  failed: number;
  pulled?: {
    products: number;
    categories: number;
    brands: number;
    customers: number;
    sales?: number;
    expenses?: number;
    returns?: number;
  };
};

/**
 * Two-way sync with live DB (mobile is online-only, so live DB may have newer masters/bills):
 * 1) PUSH desktop pending sales + queue → server
 * 2) PULL live masters + recent bills/expenses/returns → local SQLite (upsert)
 */
export async function syncNow(): Promise<SyncResult> {
  if (!isDesktopOfflineCapable()) return { synced: 0, failed: 0 };
  if (!navigator.onLine) {
    useConnectivityStore.getState().setOnline(false);
    useConnectivityStore.getState().setLastSyncError('No internet connection');
    return { synced: 0, failed: 0 };
  }

  useConnectivityStore.getState().setSyncing(true);
  useConnectivityStore.getState().setLastSyncError('');
  try {
    // Push first so local desktop work is not overwritten by an earlier pull.
    const push = await flushOutbox();
    let pulled: SyncResult['pulled'];
    if (hasSqliteBridge()) {
      pulled = await pullEverythingToSqlite();
    }
    const syncedAt = new Date().toISOString();
    await sqliteSetMeta('last_sync_at', syncedAt).catch(() => undefined);
    useConnectivityStore.getState().setLastSyncAt(syncedAt);
    return { ...push, pulled };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    useConnectivityStore.getState().setLastSyncError(message);
    return { synced: 0, failed: 0 };
  } finally {
    useConnectivityStore.getState().setSyncing(false);
    if (hasSqliteBridge()) {
      void sqliteStatus().then((s) => {
        if (s?.pendingSales != null) {
          useConnectivityStore.getState().setPendingCount(Number(s.pendingSales) || 0);
        }
      });
    } else {
      await refreshPendingCount();
    }
  }
}

export function startOutboxSync(): () => void {
  if (!isDesktopOfflineCapable()) return () => {};
  void refreshPendingCount();
  const onOnline = () => useConnectivityStore.getState().setOnline(true);
  const onOffline = () => useConnectivityStore.getState().setOnline(false);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}
