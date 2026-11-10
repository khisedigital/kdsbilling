import api from './api';

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
  const { data } = await api.get('/branches');
  return data.data;
}

export async function fetchStockBalances(params?: {
  page?: number;
  limit?: number;
  search?: string;
  lowStock?: boolean;
}) {
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
  const { data } = await api.get('/stock/history', { params });
  return data.data as {
    items: StockLedgerEntry[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  };
}

export async function postStockMovement(
  endpoint: 'opening' | 'in' | 'out' | 'adjust' | 'damage',
  payload: { items: Array<{ variantId: string; quantity: number; unitCost?: number }>; notes?: string }
) {
  const { data } = await api.post(`/stock/${endpoint}`, payload);
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

export async function fetchSuppliers(search?: string): Promise<Supplier[]> {
  const { data } = await api.get('/suppliers', { params: { search } });
  return data.data;
}

export async function createSupplier(payload: {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
}): Promise<Supplier> {
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
  const { data } = await api.put(`/suppliers/${id}`, payload);
  return data.data;
}

export async function deleteSupplier(id: string) {
  const { data } = await api.delete(`/suppliers/${id}`);
  return data.data;
}

export async function fetchPurchaseBills(page = 1, params?: { limit?: number; search?: string }) {
  const { data } = await api.get('/purchases/bills', {
    params: { page, limit: params?.limit || 200, search: params?.search },
  });
  return data.data;
}

export async function createPurchaseBill(payload: {
  supplierId: string;
  billDate?: string;
  notes?: string;
  items: Array<{ variantId: string; quantity: number; unitCost: number; taxAmount?: number }>;
}): Promise<PurchaseBill> {
  const { data } = await api.post('/purchases/bills', payload);
  return data.data;
}

export async function fetchPurchaseBill(id: string): Promise<PurchaseBill> {
  const { data } = await api.get(`/purchases/bills/${id}`);
  return data.data;
}
