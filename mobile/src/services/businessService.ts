import api from './api';
import { useLanguageStore } from '../i18n/languageStore';
import {
  isFullyLocalMode as isBillLocalMode,
  localGetSale as getLocalBill,
  localSalesReport,
} from '../offline/localApi';
import { isOfflineNow as isBillOfflineNow } from '../offline/connectivityStore';
import { sqliteSaveSale as cacheBillLocally } from '../offline/sqliteApi';

export interface BillDetail {
  id: string;
  bill_number: string;
  device_id?: string | null;
  branch_id?: string;
  status: 'draft' | 'held' | 'completed' | 'void' | 'partially_returned' | 'fully_returned';
  is_returnable?: boolean;
  subtotal: string | number;
  discount_amount: string | number;
  discount_percent?: string | number;
  tax_amount: string | number;
  round_off_amount?: string | number;
  total_amount: string | number;
  paid_amount: string | number;
  change_amount: string | number;
  notes?: string | null;
  created_at?: string;
  createdAt?: string;
  void_reason?: string | null;
  voided_at?: string | null;
  customer?: { id: string; name: string; phone?: string } | null;
  branch?: { id: string; name: string; code?: string } | null;
  creator?: { id: string; name: string } | null;
  items?: Array<{
    id: string;
    product_name: string;
    product_name_mr?: string | null;
    sku: string;
    variant_id?: string;
    quantity: string | number;
    returned_quantity?: string | number;
    /** Catalog unit, so a 100 g barcode prints as "100 g" and not 0.1. */
    uom?: { code: string; name?: string; type?: 'count' | 'weight' | 'volume' | 'length' } | null;
    unit_price: string | number;
    mrp?: string | number | null;
    discount_amount?: string | number;
    tax_amount?: string | number;
    line_total: string | number;
    taxes?: Array<{ tax_name: string; rate_percent: string | number; tax_amount: string | number }>;
    variant?: {
      id?: string;
      size?: string | null;
      color?: string | null;
      product?: {
        id?: string;
        name?: string;
        name_mr?: string | null;
        uom?: { code: string; name?: string; type?: 'count' | 'weight' | 'volume' | 'length' } | null;
      } | null;
    } | null;
  }>;
  payments?: Array<{
    id: string;
    payment_mode: string;
    amount: string | number;
    reference_number?: string | null;
  }>;
  returns?: Array<{
    id: string;
    return_number: string;
    credit_note_number?: string | null;
    subtotal?: string | number;
    tax_amount?: string | number;
    discount_amount?: string | number;
    total_amount?: string | number;
    refund_amount?: string | number;
    store_credit_amount?: string | number;
    refund_mode?: string;
    notes?: string | null;
    created_at?: string;
    createdAt?: string;
    items?: Array<{
      id: string;
      quantity: string | number;
      unit_price: string | number;
      line_total: string | number;
      salesOrderItem?: { product_name?: string; sku?: string } | null;
      sales_order_item?: { product_name?: string; sku?: string } | null;
    }>;
  }>;
}

export async function fetchDashboard() {
  try {
    const { isFullyLocalMode, localDashboard } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const local = await localDashboard();
      if (local) return local;
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/dashboard');
  return data.data;
}

export async function previewBill(payload: Record<string, unknown>) {
  const { data } = await api.post('/bills/preview', payload);
  return data.data;
}

export async function createBill(payload: Record<string, unknown>, offlineSync = false) {
  const { data } = await api.post(offlineSync ? '/bills/sync' : '/bills', payload);
  return data.data;
}

export async function fetchBills(page = 1, params?: {
  limit?: number;
  search?: string;
  status?: string;
  from?: string;
  to?: string;
}) {
  try {
    const { isFullyLocalMode, localListSales } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const limit = params?.limit || 200;
      return localListSales({
        search: params?.search,
        status: params?.status,
        from: params?.from,
        to: params?.to,
        limit,
        offset: Math.max(0, (page - 1) * limit),
      });
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/bills', {
    params: {
      page,
      limit: params?.limit || 200,
      search: params?.search,
      status: params?.status,
      from: params?.from,
      to: params?.to,
    },
  });
  return data.data;
}

