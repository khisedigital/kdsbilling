import { getDesktopBridge } from '../desktop/bridge';
import type { DesktopBridge } from '../desktop/bridge';
import { useAuthStore } from '../store/authStore';
import { hasSqliteBridge } from './sqliteApi';

function shopCode(): string {
  return (
    useAuthStore.getState().savedLogin?.shopCode ||
    useAuthStore.getState().tenant?.slug ||
    'default'
  );
}

function bridge() {
  return getDesktopBridge();
}

export async function localListSales(opts?: {
  search?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}) {
  const b = bridge();
  if (!b?.sqliteListSales) return { items: [], pagination: { page: 1, limit: 500, total: 0, totalPages: 1 } };
  const result = await b.sqliteListSales({ shopCode: shopCode(), ...opts });
  return {
    items: result?.items || [],
    pagination: result?.pagination || { page: 1, limit: 500, total: 0, totalPages: 1 },
  };
}

export async function localGetSale(id: string) {
  const b = bridge();
  if (!b?.sqliteGetSale) return null;
  const result = await b.sqliteGetSale({ shopCode: shopCode(), id });
  return result?.bill || null;
}

export async function localDashboard() {
  const b = bridge();
  if (!b?.sqliteDashboard) return null;
  const result = await b.sqliteDashboard({ shopCode: shopCode() });
  return result?.data || null;
}

export async function localSalesReport(opts?: { from?: string; to?: string }) {
  const b = bridge();
  if (!b?.sqliteSalesReport) return null;
  const result = await b.sqliteSalesReport({ shopCode: shopCode(), ...opts });
  return result?.data || null;
}

export async function localSaveHeldBill(held: {
  id: string;
  name: string;
  customerId?: string | null;
  cartData: unknown;
}) {
  const b = bridge();
  if (!b?.sqliteSaveHeldBill) throw new Error('Local held bills unavailable');
  return b.sqliteSaveHeldBill({ shopCode: shopCode(), held });
}

export async function localListHeldBills() {
  const b = bridge();
  if (!b?.sqliteListHeldBills) return [];
  const result = await b.sqliteListHeldBills({ shopCode: shopCode() });
  return result?.items || [];
}

export async function localDeleteHeldBill(id: string) {
  const b = bridge();
  if (!b?.sqliteDeleteHeldBill) return;
  await b.sqliteDeleteHeldBill({ shopCode: shopCode(), id });
}

export async function localDeletePendingSale(clientBillId: string) {
  const b = bridge();
  if (!b?.sqliteDeletePendingSale) throw new Error('Local sale deletion unavailable');
  return b.sqliteDeletePendingSale({ shopCode: shopCode(), clientBillId });
}

export async function localSaveExpense(expense: Record<string, unknown>) {
  const b = bridge();
  if (!b?.sqliteSaveExpense) throw new Error('Local expenses unavailable');
  return b.sqliteSaveExpense({ shopCode: shopCode(), expense });
}

export async function localListExpenses(opts?: { from?: string; to?: string; limit?: number }) {
  const b = bridge();
  if (!b?.sqliteListExpenses) return [];
  const result = await b.sqliteListExpenses({ shopCode: shopCode(), ...opts });
  return result?.items || [];
}

export async function localEnqueueSync(entry: {
  entityType: string;
  entityId: string;
  op: string;
  payload: unknown;
}) {
  const b = bridge();
  if (!b?.sqliteEnqueueSync) throw new Error('Local sync queue is unavailable');
  return b.sqliteEnqueueSync({ shopCode: shopCode(), ...entry });
}

export async function localSaveAuthSession(session: Record<string, unknown>) {
  const b = bridge();
  if (!b?.sqliteSaveAuthSession) return;
  const code = String(session.shopCode || shopCode());
  await b.sqliteSaveAuthSession({ shopCode: code, session });
}

export async function localReadAuthSession(shop?: string) {
  const b = bridge();
  if (!b?.sqliteReadAuthSession) return null;
  const result = await b.sqliteReadAuthSession({ shopCode: shop || shopCode() });
  return result?.session || null;
}

export function isFullyLocalMode(): boolean {
  return hasSqliteBridge();
}

async function call<T = any>(method: string, payload: Record<string, unknown> = {}): Promise<T | null> {
  const b = bridge() as Record<string, any> | null;
  if (!b || typeof b[method] !== 'function') return null;
  return b[method]({ shopCode: shopCode(), ...payload });
}

export const localSaveReturn = (row: unknown) => call('sqliteSaveReturn', { row });
export const localListReturns = (opts?: { limit?: number }) =>
  call<{ items: any[] }>('sqliteListReturns', opts || {}).then((r) => r?.items || []);
export const localSavePurchase = (row: unknown) => call('sqliteSavePurchase', { row });
export const localListPurchases = (opts?: { search?: string; limit?: number }) =>
  call<{ items: any[] }>('sqliteListPurchases', opts || {}).then((r) => r?.items || []);
export const localGetPurchase = (id: string) =>
  call<{ item: any }>('sqliteGetPurchase', { id }).then((r) => r?.item || null);
export const localReplaceSuppliers = (suppliers: unknown[]) =>
  call('sqliteReplaceSuppliers', { suppliers });
