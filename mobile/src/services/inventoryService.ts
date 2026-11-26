import api from './api';
import { allBarcodesOf } from './catalogService';
import { hasSqliteBridge } from '../offline/sqliteApi';

export interface StockBalance {
  id: string;
  branch_id: string;
  variant_id: string;
  quantity: string | number;
  variant?: {
    id: string;
    sku: string;
    size?: string;
    color?: string;
    reorder_level: string | number;
    product?: { id: string; name: string };
    uom?: { code: string; name: string };
  };
}

export interface StockLedgerEntry {
  id: string;
  movement_type: string;
  quantity_change: string | number;
  balance_after: string | number;
  notes?: string;
  created_at: string;
  variant?: StockBalance['variant'];
  creator?: { id: string; name: string };
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  tax_number?: string;
  status: string;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  is_default: boolean;
}

export interface PurchaseBill {
  id: string;
  bill_number: string;
  bill_date: string;
  total_amount: string | number;
  supplier?: { id: string; name: string };
  items?: Array<{
    id: string;
    quantity: string | number;
    unit_cost: string | number;
    variant?: { sku: string; product?: { name: string } };
  }>;
}

export async function fetchBranches(): Promise<Branch[]> {
  const fallback: Branch[] = [{ id: 'main', name: 'Main Branch', code: 'MAIN' }];
  try {
    const { isOfflineNow } = await import('../offline/connectivityStore');
    if (isOfflineNow()) return fallback;
    const { data } = await api.get('/branches');
    return data.data?.length ? data.data : fallback;
  } catch {
    return fallback;
  }
}

export async function fetchStockBalances(params?: {
  page?: number;
  limit?: number;
  search?: string;
  lowStock?: boolean;
}) {
  try {
    const { isFullyLocalMode } = await import('../offline/localApi');
    const { sqliteListProducts } = await import('../offline/sqliteApi');
    if (isFullyLocalMode()) {
      const page = Math.max(1, params?.page || 1);
      const limit = Math.max(1, Math.min(5000, params?.limit || 200));
      const search = String(params?.search || '').trim();
      const { items } = await sqliteListProducts({
        search,
        limit: 50000,
        offset: 0,
      });
      const rows: StockBalance[] = [];
      for (const p of items as any[]) {
        for (const v of p.variants || []) {
          if (!v?.id) continue;
          if (search) {
            const q = search.toLowerCase();
            const matches = [p.name, p.name_mr, p.nameMr, v.sku, ...allBarcodesOf(v)]
              .some((value) => String(value || '').toLowerCase().includes(q));
            if (!matches) continue;
          }
          const qty = Number(v.stockQty ?? v.stock_qty) || 0;
          const reorder = Number(v.reorderLevel ?? v.reorder_level) || 0;
          if (params?.lowStock && !(qty <= reorder)) continue;
          rows.push({
            id: `local-${v.id}`,
            branch_id: 'local',
            variant_id: String(v.id),
            quantity: qty,
            variant: {
              id: String(v.id),
              sku: String(v.sku || ''),
              size: v.size ?? undefined,
              color: v.color ?? undefined,
              reorder_level: reorder,
              product: { id: String(p.id), name: String(p.name || '') },
              uom: v.uom || (v.unit ? { code: String(v.unit), name: String(v.unit) } : undefined),
            },
          });
        }
      }
      const total = rows.length;
      const start = (page - 1) * limit;
      const pageItems = rows.slice(start, start + limit);
      return {
        items: pageItems,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit) || 1),
        },
      };
    }
  } catch (err) {
    if (hasSqliteBridge()) throw err;
  }
  const { data } = await api.get('/stock/balances', {
    params: {
      page: params?.page || 1,
      limit: params?.limit || 200,
      search: params?.search,
      lowStock: params?.lowStock ? 'true' : undefined,
    },
  });
  return data.data;
}

export async function fetchStockHistory(params?: {
  page?: number;
  variantId?: string;
  productId?: string;
  movementType?: string;
}) {
  try {
    const { isFullyLocalMode, localListStockMovements } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const all = await localListStockMovements({ limit: 2000 });
      let items = (all || []).map((row: any) => ({
        id: String(row.id),
        movement_type: String(row.reason || row.movement_type || ''),
        quantity_change: Number(row.qtyDelta ?? row.quantity_change ?? row.quantity) || 0,
        balance_after: 0,
        notes: row.notes,
        created_at: String(row.created_at || row.createdAt || new Date().toISOString()),
        variant: {
          id: String(row.variantId || row.variant_id || ''),
          sku: '',
          reorder_level: 0,
        },
      })) as StockLedgerEntry[];
      if (params?.variantId) {
        items = items.filter((i) => i.variant?.id === params.variantId);
      }
      if (params?.movementType) {
        items = items.filter((i) => i.movement_type === params.movementType);
      }
      const page = Math.max(1, params?.page || 1);
      const limit = 200;
      const total = items.length;
      const start = (page - 1) * limit;
      return {
        items: items.slice(start, start + limit),
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit) || 1) },
      };
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/stock/history', { params });
  return data.data as {
    items: StockLedgerEntry[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  };
}

