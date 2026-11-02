import api from './api';

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
    sku: string;
    variant_id?: string;
    quantity: string | number;
    returned_quantity?: string | number;
    unit_price: string | number;
    discount_amount?: string | number;
    tax_amount?: string | number;
    line_total: string | number;
    taxes?: Array<{ tax_name: string; rate_percent: string | number; tax_amount: string | number }>;
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
  const { data } = await api.get(`/bills/${id}`);
  return data.data;
}

export async function printBill(id: string, format: '58' | '80' | 'a4' = '80') {
  const { data } = await api.get(`/bills/${id}/print`, { params: { format } });
  return data.data;
}

export async function voidBill(id: string, reason: string) {
  const { data } = await api.post(`/bills/${id}/void`, { reason });
  return data.data;
}

export async function holdBill(name: string, cartData: unknown, customerId?: string) {
  const { data } = await api.post('/bills/hold', { name, cartData, customerId });
  return data.data;
}

export async function fetchHeldBills() {
  const { data } = await api.get('/bills/held/list');
  return data.data;
}

export async function resumeHeldBill(id: string) {
  const { data } = await api.post(`/bills/held/${id}/resume`);
  return data.data;
}

export async function deleteHeldBill(id: string) {
  const { data } = await api.delete(`/bills/held/${id}`);
  return data.data;
}

export async function fetchCustomers(search?: string) {
  const { data } = await api.get('/customers', { params: { search, page: 1, limit: 200 } });
  return data.data;
}

export async function createCustomer(payload: { name: string; phone?: string; email?: string; address?: string; notes?: string }) {
  const { data } = await api.post('/customers', payload);
  return data.data;
}

export async function updateCustomer(id: string, payload: { name?: string; phone?: string; email?: string; address?: string; notes?: string }) {
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

export async function createReturn(payload: Record<string, unknown>) {
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
  const { data } = await api.get('/returns', { params: { page, limit } });
  return data.data as { items: ReturnListItem[]; total?: number };
}

type ReportRange = { from?: string; to?: string };

export async function fetchSalesReport(from?: string, to?: string) {
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
  const { data } = await api.get('/reports/profit', { params: range });
  return data.data;
}

export async function fetchPurchaseReport(range?: ReportRange) {
  const { data } = await api.get('/reports/purchases', { params: range });
  return data.data;
}

export async function fetchGstReport(range?: ReportRange) {
  const { data } = await api.get('/reports/gst', { params: range });
  return data.data;
}

export async function fetchStockReport() {
  const { data } = await api.get('/reports/stock');
  return data.data;
}

export async function fetchLowStockReport() {
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
  const { data } = await api.get('/reports/cash-flow', { params: range });
  return data.data;
}

export async function fetchExpenseCategories() {
  const { data } = await api.get('/expense-categories');
  return data.data;
}

export async function fetchExpenses(params?: { from?: string; to?: string; limit?: number }) {
  const { data } = await api.get('/expenses', {
    params: {
      from: params?.from,
      to: params?.to,
      limit: params?.limit || 500,
    },
  });
  return data.data;
}

export async function createExpense(payload: Record<string, unknown>) {
  const { data } = await api.post('/expenses', payload);
  return data.data;
}

export async function createDailyClosing(payload: Record<string, unknown>) {
  const { data } = await api.post('/daily-closings', payload);
  return data.data;
}

export async function fetchDailyClosings() {
  const { data } = await api.get('/daily-closings');
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
  const { data } = await api.post(`/bills/${billId}/print-network`, { printerId });
  return data.data;
}