export async function fetchBill(id: string): Promise<BillDetail> {
  if (isBillLocalMode()) {
    const localBill = await getLocalBill(id) as (BillDetail & {
      client_bill_id?: string;
      sync_status?: string;
    }) | null;
    if (localBill) {
      if (localBill.sync_status !== 'synced') return localBill;

      let serverBill: BillDetail;
      try {
        const { data } = await api.get(`/bills/${localBill.id}`);
        serverBill = data.data as BillDetail;
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (isBillOfflineNow() || status === 404) return localBill;
        throw err;
      }

      if (!Array.isArray(serverBill?.items)) {
        throw new Error('Bill items are missing from the server response');
      }
      await cacheBillLocally({
        clientBillId: localBill.client_bill_id || localBill.id,
        serverBillId: serverBill.id,
        createdAt: serverBill.created_at || serverBill.createdAt || localBill.created_at,
        payload: {},
        bill: serverBill,
        syncStatus: 'synced',
        skipStock: true,
        syncedAt: new Date().toISOString(),
      });
      return serverBill;
    }
  }
  const { data } = await api.get(`/bills/${id}`);
  return data.data;
}

export async function printBill(id: string, format: '58' | '80' | 'a4' = '80') {
  const { data } = await api.get(`/bills/${id}/print`, {
    params: { format, language: useLanguageStore.getState().bill },
  });
  return data.data;
}

export async function voidBill(id: string, reason: string) {
  const { data } = await api.post(`/bills/${id}/void`, { reason });
  return data.data;
}

export async function deletePendingSale(clientBillId: string) {
  const { isFullyLocalMode, localDeletePendingSale } = await import('../offline/localApi');
  if (!isFullyLocalMode()) throw new Error('Only unsynced local sales can be deleted');
  const { useConnectivityStore } = await import('../offline/connectivityStore');
  const connectivity = useConnectivityStore.getState();
  if (connectivity.syncing) throw new Error('Wait for sync to finish before deleting a sale');
  connectivity.setSyncing(true);
  try {
    const result = await localDeletePendingSale(clientBillId);
    const { refreshPendingCount } = await import('../offline/outbox');
    await refreshPendingCount();
    return result;
  } finally {
    connectivity.setSyncing(false);
  }
}

