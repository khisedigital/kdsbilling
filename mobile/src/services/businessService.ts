import api from './api';
import { useLanguageStore } from '../i18n/languageStore';

export interface BillDetail {
  id: string;
  bill_number: string;
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
      product?: { id?: string; name?: string; name_mr?: string | null } | null;
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

export async function createBill(payload: Record<string, unknown>) {
  const { data } = await api.post('/bills', payload);
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
  try {
    const { isFullyLocalMode, localGetSale } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const bill = await localGetSale(id);
      if (bill) return bill as BillDetail;
    }
  } catch {
    /* fall through */
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
  const { data } = await api.delete(`/customers/${id}`);
  return data.data;
}

export async function fetchOffers() {
  const { data } = await api.get('/offers');
  return data.data;
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
  const { data } = await api.get('/reports/products', { params: range });
  return data.data;
}

export async function fetchCategorySalesReport(range?: ReportRange) {
  const { data } = await api.get('/reports/categories', { params: range });
  return data.data;
}

export async function fetchBrandSalesReport(range?: ReportRange) {
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
  const { data } = await api.get('/reports/purchases', { params: range });
  return data.data;
}

export async function fetchGstReport(range?: ReportRange) {
  try {
    const { isFullyLocalMode, localGstReport } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const local = await localGstReport(range);
      if (local) return local;
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
      return {
        items: (items as any[]).flatMap((p) =>
          (p.variants || []).map((v: any) => ({
            productId: p.id,
            productName: p.name,
            variantId: v.id,
            sku: v.sku,
            stockQty: Number(v.stockQty ?? v.stock_qty) || 0,
          })),
        ),
      };
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/reports/stock');
  return data.data;
}

export async function fetchLowStockReport() {
  try {
    const { isFullyLocalMode, localDashboard } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const dash = await localDashboard();
      return { items: dash?.lowStock || [] };
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.get('/reports/stock/low');
  return data.data;
}

export async function fetchCustomerReport(range?: ReportRange) {
  const { data } = await api.get('/reports/customers', { params: range });
  return data.data;
}

export async function fetchSupplierReport(range?: ReportRange) {
  const { data } = await api.get('/reports/suppliers', { params: range });
  return data.data;
}

export async function fetchExpenseReport(range?: ReportRange) {
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
  const { data } = await api.get('/expense-categories');
  return data.data;
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
  try {
    const { isFullyLocalMode, localSaveExpense, localEnqueueSync } = await import('../offline/localApi');
    if (isFullyLocalMode()) {
      const id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `exp-${Date.now()}`;
      const expense = { id, ...payload, syncStatus: 'pending' };
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
  const { data } = await api.post('/expenses', payload);
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
  const { data } = await api.get('/printers');
  return data.data;
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
