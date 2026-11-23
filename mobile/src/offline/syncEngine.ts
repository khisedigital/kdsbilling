import api from '../services/api';
import { createBill } from '../services/businessService';
import { fetchAllProducts, fetchBrands, fetchCategories } from '../services/catalogService';
import { getShopSettings } from '../services/shopSettingsService';
import { apiError } from '../utils/apiError';
import { isDesktopOfflineCapable } from './capability';
import { registerAutoSyncRunner, triggerAutoSync, useConnectivityStore } from './connectivityStore';
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
  localSaveDailyClosing,
  localSaveExpense,
  localSaveReturn,
} from './localApi';
import {
  hasSqliteBridge,
  sqliteReplaceCatalogBatched,
  sqliteReplaceCustomers,
  sqliteSaveSale,
  sqliteSaveShopSettings,
  sqliteSetMeta,
  sqliteStatus,
} from './sqliteApi';

let running = false;

function errStatus(err: unknown): number {
  return Number((err as { response?: { status?: number } })?.response?.status) || 0;
}

function errCode(err: unknown): string {
  return String(
    (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code
      || '',
  );
}

function errMessage(err: unknown): string {
  return String(
    (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      || (err instanceof Error ? err.message : err)
      || '',
  );
}

function isNotFoundErr(err: unknown): boolean {
  const status = errStatus(err);
  const code = errCode(err);
  const message = errMessage(err);
  return (
    status === 404
    || code === 'NOT_FOUND'
    || /variant not found/i.test(message)
    || /product not found/i.test(message)
    || /product variant not found/i.test(message)
  );
}

function isBarcodeConflictErr(err: unknown): boolean {
  const status = errStatus(err);
  const code = errCode(err);
  const message = errMessage(err);
  return (
    status === 409
    || code === 'BARCODE_TAKEN'
    || code === 'DUPLICATE_ENTRY'
    || /barcode .* already used/i.test(message)
    || /listed twice/i.test(message)
    || /duplicate barcode/i.test(message)
  );
}

function stripBarcodesFromProductPayload(payload: any): any {
  if (!payload || typeof payload !== 'object') return payload;
  const next = { ...payload };
  delete next.barcode;
  delete next.barcodes;
  delete next.quantityBarcodes;
  if (Array.isArray(next.variants)) {
    next.variants = next.variants.map((v: any) => {
      if (!v || typeof v !== 'object') return v;
      const copy = { ...v };
      delete copy.barcode;
      delete copy.barcodes;
      delete copy.quantityBarcodes;
      return copy;
    });
  }
  return next;
}

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
  if (type === 'customer' && op === 'delete') {
    try {
      await api.delete(`/customers/${row.entityId}`);
    } catch (err) {
      if (isNotFoundErr(err)) return;
      throw err;
    }
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
  if (type === 'category' && op === 'delete') {
    try {
      await api.delete(`/categories/${row.entityId}`);
    } catch (err) {
      if (isNotFoundErr(err)) return;
      throw err;
    }
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
  if (type === 'brand' && op === 'delete') {
    try {
      await api.delete(`/brands/${row.entityId}`);
    } catch (err) {
      if (isNotFoundErr(err)) return;
      throw err;
    }
    return;
  }
  if (type === 'profile' && op === 'update') {
    await api.patch('/auth/profile', {
      name: p.name,
      phone: p.phone,
    });
    return;
  }
  if (type === 'shop_settings' && op === 'update') {
    await api.patch('/shop-settings', p);
    return;
  }
  if (type === 'expense' && op === 'create') {
    await api.post('/expenses', {
      categoryId: p.categoryId || p.category_id,
      amount: p.amount,
      notes: p.notes || p.note,
      expenseDate: p.expenseDate || p.expense_date,
      paymentMode: p.paymentMode || p.payment_mode || 'cash',
    });
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
  if (type === 'supplier' && op === 'delete') {
    try {
      await api.delete(`/suppliers/${row.entityId}`);
    } catch (err) {
      if (isNotFoundErr(err)) return;
      throw err;
    }
    return;
  }
  if (type === 'product' && op === 'create') {
    try {
      let payloadToSend = p;
      if (row.entityId && hasSqliteBridge()) {
        try {
          const { sqliteGetProduct } = await import('./sqliteApi');
          const localProd = (await sqliteGetProduct(row.entityId)) as any;
          if (localProd) {
            payloadToSend = {
              ...p,
              name: localProd.name || p.name,
              nameMr: localProd.nameMr ?? localProd.name_mr ?? p.nameMr,
              categoryId: localProd.categoryId ?? localProd.category_id ?? p.categoryId,
              brandId: localProd.brandId ?? localProd.brand_id ?? p.brandId,
              variants: Array.isArray(localProd.variants) && localProd.variants.length
                ? localProd.variants.map((lv: any) => ({
                    sku: lv.sku || '',
                    barcode: lv.barcode || (Array.isArray(lv.barcodes) ? (lv.barcodes[0]?.barcode || lv.barcodes[0]) : null),
                    barcodes: lv.barcodes || [],
                    quantityBarcodes: lv.quantityBarcodes || [],
                    sellingPrice: lv.sellingPrice ?? lv.selling_price ?? 0,
                    costPrice: lv.costPrice ?? lv.cost_price ?? 0,
                    mrp: lv.mrp != null ? lv.mrp : undefined,
                    stockQty: lv.stockQty ?? lv.stock_qty ?? 0,
                    size: lv.size || null,
                    color: lv.color || null,
                  }))
                : p.variants,
            };
          }
        } catch {}
      }

      const { data } = await api.post('/products', payloadToSend);
      const created = data?.data;
      // Server always assigns its own id. Drop the desktop-only row so Labels
      // searches the same product the phone already shows.
      if (created?.id && row.entityId && String(created.id) !== String(row.entityId)) {
        const { localDeleteProduct, localUpsertProduct } = await import('./localApi');
        await localUpsertProduct(created);
        await localDeleteProduct(String(row.entityId));
      }
      return;
    } catch (err) {
      // Already on live (mobile/other PC created the same product + pack barcodes).
      // Do not create a second product without barcodes — clear the queue item.
      if (isBarcodeConflictErr(err)) return;
      throw err;
    }
  }
  if (type === 'product' && op === 'update') {
    const { id, ...rest } = p;
    const targetId = row.entityId || id;
    try {
      await api.put(`/products/${targetId}`, rest);
      return;
    } catch (err) {
      if (isNotFoundErr(err)) return;
      if (isBarcodeConflictErr(err)) {
        await api.put(`/products/${targetId}`, stripBarcodesFromProductPayload(rest));
        return;
      }
      throw err;
    }
  }
  if (type === 'product' && op === 'delete') {
    try {
      await api.delete(`/products/${row.entityId}`);
    } catch (err) {
      if (isNotFoundErr(err)) return;
      throw err;
    }
    return;
  }
  if (type === 'product' && op === 'favorite') {
    try {
      await api.put(`/products/${row.entityId}/favorite`, { isFavorite: p.isFavorite });
    } catch (err) {
      if (isNotFoundErr(err)) return;
      throw err;
    }
    return;
  }
  if (type === 'product_favorites_bulk') {
    try {
      await api.post('/products/favorites/bulk', {
        categoryId: p.categoryId,
        brandId: p.brandId || undefined,
        isFavorite: p.isFavorite,
      });
    } catch (err) {
      if (isNotFoundErr(err)) return;
      throw err;
    }
    return;
  }
  if (type === 'price_bulk' && op === 'update') {
    const items = Array.isArray((p as any).items) ? (p as any).items : [];
    if (!items.length) return;
    try {
      await api.post('/products/price-bulk', { items });
      return;
    } catch (err) {
      // Older servers / partial failures: apply row-by-row and skip stale local variant ids.
      if (!isNotFoundErr(err) && !isBarcodeConflictErr(err) && errStatus(err) !== 400) {
        throw err;
      }
      let anyOk = false;
      let lastErr: unknown = err;
      for (const item of items) {
        try {
          await api.post('/products/price-bulk', { items: [item] });
          anyOk = true;
        } catch (rowErr) {
          lastErr = rowErr;
          if (isNotFoundErr(rowErr)) continue;
          if (isBarcodeConflictErr(rowErr)) {
            const { barcode, barcodes, ...rest } = item || {};
            try {
              await api.post('/products/price-bulk', { items: [rest] });
              anyOk = true;
            } catch (rowErr2) {
              if (isNotFoundErr(rowErr2) || isBarcodeConflictErr(rowErr2)) continue;
              throw rowErr2;
            }
            continue;
          }
          // Keep going — one bad row must not block the rest of sync.
          console.warn('[KDSPOZ] price_bulk row failed:', errMessage(rowErr));
        }
      }
      if (!anyOk && lastErr && !isNotFoundErr(lastErr) && !isBarcodeConflictErr(lastErr)) {
        throw lastErr;
      }
      return;
    }
  }
  if (type === 'daily_closing') {
    const closingDate = String(
      p.closingDate ||
      p.closing_date ||
      (row.entityId && /^\d{4}-\d{2}-\d{2}$/.test(row.entityId)
        ? row.entityId
        : new Date().toISOString().slice(0, 10))
    );
    const payload = { ...p, closingDate };
    const errStatus = (err: any) => Number(err?.response?.status) || 0;
    const errCode = (err: any) => String(err?.response?.data?.error?.code || '');
    const errMessage = (err: any) => String(err?.response?.data?.error?.message || err?.message || '');
    const isAlreadyClosed = (err: any) => {
      const status = errStatus(err);
      const code = errCode(err);
      const message = errMessage(err);
      return (
        status === 409
        || code === 'DUPLICATE'
        || code === 'DUPLICATE_ENTRY'
        || /already closed/i.test(message)
        || /closing already done/i.test(message)
      );
    };
    const isMissingClosing = (err: any) => {
      const status = errStatus(err);
      const message = errMessage(err);
      return status === 404 || /closing not found/i.test(message);
    };
    const isPastClosingLocked = (err: any) => /only today's register/i.test(errMessage(err));

    /** Live API often only accepts the server UUID — resolve by closing_date. */
    const findServerClosingId = async (): Promise<string | null> => {
      try {
        const { data } = await api.get('/daily-closings');
        const items = Array.isArray(data?.data) ? data.data : [];
        const hit = items.find((c: any) => {
          const date = String(c?.closing_date || c?.closingDate || '');
          return date === closingDate;
        });
        return hit?.id ? String(hit.id) : null;
      } catch {
        return null;
      }
    };

    const putById = async (id: string) => {
      await api.put(`/daily-closings/${id}`, payload);
    };

    // Offline rows use a local id the server never saw. Never PUT by date string on
    // older APIs (they treat :id as UUID and return "Closing not found").
    if (op === 'update' || op === 'create') {
      if (row.entityId && !/^\d{4}-\d{2}-\d{2}$/.test(String(row.entityId))) {
        try {
          await putById(String(row.entityId));
          return;
        } catch (err: any) {
          if (!isMissingClosing(err) && !isAlreadyClosed(err)) {
            if (isPastClosingLocked(err)) return;
            throw err;
          }
        }
      }

      try {
        await api.post('/daily-closings', payload);
        return;
      } catch (err: any) {
        if (!isAlreadyClosed(err) && !isMissingClosing(err)) throw err;
      }

      const serverId = await findServerClosingId();
      if (serverId) {
        try {
          await putById(serverId);
          return;
        } catch (err: any) {
          // Already on server / locked past day — clear queue instead of blocking sync.
          if (isAlreadyClosed(err) || isMissingClosing(err) || isPastClosingLocked(err)) return;
          throw err;
        }
      }

      // No server row and create was rejected as duplicate — treat as synced.
      return;
    }
  }
  if (type === 'stock_movement') {
    const endpoint = p.endpoint || op;
    try {
      await api.post(`/stock/${endpoint}`, {
        items: [p.item || p],
        notes: p.notes,
      });
    } catch (err) {
      if (isNotFoundErr(err)) return;
      throw err;
    }
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
    // 1) Push sync_queue first (products, categories, brands, customers, suppliers)
    // so new products exist on the server before sales referencing them are created.
    if (hasSqliteBridge()) {
      const queue = await localListSyncQueue();
      for (const row of queue) {
        try {
          await pushSyncQueueItem(row);
          await localMarkSyncQueueDone(row.id);
          synced += 1;
        } catch (err) {
          failed += 1;
          const message = apiError(err, err instanceof Error ? err.message : String(err));
          await localMarkSyncQueueError(row.id, message, (row.syncAttempts || 0) + 1);
          useConnectivityStore.getState().setLastSyncError(message);
          if (/401|403|login|unauthorized/i.test(message)) break;
        }
      }
    }

    // 2) Push pending sales (bills)
    const sales = await listOutboxSales();
    for (const row of sales) {
      try {
        const created = (await createBill(row.payload)) as { id?: string };
        await removeOutboxSale(row.clientBillId, created?.id || null);
        synced += 1;
      } catch (err) {
        const message = apiError(err, err instanceof Error ? err.message : String(err));
        // Stale offline bill whose variants were recreated on live — drop after enough attempts.
        if (isNotFoundErr(err) && (row.syncAttempts || 0) >= 2) {
          await removeOutboxSale(row.clientBillId, null);
          synced += 1;
          continue;
        }
        failed += 1;
        await markOutboxSaleError(row, message);
        useConnectivityStore.getState().setLastSyncError(message);
        if (/401|403|login|unauthorized/i.test(message)) break;
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

async function pullServerClosings(): Promise<number> {
  try {
    const { data } = await api.get('/daily-closings');
    const items: any[] = Array.isArray(data?.data) ? data.data : [];
    for (const row of items) {
      if (!row?.id) continue;
      await localSaveDailyClosing({ ...row, syncStatus: 'synced' });
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
  closings: number;
}> {
  if (!hasSqliteBridge() || !navigator.onLine) {
    return { products: 0, categories: 0, brands: 0, customers: 0, sales: 0, expenses: 0, returns: 0, closings: 0 };
  }

  const pullErrors: string[] = [];

  // Products are critical — do not swallow failures into an empty upsert (that leaves
  // desktop missing everything created on mobile).
  // Prefer all non-deleted products (no status filter) so newly created rows are included.
  let products: Awaited<ReturnType<typeof fetchAllProducts>> = [];
  try {
    products = await fetchAllProducts({
      forceNetwork: true,
      preferFull: true,
    });
  } catch (err) {
    try {
      products = await fetchAllProducts({
        status: 'active',
        forceNetwork: true,
        preferFull: true,
      });
    } catch (err2) {
      const message = apiError(err2, apiError(err, 'Could not download products'));
      pullErrors.push(message);
      console.error('[KDSPOZ] product pull failed:', err2);
    }
  }

  const [categories, brands, shop, customers, suppliers, expenseCats, units, taxGroups] = await Promise.all([
    fetchCategories(undefined, { forceNetwork: true }).catch((err) => {
      pullErrors.push(apiError(err, 'Could not download categories'));
      return [];
    }),
    fetchBrands(undefined, { forceNetwork: true }).catch((err) => {
      pullErrors.push(apiError(err, 'Could not download brands'));
      return [];
    }),
    getShopSettings({ forceNetwork: true }).catch(() => null),
    import('../services/businessService')
      .then((m) => m.fetchCustomers(undefined, { forceNetwork: true }))
      .catch((err) => {
        pullErrors.push(apiError(err, 'Could not download customers'));
        return [];
      }),
    import('../services/inventoryService')
      .then((m) => m.fetchSuppliers(undefined, { forceNetwork: true }))
      .catch(() => []),
    api
      .get('/expense-categories')
      .then((r) => r.data?.data || [])
      .catch(() => []),
    api
      .get('/units')
      .then((r) => r.data?.data || [])
      .catch(() => []),
    api
      .get('/tax-groups')
      .then((r) => r.data?.data || [])
      .catch(() => []),
  ]);

  const supplierRows = Array.isArray(suppliers) ? suppliers : [];

  let catalogWritten = 0;
  if (products.length || categories.length || brands.length) {
    try {
      // Chunked IPC upsert — a single huge replace often fails on Electron and
      // leaves the local catalog missing products created on mobile.
      const written = await sqliteReplaceCatalogBatched({
        products: products || [],
        categories: categories || [],
        brands: brands || [],
        clearProducts: false,
        syncStock: true,
      });
      catalogWritten = written.products;
    } catch (err) {
      const message = apiError(err, 'Could not save products to local database');
      pullErrors.push(message);
      console.error('[KDSPOZ] catalog replace failed:', err);
    }
  }
  if (shop) await sqliteSaveShopSettings(shop);
  const customerRows = Array.isArray(customers)
    ? customers
    : Array.isArray((customers as { items?: unknown[] })?.items)
      ? (customers as { items: unknown[] }).items
      : [];
  if (customerRows.length) {
    try {
      await sqliteReplaceCustomers(customerRows);
    } catch (err) {
      pullErrors.push(apiError(err, 'Could not save customers locally'));
    }
  }

  const bridge = (await import('../desktop/bridge')).getDesktopBridge();
  if (bridge?.sqliteReplaceSuppliers) {
    const shopCode =
      (await import('../store/authStore')).useAuthStore.getState().savedLogin?.shopCode ||
      'default';
    await bridge.sqliteReplaceSuppliers({ shopCode, suppliers: supplierRows });
    if (bridge?.sqliteReplaceJsonTable && Array.isArray(expenseCats) && expenseCats.length) {
      await bridge.sqliteReplaceJsonTable({
        shopCode,
        table: 'expense_categories',
        rows: expenseCats,
      });
    }
    if (bridge?.sqliteReplaceJsonTable && Array.isArray(units) && units.length) {
      await bridge.sqliteReplaceJsonTable({
        shopCode,
        table: 'units',
        rows: units,
      });
    }
    if (bridge?.sqliteReplaceJsonTable && Array.isArray(taxGroups) && taxGroups.length) {
      await bridge.sqliteReplaceJsonTable({
        shopCode,
        table: 'tax_groups',
        rows: taxGroups,
      });
    }
  }

  // Bills / expenses / returns / closings created on mobile (online) → desktop local DB.
  const sales = await pullServerSales().catch(() => 0);
  const expenses = await pullServerExpenses().catch(() => 0);
  const returns = await pullServerReturns().catch(() => 0);
  const closings = await pullServerClosings().catch(() => 0);

  // Refresh disk cache from the live pull so Billing / ProductList see new mobile rows.
  // Write then bump once (do not invalidate-first — that races listeners onto an empty cache).
  try {
    const { writeCachedProducts, writeCachedCategories, bumpCatalogRevision } = await import(
      '../services/catalogCache'
    );
    if (products.length) {
      await writeCachedProducts(products, products.length, 'replace');
    }
    if (categories.length) {
      await writeCachedCategories(categories);
    }
    bumpCatalogRevision();
  } catch (err) {
    console.warn('[KDSPOZ] catalog cache refresh failed:', err);
    try {
      const { bumpCatalogRevision } = await import('../services/catalogCache');
      bumpCatalogRevision();
    } catch {
      /* ignore */
    }
  }

  if (products.length && catalogWritten === 0 && !pullErrors.some((e) => /local database/i.test(e))) {
    pullErrors.push(`Downloaded ${products.length} products but none were saved locally`);
  } else if (!products.length && categories.length > 0 && !pullErrors.length) {
    // Shop has categories on live but product download returned empty — likely auth/API issue.
    pullErrors.push('Downloaded 0 products from live database');
  }

  if (pullErrors.length) {
    useConnectivityStore.getState().setLastSyncError(pullErrors[0]);
  }

  await sqliteSetMeta('last_pull_at', new Date().toISOString());
  return {
    // Report what landed in SQLite (0 if download or local write failed).
    products: products.length ? catalogWritten : 0,
    categories: (categories || []).length,
    brands: (brands || []).length,
    customers: customerRows.length,
    sales,
    expenses,
    returns,
    closings,
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
    closings?: number;
  };
};

/**
 * Two-way sync with live DB (mobile is online-only, so live DB may have newer masters/bills):
 * 1) PULL live catalog first (so Windows installs get server variant ids / pack barcodes)
 * 2) PUSH desktop pending sales + queue → server (resilient to stale ids / barcode clashes)
 * 3) PULL recent bills/expenses again after push
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
    let pulled: SyncResult['pulled'];
    if (hasSqliteBridge()) {
      // Catalog first — reduces "variant not found" / duplicate barcode from stale local ids.
      pulled = await pullEverythingToSqlite();
    }
    const push = await flushOutbox();
    if (hasSqliteBridge()) {
      // Refresh transactional rows created on other devices while we pushed.
      const sales = await pullServerSales().catch(() => 0);
      const expenses = await pullServerExpenses().catch(() => 0);
      const returns = await pullServerReturns().catch(() => 0);
      const closings = await pullServerClosings().catch(() => 0);
      if (pulled) {
        pulled = {
          ...pulled,
          sales: (pulled.sales || 0) + sales,
          expenses: (pulled.expenses || 0) + expenses,
          returns: (pulled.returns || 0) + returns,
          closings: (pulled.closings || 0) + closings,
        };
      }
    }
    const syncedAt = new Date().toISOString();
    await sqliteSetMeta('last_sync_at', syncedAt).catch(() => undefined);
    useConnectivityStore.getState().setLastSyncAt(syncedAt);
    return { ...push, pulled };
  } catch (err) {
    const message = apiError(err, err instanceof Error ? err.message : String(err));
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

registerAutoSyncRunner(syncNow);

export function startOutboxSync(): () => void {
  if (!isDesktopOfflineCapable()) return () => {};
  void refreshPendingCount();
  const onOnline = () => {
    const s = useConnectivityStore.getState();
    if (s.manualOffline) return;
    s.setOnline(true);
    if (s.autoSync) {
      void triggerAutoSync();
    }
  };
  const onOffline = () => useConnectivityStore.getState().setOnline(false);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}