export const localListSuppliers = (opts?: { search?: string }) =>
  call<{ items: any[] }>('sqliteListSuppliers', opts || {}).then((r) => r?.items || []);
export const localUpsertSupplier = (supplier: unknown) => call('sqliteUpsertSupplier', { supplier });
export const localSaveDailyClosing = (row: unknown) => call('sqliteSaveDailyClosing', { row });
export const localListDailyClosings = () =>
  call<{ items: any[] }>('sqliteListDailyClosings', {}).then((r) => r?.items || []);
export const localPreviewDailyClosing = (closingDate?: string) =>
  call<{ data: any }>('sqlitePreviewDailyClosing', { closingDate }).then((r) => r?.data || null);
export async function localUpsertProduct(product: unknown) {
  const b = bridge();
  if (!b?.sqliteUpsertProduct) throw new Error('Local product database is unavailable');
  return b.sqliteUpsertProduct({ shopCode: shopCode(), product });
}
export async function localUpsertProductsAndQueue(
  products: unknown[],
  entry: { entityType: string; entityId: string; op: string; payload: unknown },
) {
  const b = bridge();
  if (!b?.sqliteUpsertProductsAndQueue) throw new Error('Local product sync queue is unavailable');
  return b.sqliteUpsertProductsAndQueue({ shopCode: shopCode(), products, entry });
}
export async function localDeleteProduct(id: string) {
  const b = bridge();
  if (!b?.sqliteDeleteProduct) throw new Error('Local product database is unavailable');
  return b.sqliteDeleteProduct({ shopCode: shopCode(), id });
}
export async function localDeleteProductAndQueue(id: string): Promise<{ deleted: boolean }> {
  const b = bridge();
  if (!b?.sqliteDeleteProductAndQueue) throw new Error('Local product database is unavailable');
  return b.sqliteDeleteProductAndQueue({ shopCode: shopCode(), id });
}
export async function localDeleteAllProducts(): Promise<{ deleted: number }> {
  const b = bridge();
  if (!b?.sqliteDeleteAllProducts) throw new Error('Local product database is unavailable');
  return b.sqliteDeleteAllProducts({ shopCode: shopCode() });
}
export const localDeleteCategory = (id: string) => call('sqliteDeleteCategory', { id });
export const localDeleteBrand = (id: string) => call('sqliteDeleteBrand', { id });
export const localDeleteCustomer = (id: string) => call('sqliteDeleteCustomer', { id });
export const localDeleteSupplier = (id: string) => call('sqliteDeleteSupplier', { id });
export async function localSetProductFavorite(id: string, isFavorite: boolean) {
  const b = bridge();
  if (!b?.sqliteSetProductFavorite) throw new Error('Local product database is unavailable');
  return b.sqliteSetProductFavorite({ shopCode: shopCode(), id, isFavorite });
}
export async function localSetProductsFavoriteBulk(params: {
  categoryId: string;
  isFavorite: boolean;
  brandId?: string | null;
}) {
  const b = bridge();
  if (!b?.sqliteSetProductsFavoriteBulk) throw new Error('Local product database is unavailable');
  return b.sqliteSetProductsFavoriteBulk({ shopCode: shopCode(), ...params });
}
export const localAddCustomerLedger = (entry: unknown) => call('sqliteAddCustomerLedger', { entry });
export const localListCustomerLedger = (customerId: string) =>
  call<{ items: any[] }>('sqliteListCustomerLedger', { customerId }).then((r) => r?.items || []);
export const localSaveStockMovement = (row: unknown) => call('sqliteSaveStockMovement', { row });
export async function localSaveStockMovementsAndQueue(
  entries: Parameters<NonNullable<DesktopBridge['sqliteSaveStockMovementsAndQueue']>>[0]['entries'],
) {
  const b = bridge();
  if (!b?.sqliteSaveStockMovementsAndQueue) throw new Error('Restart the desktop app to enable safe stock sync');
  return b.sqliteSaveStockMovementsAndQueue({ shopCode: shopCode(), entries });
}
export const localListStockMovements = (opts?: { limit?: number }) =>
  call<{ items: any[] }>('sqliteListStockMovements', opts || {}).then((r) => r?.items || []);
export const localProfitReport = (opts?: { from?: string; to?: string }) =>
  call<{ data: any }>('sqliteProfitReport', opts || {}).then((r) => r?.data || null);
export const localGstReport = (opts?: { from?: string; to?: string }) =>
  call<{ data: any }>('sqliteGstReport', opts || {}).then((r) => r?.data || null);
export const localCashflowReport = (opts?: { from?: string; to?: string }) =>
  call<{ data: any }>('sqliteCashflowReport', opts || {}).then((r) => r?.data || null);
export const localListSyncQueue = () =>
  call<{ rows: any[] }>('sqliteListSyncQueue', {}).then((r) => r?.rows || []);
export async function localMarkSyncQueueDone(id: string) {
  const result = await call<{ ok: boolean }>('sqliteMarkSyncQueueDone', { id });
  if (!result?.ok) throw new Error('Local sync queue is unavailable');
}
export async function localMarkSyncQueueError(id: string, message: string, attempts: number, localOnly = false) {
  const result = await call<{ ok: boolean }>('sqliteMarkSyncQueueError', { id, message, attempts, localOnly });
  if (!result?.ok) throw new Error('Local sync queue is unavailable');
}