export async function postStockMovement(
  endpoint: 'opening' | 'in' | 'out' | 'adjust' | 'damage',
  payload: {
    items: Array<{ variantId: string; quantity: number; unitCost?: number; productId?: string }>;
    notes?: string;
  },
  opts?: { forceNetwork?: boolean },
) {
  if (!opts?.forceNetwork) {
    const { isFullyLocalMode, localSaveStockMovementsAndQueue } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const { applyCatalogPricePatches } = await import('./catalogCache');
      const entries = (payload.items || []).map((item) => {
        if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
          throw new Error('Secure stock movement IDs are unavailable');
        }
        const quantity = Number(item.quantity);
        if (!Number.isFinite(quantity) || quantity === 0 || Number(quantity.toFixed(3)) !== quantity) {
          throw new Error('Stock quantity must be non-zero with at most three decimal places');
        }
        const delta = endpoint === 'out' || endpoint === 'damage' ? -Math.abs(quantity) : quantity;
        return {
          row: {
            id: crypto.randomUUID(),
            variantId: item.variantId,
            qtyDelta: delta,
            reason: endpoint,
            notes: payload.notes,
            unitCost: item.unitCost,
            syncStatus: 'pending',
          },
          endpoint,
          item,
          notes: payload.notes,
        };
      });
      const result = await localSaveStockMovementsAndQueue(entries);
      const stockPatches = result.movements.map((movement, index) => ({
        variantId: movement.variantId,
        productId: entries[index].item.productId,
        stockQty: movement.stockQty,
      }));
      await applyCatalogPricePatches(stockPatches);
      return { ok: true, stockPatches };
    }
  }
  const { data } = await api.post(`/stock/${endpoint}`, {
    notes: payload.notes,
    items: (payload.items || []).map((item) => ({
      variantId: item.variantId,
      quantity: item.quantity,
      ...(item.unitCost != null ? { unitCost: item.unitCost } : {}),
    })),
  });
  return data.data;
}

export async function transferStock(payload: {
  toBranchId: string;
  fromBranchId?: string;
  items: Array<{ variantId: string; quantity: number }>;
  notes?: string;
}) {
  const { data } = await api.post('/stock/transfer', payload);
  return data.data;
}

export async function fetchSuppliers(
  search?: string,
  opts?: { forceNetwork?: boolean },
): Promise<Supplier[]> {
  if (!opts?.forceNetwork) {
    try {
      const { isFullyLocalMode, localListSuppliers } = await import('../offline/localApi');
      if (isFullyLocalMode()) {
        return (await localListSuppliers({ search })) as Supplier[];
      }
    } catch {
      /* fall through */
    }
  }
  const { data } = await api.get('/suppliers', { params: { search } });
  return data.data;
}

export async function createSupplier(
  payload: {
    name: string;
    phone?: string;
    email?: string;
    address?: string;
  },
  opts?: { forceNetwork?: boolean },
): Promise<Supplier> {
  if (!opts?.forceNetwork) {
    try {
      const { isFullyLocalMode, localUpsertSupplier, localEnqueueSync } = await import(
        '../offline/localApi'
      );
      if (isFullyLocalMode()) {
        const id =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `sup-${Date.now()}`;
        const supplier = { id, ...payload, status: 'active', syncStatus: 'pending' } as Supplier;
        await localUpsertSupplier(supplier);
        await localEnqueueSync({
          entityType: 'supplier',
          entityId: id,
          op: 'create',
          payload: supplier,
        });
        return supplier;
      }
    } catch {
      /* fall through */
    }
  }
  const { data } = await api.post('/suppliers', payload);
  return data.data;
}

export type BulkImportSummary = {
  success: number;
  skipped: number;
  failed: number;
  errors: { row: number; message: string }[];
};

export async function bulkImportSuppliers(
  rows: Array<{ name: string; phone?: string; email?: string; address?: string; taxNumber?: string }>,
): Promise<BulkImportSummary> {
  const { data } = await api.post('/suppliers/bulk-import', { rows });
  return data.data;
}