export async function holdBill(name: string, cartData: unknown, customerId?: string) {
  try {
    const { isFullyLocalMode, localSaveHeldBill, localEnqueueSync } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `held-${Date.now()}`;
      const held = { id, name, customerId: customerId || null, cartData };
      await localSaveHeldBill(held);
      await localEnqueueSync({
        entityType: 'held_bill',
        entityId: id,
        op: 'create',
        payload: held,
      });
      return held;
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.post('/bills/hold', { name, cartData, customerId });
  return data.data;
}

export async function fetchHeldBills() {
  try {
    const { isFullyLocalMode, localListHeldBills } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      return localListHeldBills();
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/bills/held/list');
  return data.data;
}

export async function resumeHeldBill(id: string) {
  try {
    const { isFullyLocalMode, localListHeldBills, localDeleteHeldBill, localEnqueueSync } =
      await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const rows = await localListHeldBills();
      const held = rows.find((r: { id?: string }) => r.id === id);
      if (!held) throw new Error('Held bill not found');
      await localDeleteHeldBill(id);
      await localEnqueueSync({
        entityType: 'held_bill',
        entityId: id,
        op: 'delete',
        payload: { id },
      });
      return held;
    }
  } catch (err) {
    const { isFullyLocalMode } = await import('../offline/localApi');
    if (isFullyLocalMode()) throw err;
  }
  const { data } = await api.post(`/bills/held/${id}/resume`);
  return data.data;
}

export async function deleteHeldBill(id: string) {
  try {
    const { isFullyLocalMode, localDeleteHeldBill, localEnqueueSync } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      await localDeleteHeldBill(id);
      await localEnqueueSync({
        entityType: 'held_bill',
        entityId: id,
        op: 'delete',
        payload: { id },
      });
      return { ok: true };
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.delete(`/bills/held/${id}`);
  return data.data;
}

export async function fetchCustomers(search?: string, opts?: { forceNetwork?: boolean }) {
  if (!opts?.forceNetwork) {
    try {
      const { hasSqliteBridge } = await import('../offline/sqliteApi');
      const { readSqliteCustomers } = await import('../offline/localCatalog');
      if (hasSqliteBridge()) {
        const local = await readSqliteCustomers(search);
        return { items: local };
      }
    } catch {
      /* fall through */
    }
  }
  // Sync / forceNetwork: page through all customers so mobile-created rows are not truncated.
  if (opts?.forceNetwork && !search?.trim()) {
    const all: unknown[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const { data } = await api.get('/customers', { params: { page, limit: 200 } });
      const payload = data.data;
      const items = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : [];
      all.push(...items);
      totalPages = Number(payload?.pagination?.totalPages) || 1;
      page += 1;
    } while (page <= totalPages && page <= 100);
    return { items: all, pagination: { page: 1, limit: all.length, total: all.length, totalPages: 1 } };
  }
  const { data } = await api.get('/customers', { params: { search, page: 1, limit: 200 } });
  return data.data;
}

export async function createCustomer(
  payload: { name: string; phone?: string; email?: string; address?: string; notes?: string },
  opts?: { forceNetwork?: boolean },
) {
  if (!opts?.forceNetwork) {
    try {
      const { hasSqliteBridge, sqliteUpsertCustomer } = await import('../offline/sqliteApi');
      const { localEnqueueSync } = await import('../offline/localApi');
      if (hasSqliteBridge()) {
        const id =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `local-cust-${Date.now()}`;
        const customer = {
          id,
          ...payload,
          store_credit_balance: 0,
          _localOnly: true,
          sync_status: 'pending',
        };
        await sqliteUpsertCustomer(customer);
        await localEnqueueSync({
          entityType: 'customer',
          entityId: id,
          op: 'create',
          payload: customer,
        });
        return customer;
      }
    } catch {
      /* fall through to API */
    }
  }
  const { data } = await api.post('/customers', payload);
  return data.data;
}

export async function updateCustomer(
  id: string,
  payload: { name?: string; phone?: string; email?: string; address?: string; notes?: string },
  opts?: { forceNetwork?: boolean },
) {
  if (!opts?.forceNetwork) {
    try {
      const { hasSqliteBridge, sqliteUpsertCustomer, sqliteListCustomers } = await import(
        '../offline/sqliteApi'
      );
      const { localEnqueueSync } = await import('../offline/localApi');
      if (hasSqliteBridge()) {
        const existing =
          (await sqliteListCustomers({ search: '', limit: 5000 })).find(
            (c: any) => c?.id === id,
          ) || { id };
        const customer = { ...existing, ...payload, id, sync_status: 'pending' };
        await sqliteUpsertCustomer(customer);
        await localEnqueueSync({
          entityType: 'customer',
          entityId: id,
          op: 'update',
          payload: customer,
        });
        return customer;
      }
    } catch {
      /* fall through */
    }
  }
  const { data } = await api.put(`/customers/${id}`, payload);
  return data.data;
}

export async function deleteCustomer(id: string) {
  try {
    const { isFullyLocalMode, localDeleteCustomer, localEnqueueSync } = await import(
      '../offline/localApi'
    );
    if (isFullyLocalMode()) {
      await localDeleteCustomer(id);
      await localEnqueueSync({
        entityType: 'customer',
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
    const { data } = await api.delete(`/customers/${id}`);
    return data.data;
  } catch (err) {
    const { isFullyLocalMode, localDeleteCustomer, localEnqueueSync } = await import(
      '../offline/localApi'
    );
    if (isFullyLocalMode()) {
      await localDeleteCustomer(id);
      await localEnqueueSync({
        entityType: 'customer',
        entityId: id,
        op: 'delete',
        payload: { id },
      });
      return { success: true, id };
    }
    throw err;
  }
}

export async function fetchOffers() {
  try {
    const { isOfflineNow } = await import('../offline/connectivityStore');
    if (isOfflineNow()) return [];
    const { data } = await api.get('/offers');
    return data.data;
  } catch {
    return [];
  }
}

export async function createReturn(
  payload: Record<string, unknown>,
  opts?: { forceNetwork?: boolean },
) {
  if (!opts?.forceNetwork) {
    try {
      const { isFullyLocalMode, localSaveReturn, localEnqueueSync } = await import(
        '../offline/localApi'
      );
      if (isFullyLocalMode()) {
        const id =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `ret-${Date.now()}`;
        const row = {
          id,
          ...payload,
          return_number: `RET-${id.slice(0, 8).toUpperCase()}`,
          created_at: new Date().toISOString(),
          syncStatus: 'pending',
        };
        await localSaveReturn(row);
        await localEnqueueSync({
          entityType: 'return',
          entityId: id,
          op: 'create',
          payload: row,
        });
        return row;
      }
    } catch {
      /* fall through */
    }
  }
  const { data } = await api.post('/returns', payload);
  return data.data;
}

export type ReturnListItem = {
  id: string;
  return_number: string;
  credit_note_number?: string | null;
  sales_order_id?: string;
  total_amount?: string | number;
  refund_amount?: string | number;
  refund_mode?: string;
  created_at?: string;
  createdAt?: string;
  salesOrder?: { id?: string; bill_number?: string; status?: string };
  sales_order?: { id?: string; bill_number?: string; status?: string };
};

export async function fetchReturns(page = 1, limit = 100) {
  try {
    const { isFullyLocalMode, localListReturns } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const items = await localListReturns({ limit });
      return { items: items as ReturnListItem[], total: items.length };
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/returns', { params: { page, limit } });
  return data.data as { items: ReturnListItem[]; total?: number };
}

type ReportRange = { from?: string; to?: string };

export const DEFAULT_EXPENSE_CATEGORIES = [
  { id: 'cat-rent', name: 'Rent' },
  { id: 'cat-salary', name: 'Salary' },
  { id: 'cat-electricity', name: 'Electricity' },
  { id: 'cat-tea', name: 'Tea & Snacks' },
  { id: 'cat-transport', name: 'Transport' },
  { id: 'cat-maintenance', name: 'Maintenance' },
  { id: 'cat-stationery', name: 'Office / Stationery' },
  { id: 'cat-other', name: 'Other' },
];

export async function fetchSalesReport(from?: string, to?: string) {
  try {
    const { isFullyLocalMode, localSalesReport } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const local = await localSalesReport({ from, to });
      if (local) return local;
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/reports/sales', { params: { from, to } });
  return data.data;
}

export async function fetchProductReport(range?: ReportRange) {
  if (isBillLocalMode()) {
    const sales = await localSalesReport(range);
    if (!sales) throw new Error('Local product report is unavailable');
    const items = sales.topProducts || [];
    return {
      items,
      mostSold: sales.mostSold || items[0] || null,
      summary: {
        totalQty: items.reduce((s: number, i: any) => s + (Number(i.total_qty) || 0), 0),
        totalRevenue: items.reduce((s: number, i: any) => s + (Number(i.revenue) || 0), 0),
      },
    };
  }
  const { data } = await api.get('/reports/products', { params: range });
  return data.data;
}

export async function fetchCategorySalesReport(range?: ReportRange) {
  try {
    const { isFullyLocalMode, localListSales } = await import('../offline/localApi');
    const { sqliteListProducts, sqliteListCategories } = await import('../offline/sqliteApi');
    if (isFullyLocalMode()) {
      const [{ items: sales }, { items: products }, { items: categories }] = await Promise.all([
        localListSales({ from: range?.from, to: range?.to, limit: 10000 }),
        sqliteListProducts({ limit: 50000 }),
        sqliteListCategories(),
      ]);
      const catNameMap = new Map<string, string>();
      for (const c of categories as any[]) catNameMap.set(c.id, c.name);

      const prodCatMap = new Map<string, string>();
      for (const p of products as any[]) {
        const catName = (p.categoryId && catNameMap.get(p.categoryId)) || p.category?.name || 'Uncategorised';
        prodCatMap.set(p.name, catName);
        if (p.id) prodCatMap.set(p.id, catName);
        for (const v of p.variants || []) {
          if (v.id) prodCatMap.set(v.id, catName);
          if (v.sku) prodCatMap.set(v.sku, catName);
        }
      }

      const catAgg = new Map<string, { category_name: string; total_qty: number; revenue: number }>();
      for (const s of sales as any[]) {
        const items = s.items || s.bill?.items || [];
        for (const it of items) {
          const catName =
            prodCatMap.get(it.variant_id) ||
            prodCatMap.get(it.variantId) ||
            prodCatMap.get(it.sku) ||
            prodCatMap.get(it.product_name) ||
            prodCatMap.get(it.productName) ||
            'Uncategorised';
          if (!catAgg.has(catName)) {
            catAgg.set(catName, { category_name: catName, total_qty: 0, revenue: 0 });
          }
          const row = catAgg.get(catName)!;
          row.total_qty += Number(it.quantity) || 0;
          row.revenue += Number(it.line_total ?? it.lineTotal ?? (it.quantity * it.unit_price)) || 0;
        }
      }
      return Array.from(catAgg.values()).sort((a, b) => b.revenue - a.revenue);
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/reports/categories', { params: range });
  return data.data;
}

export async function fetchBrandSalesReport(range?: ReportRange) {
  try {
    const { isFullyLocalMode, localListSales } = await import('../offline/localApi');
    const { sqliteListProducts, sqliteListBrands } = await import('../offline/sqliteApi');
    if (isFullyLocalMode()) {
      const [{ items: sales }, { items: products }, { items: brands }] = await Promise.all([
        localListSales({ from: range?.from, to: range?.to, limit: 10000 }),
        sqliteListProducts({ limit: 50000 }),
        sqliteListBrands(),
      ]);
      const brandNameMap = new Map<string, string>();
      for (const b of brands as any[]) brandNameMap.set(b.id, b.name);

      const prodBrandMap = new Map<string, string>();
      for (const p of products as any[]) {
        const brandName = (p.brandId && brandNameMap.get(p.brandId)) || p.brand?.name || 'No brand';
        prodBrandMap.set(p.name, brandName);
        if (p.id) prodBrandMap.set(p.id, brandName);
        for (const v of p.variants || []) {
          if (v.id) prodBrandMap.set(v.id, brandName);
          if (v.sku) prodBrandMap.set(v.sku, brandName);
        }
      }

      const brandAgg = new Map<string, { brand_name: string; total_qty: number; revenue: number }>();
      for (const s of sales as any[]) {
        const items = s.items || s.bill?.items || [];
        for (const it of items) {
          const brandName =
            prodBrandMap.get(it.variant_id) ||
            prodBrandMap.get(it.variantId) ||
            prodBrandMap.get(it.sku) ||
            prodBrandMap.get(it.product_name) ||
            prodBrandMap.get(it.productName) ||
            'No brand';
          if (!brandAgg.has(brandName)) {
            brandAgg.set(brandName, { brand_name: brandName, total_qty: 0, revenue: 0 });
          }
          const row = brandAgg.get(brandName)!;
          row.total_qty += Number(it.quantity) || 0;
          row.revenue += Number(it.line_total ?? it.lineTotal ?? (it.quantity * it.unit_price)) || 0;
        }
      }
      return Array.from(brandAgg.values()).sort((a, b) => b.revenue - a.revenue);
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/reports/brands', { params: range });
  return data.data;
}

export async function fetchProfitReport(range?: ReportRange) {
  try {
    const { isFullyLocalMode, localProfitReport } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const local = await localProfitReport(range);
      if (local) return local;
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/reports/profit', { params: range });
  return data.data;
}

export async function fetchPurchaseReport(range?: ReportRange) {
  try {
    const { isFullyLocalMode, localListPurchases } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const items = await localListPurchases({ limit: 500 });
      const bills = (Array.isArray(items) ? items : []).map((r: any) => ({
        id: r.id,
        bill_number: r.bill_number || r.billNumber || 'PB',
        bill_date: r.bill_date || r.billDate || r.created_at?.slice(0, 10) || '',
        total_amount: Number(r.total_amount ?? r.totalAmount ?? 0),
        supplier: r.supplier ? { name: r.supplier.name } : undefined,
      }));
      return {
        bills,
        summary: {
          count: bills.length,
          total: bills.reduce((s, b) => s + (b.total_amount || 0), 0),
        },
      };
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/reports/purchases', { params: range });
  return data.data;
}

export async function fetchGstReport(range?: ReportRange) {
  try {
    const { isFullyLocalMode, localGstReport } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const local = await localGstReport(range);
      if (local) {
        if (Array.isArray(local)) return local;
        if (Array.isArray(local.items)) return local.items;
        return [
          { tax_name: 'GST Total Tax Collected', totalTax: Number(local.tax || 0) },
          { tax_name: 'Taxable Turnover', totalTax: Number(local.taxable || 0) },
          { tax_name: 'Gross Turnover', totalTax: Number(local.total || 0) },
        ];
      }
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/reports/gst', { params: range });
  return data.data;
}

export async function fetchStockReport() {
  try {
    const { isFullyLocalMode } = await import('../offline/localApi');
    const { sqliteListProducts } = await import('../offline/sqliteApi');
    if (isFullyLocalMode()) {
      const { items } = await sqliteListProducts({ limit: 50000, offset: 0 });
      return (items as any[]).flatMap((p) =>
        (p.variants || []).map((v: any) => ({
          id: v.id || `${p.id}-${v.sku}`,
          quantity: Number(v.stockQty ?? v.stock_qty ?? 0),
          variant: {
            id: v.id,
            sku: v.sku,
            size: v.size || null,
            color: v.color || null,
            reorder_level: Number(v.reorderLevel ?? v.reorder_level ?? 0),
            product: { id: p.id, name: p.name },
            uom: { code: v.uom?.code || v.uomCode || 'PCS' },
          },
        })),
      );
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/reports/stock');
  return data.data;
}

export async function fetchLowStockReport() {
  try {
    const { isFullyLocalMode } = await import('../offline/localApi');
    const { sqliteListProducts } = await import('../offline/sqliteApi');
    if (isFullyLocalMode()) {
      const { items } = await sqliteListProducts({ limit: 50000, offset: 0 });
      const flat = (items as any[]).flatMap((p) =>
        (p.variants || []).map((v: any) => ({
          id: v.id || `${p.id}-${v.sku}`,
          quantity: Number(v.stockQty ?? v.stock_qty ?? 0),
          reorder_level: Number(v.reorderLevel ?? v.reorder_level ?? 5),
          variant: {
            id: v.id,
            sku: v.sku,
            size: v.size || null,
            color: v.color || null,
            product: { id: p.id, name: p.name },
            uom: { code: v.uom?.code || v.uomCode || 'PCS' },
          },
        })),
      );
      const low = flat.filter((item) => item.quantity <= 0 || (item.reorder_level > 0 && item.quantity <= item.reorder_level));
      return {
        items: low,
        summary: { count: low.length },
      };
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/reports/stock/low');
  return data.data;
}

export async function fetchCustomerReport(range?: ReportRange) {
  try {
    const { isFullyLocalMode, localListSales } = await import('../offline/localApi');
    const { sqliteListCustomers } = await import('../offline/sqliteApi');
    if (isFullyLocalMode()) {
      const [{ items: customers }, { items: sales }] = await Promise.all([
        sqliteListCustomers({ limit: 2000 }),
        localListSales({ from: range?.from, to: range?.to, limit: 10000 }),
      ]);
      const custMap = new Map<string, { id: string; name: string; phone?: string; order_count: number; total_spent: number }>();
      for (const c of customers as any[]) {
        custMap.set(c.id, { id: c.id, name: c.name, phone: c.phone || '', order_count: 0, total_spent: 0 });
      }
      for (const s of sales as any[]) {
        const cid = s.customer_id || s.customer?.id;
        if (cid && custMap.has(cid)) {
          const entry = custMap.get(cid)!;
          entry.order_count += 1;
          entry.total_spent += Number(s.total_amount) || 0;
        }
      }
      return Array.from(custMap.values()).filter((c) => c.order_count > 0).sort((a, b) => b.total_spent - a.total_spent);
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/reports/customers', { params: range });
  return data.data;
}

export async function fetchSupplierReport(range?: ReportRange) {
  try {
    const { isFullyLocalMode, localListSuppliers, localListPurchases } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const [suppliers, purchases] = await Promise.all([
        localListSuppliers(),
        localListPurchases({ limit: 5000 }),
      ]);
      const supMap = new Map<string, { id: string; name: string; phone?: string; bill_count: number; total_purchased: number }>();
      for (const s of suppliers as any[]) {
        supMap.set(s.id, { id: s.id, name: s.name, phone: s.phone || '', bill_count: 0, total_purchased: 0 });
      }
      for (const p of purchases as any[]) {
        const sid = p.supplier_id || p.supplierId || p.supplier?.id;
        if (sid && supMap.has(sid)) {
          const entry = supMap.get(sid)!;
          entry.bill_count += 1;
          entry.total_purchased += Number(p.total_amount ?? p.totalAmount ?? 0);
        }
      }
      return Array.from(supMap.values()).filter((s) => s.bill_count > 0).sort((a, b) => b.total_purchased - a.total_purchased);
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/reports/suppliers', { params: range });
  return data.data;
}

export async function fetchExpenseReport(range?: ReportRange) {
  try {
    const { isFullyLocalMode, localListExpenses } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const items = await localListExpenses(range);
      const list = Array.isArray(items) ? items : [];
      const total = list.reduce((s: number, e: any) => s + (parseFloat(String(e.amount)) || 0), 0);
      return { expenses: list, total };
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/reports/expenses', { params: range });
  return data.data;
}

export async function fetchCashFlowReport(range?: ReportRange) {
  try {
    const { isFullyLocalMode, localCashflowReport } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const local = await localCashflowReport(range);
      if (local) return local;
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/reports/cash-flow', { params: range });
  return data.data;
}

export async function fetchExpenseCategories() {
  try {
    const { isFullyLocalMode } = await import('../offline/localApi');
    const { getDesktopBridge } = await import('../desktop/bridge');
    if (isFullyLocalMode()) {
      const b = getDesktopBridge();
      if (b?.sqliteListJsonTable) {
        const { useAuthStore } = await import('../store/authStore');
        const shopCode = useAuthStore.getState().savedLogin?.shopCode || 'default';
        const res = await b.sqliteListJsonTable({ shopCode, table: 'expense_categories' });
        if (res?.items && Array.isArray(res.items) && res.items.length > 0) {
          return res.items;
        }
      }
      return DEFAULT_EXPENSE_CATEGORIES;
    }
  } catch {
    /* fall through */
  }
  try {
    const { data } = await api.get('/expense-categories');
    return Array.isArray(data.data) && data.data.length ? data.data : DEFAULT_EXPENSE_CATEGORIES;
  } catch {
    return DEFAULT_EXPENSE_CATEGORIES;
  }
}

export async function fetchExpenses(params?: { from?: string; to?: string; limit?: number }) {
  try {
    const { isFullyLocalMode, localListExpenses } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const items = await localListExpenses(params);
      // Screen expects an array (same as most list UIs).
      return Array.isArray(items) ? items : [];
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/expenses', {
    params: {
      from: params?.from,
      to: params?.to,
      limit: params?.limit || 500,
    },
  });
  const payload = data.data;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

export async function createExpense(payload: Record<string, unknown>) {
  const expenseDate = String(payload.expenseDate || payload.expense_date || new Date().toISOString().slice(0, 10));
  const fullPayload = {
    ...payload,
    expenseDate,
    expense_date: expenseDate,
  };
  try {
    const { isFullyLocalMode, localSaveExpense, localEnqueueSync } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `exp-${Date.now()}`;
      const expense = { id, ...fullPayload, syncStatus: 'pending' };
      await localSaveExpense(expense);
      await localEnqueueSync({
        entityType: 'expense',
        entityId: id,
        op: 'create',
        payload: expense,
      });
      return expense;
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.post('/expenses', fullPayload);
  return data.data;
}

export type ClosingPaymentBreakdown = {
  cash: number;
  upi: number;
  card: number;
  other: number;
};

export type ClosingPreview = {
  closingDate: string;
  alreadyClosed: boolean;
  existingClosing?: DailyClosingRecord | null;
  suggestedOpeningCash: number;
  previousClosingDate?: string | null;
  totalSales: number;
  payments: ClosingPaymentBreakdown;
  cashSales: number;
  cashRefunds: number;
  cashExpenses: number;
  formula?: string;
};

export type DailyClosingRecord = {
  id: string;
  branch_id?: string;
  closing_date: string;
  opening_cash: string | number;
  expected_cash: string | number;
  actual_cash: string | number;
  variance: string | number;
  total_sales: string | number;
  total_expenses: string | number;
  notes?: string | null;
  details?: {
    payments?: ClosingPaymentBreakdown;
    cashSales?: number;
    cashRefunds?: number;
    cashExpenses?: number;
    cashAdded?: number;
    denominations?: Record<string, number>;
    varianceReason?: string | null;
    remarks?: string | null;
  } | null;
  creator?: { id: string; name: string } | null;
  created_at?: string;
};

export async function previewDailyClosing(closingDate?: string): Promise<ClosingPreview> {
  try {
    const { isFullyLocalMode, localPreviewDailyClosing } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const local = await localPreviewDailyClosing(closingDate);
      if (local) return local as ClosingPreview;
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/daily-closings/preview', {
    params: closingDate ? { closingDate } : undefined,
  });
  return data.data;
}

export async function createDailyClosing(
  payload: {
    openingCash: number;
    actualCash: number;
    cashAdded?: number;
    notes?: string;
    varianceReason?: string;
    denominations?: Record<string, number>;
    closingDate?: string;
  },
  opts?: { forceNetwork?: boolean },
): Promise<DailyClosingRecord> {
  if (!opts?.forceNetwork) {
    try {
      const { isFullyLocalMode, localPreviewDailyClosing, localSaveDailyClosing, localEnqueueSync } =
        await import('../offline/localApi');
      if (isFullyLocalMode()) {
        const preview = await localPreviewDailyClosing(payload.closingDate);
        const id =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `close-${Date.now()}`;
        const expected =
          Number(payload.openingCash || 0) +
          Number(preview?.cashSales || 0) -
          Number(preview?.cashExpenses || 0) +
          Number(payload.cashAdded || 0);
        const row: DailyClosingRecord = {
          id,
          closing_date: payload.closingDate || preview?.closingDate || new Date().toISOString().slice(0, 10),
          opening_cash: payload.openingCash,
          expected_cash: expected,
          actual_cash: payload.actualCash,
          variance: Number(payload.actualCash) - expected,
          total_sales: preview?.totalSales || 0,
          total_expenses: preview?.cashExpenses || 0,
          notes: payload.notes || null,
          details: {
            payments: preview?.payments,
            cashSales: preview?.cashSales,
            cashRefunds: preview?.cashRefunds,
            cashExpenses: preview?.cashExpenses,
            cashAdded: payload.cashAdded,
            denominations: payload.denominations,
            varianceReason: payload.varianceReason,
          },
          created_at: new Date().toISOString(),
        };
        await localSaveDailyClosing({ ...row, syncStatus: 'pending' });
        await localEnqueueSync({
          entityType: 'daily_closing',
          entityId: id,
          op: 'create',
          payload: { ...payload, id },
        });
        return row;
      }
    } catch {
      /* fall through */
    }
  }
  const { data } = await api.post('/daily-closings', payload);
  return data.data;
}

export async function updateDailyClosing(
  id: string,
  payload: {
    openingCash: number;
    actualCash: number;
    cashAdded?: number;
    notes?: string;
    varianceReason?: string;
    denominations?: Record<string, number>;
    closingDate?: string;
  },
  opts?: { forceNetwork?: boolean },
): Promise<DailyClosingRecord> {
  if (!opts?.forceNetwork) {
    try {
      const { isFullyLocalMode, localPreviewDailyClosing, localSaveDailyClosing, localEnqueueSync } =
        await import('../offline/localApi');
      if (isFullyLocalMode()) {
        const preview = await localPreviewDailyClosing(payload.closingDate);
        const expected =
          Number(payload.openingCash || 0) +
          Number(preview?.cashSales || 0) -
          Number(preview?.cashExpenses || 0) +
          Number(payload.cashAdded || 0);
        const row: DailyClosingRecord = {
          id,
          closing_date: payload.closingDate || preview?.closingDate || new Date().toISOString().slice(0, 10),
          opening_cash: payload.openingCash,
          expected_cash: expected,
          actual_cash: payload.actualCash,
          variance: Number(payload.actualCash) - expected,
          total_sales: preview?.totalSales || 0,
          total_expenses: preview?.cashExpenses || 0,
          notes: payload.notes || null,
          details: {
            payments: preview?.payments,
            cashSales: preview?.cashSales,
            cashRefunds: preview?.cashRefunds,
            cashExpenses: preview?.cashExpenses,
            cashAdded: payload.cashAdded,
            denominations: payload.denominations,
            varianceReason: payload.varianceReason,
          },
          created_at: new Date().toISOString(),
        };
        await localSaveDailyClosing({ ...row, syncStatus: 'pending' });
        await localEnqueueSync({
          entityType: 'daily_closing',
          entityId: id,
          op: 'update',
          payload: { ...payload, id },
        });
        return row;
      }
    } catch {
      /* fall through */
    }
  }
  const { data } = await api.put(`/daily-closings/${id}`, payload);
  return data.data;
}

export async function fetchDailyClosings(): Promise<DailyClosingRecord[]> {
  try {
    const { isFullyLocalMode, localListDailyClosings } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      return (await localListDailyClosings()) as DailyClosingRecord[];
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/daily-closings');
  return data.data;
}

export async function fetchDailyClosing(id: string): Promise<DailyClosingRecord> {
  try {
    const { isFullyLocalMode, localListDailyClosings } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const rows = (await localListDailyClosings()) as DailyClosingRecord[];
      const found = rows.find((r) => r.id === id);
      if (found) return found;
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get(`/daily-closings/${id}`);
  return data.data;
}

export async function fetchPrinters() {
  try {
    const { isOfflineNow } = await import('../offline/connectivityStore');
    if (isOfflineNow()) return [];
    const { data } = await api.get('/printers');
    return data.data;
  } catch {
    return [];
  }
}

export async function createPrinter(payload: Record<string, unknown>) {
  const { data } = await api.post('/printers', payload);
  return data.data;
}

export async function printBillNetwork(billId: string, printerId: string) {
  const { data } = await api.post(`/bills/${billId}/print-network`, {
    printerId,
    language: useLanguageStore.getState().bill,
  });
  return data.data;
}