export async function updateSupplier(
  id: string,
  payload: { name?: string; phone?: string; email?: string; address?: string; taxNumber?: string },
): Promise<Supplier> {
  try {
    const { isFullyLocalMode, localUpsertSupplier, localListSuppliers, localEnqueueSync } =
      await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const existing = ((await localListSuppliers()) as Supplier[]).find((s) => s.id === id);
      const supplier = {
        ...(existing || { id, status: 'active' }),
        ...payload,
        id,
        syncStatus: 'pending',
      } as Supplier;
      await localUpsertSupplier(supplier);
      await localEnqueueSync({
        entityType: 'supplier',
        entityId: id,
        op: 'update',
        payload: supplier,
      });
      return supplier;
    }
  } catch {
    /* fall through */
  }
  try {
    const { data } = await api.put(`/suppliers/${id}`, payload);
    return data.data;
  } catch (err) {
    const { isFullyLocalMode, localUpsertSupplier, localListSuppliers, localEnqueueSync } =
      await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const existing = ((await localListSuppliers()) as Supplier[]).find((s) => s.id === id);
      const supplier = {
        ...(existing || { id, status: 'active' }),
        ...payload,
        id,
        syncStatus: 'pending',
      } as Supplier;
      await localUpsertSupplier(supplier);
      await localEnqueueSync({
        entityType: 'supplier',
        entityId: id,
        op: 'update',
        payload: supplier,
      });
      return supplier;
    }
    throw err;
  }
}

export async function deleteSupplier(id: string) {
  try {
    const { isFullyLocalMode, localDeleteSupplier, localEnqueueSync } = await import(
      '../offline/localApi'
    );
    if (isFullyLocalMode()) {
      await localDeleteSupplier(id);
      await localEnqueueSync({
        entityType: 'supplier',
        entityId: id,
        op: 'delete',
        payload: { id },
      });
      return { success: true, id };
    }
  } catch {
    /* fall through */
  }
  try {
    const { data } = await api.delete(`/suppliers/${id}`);
    return data.data;
  } catch (err) {
    const { isFullyLocalMode, localDeleteSupplier, localEnqueueSync } = await import(
      '../offline/localApi'
    );
    if (isFullyLocalMode()) {
      await localDeleteSupplier(id);
      await localEnqueueSync({
        entityType: 'supplier',
        entityId: id,
        op: 'delete',
        payload: { id },
      });
      return { success: true, id };
    }
    throw err;
  }
}

export async function fetchPurchaseBills(page = 1, params?: { limit?: number; search?: string }) {
  try {
    const { isFullyLocalMode, localListPurchases } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const items = await localListPurchases({
        search: params?.search,
        limit: params?.limit || 200,
      });
      return { items, pagination: { page, limit: params?.limit || 200, total: items.length, totalPages: 1 } };
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/purchases/bills', {
    params: { page, limit: params?.limit || 200, search: params?.search },
  });
  return data.data;
}

export async function createPurchaseBill(
  payload: {
    supplierId: string;
    billDate?: string;
    notes?: string;
    items: Array<{ variantId: string; quantity: number; unitCost: number; taxAmount?: number }>;
  },
  opts?: { forceNetwork?: boolean },
): Promise<PurchaseBill> {
  if (!opts?.forceNetwork) {
    try {
      const { isFullyLocalMode, localSavePurchase, localEnqueueSync } = await import(
        '../offline/localApi'
      );
      if (isFullyLocalMode()) {
        const id =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `pur-${Date.now()}`;
        const total = payload.items.reduce((s, it) => s + it.quantity * it.unitCost, 0);
        const row = {
          id,
          ...payload,
          bill_number: `PUR-${id.slice(0, 8).toUpperCase()}`,
          bill_date: payload.billDate || new Date().toISOString().slice(0, 10),
          total_amount: total,
          syncStatus: 'pending',
          created_at: new Date().toISOString(),
        };
        await localSavePurchase(row);
        await localEnqueueSync({
          entityType: 'purchase',
          entityId: id,
          op: 'create',
          payload,
        });
        return row as unknown as PurchaseBill;
      }
    } catch {
      /* fall through */
    }
  }
  const { data } = await api.post('/purchases/bills', payload);
  return data.data;
}

export async function fetchPurchaseBill(id: string): Promise<PurchaseBill> {
  try {
    const { isFullyLocalMode, localGetPurchase } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const item = await localGetPurchase(id);
      if (item) return item as PurchaseBill;
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get(`/purchases/bills/${id}`);
  return data.data;
}
