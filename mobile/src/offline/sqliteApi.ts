import { getDesktopBridge } from '../desktop/bridge';
import { useAuthStore } from '../store/authStore';
import { isDesktopOfflineCapable } from './capability';

function shopCode(): string {
  return (
    useAuthStore.getState().savedLogin?.shopCode ||
    useAuthStore.getState().tenant?.slug ||
    'default'
  );
}

export function hasSqliteBridge(): boolean {
  const bridge = getDesktopBridge();
  return Boolean(isDesktopOfflineCapable() && bridge?.sqliteSaveSale && bridge?.sqliteListPendingSales);
}

export async function sqliteStatus() {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteStatus) return null;
  return bridge.sqliteStatus({ shopCode: shopCode() });
}

export async function sqliteSaveShopSettings(settings: unknown) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteSaveShopSettings) return;
  await bridge.sqliteSaveShopSettings({ shopCode: shopCode(), settings });
}

export async function sqliteReadShopSettings<T = unknown>(): Promise<T | null> {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteReadShopSettings) return null;
  const result = await bridge.sqliteReadShopSettings({ shopCode: shopCode() });
  return (result?.settings as T) ?? null;
}

export async function sqliteReplaceCatalog(payload: {
  products?: unknown[];
  categories?: unknown[];
  brands?: unknown[];
  clearProducts?: boolean;
}) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteReplaceCatalog) return null;
  return bridge.sqliteReplaceCatalog({ shopCode: shopCode(), ...payload });
}

export async function sqliteListProducts(opts?: {
  search?: string;
  limit?: number;
  offset?: number;
  categoryId?: string | null;
}) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteListProducts) return { items: [], total: 0 };
  const result = await bridge.sqliteListProducts({ shopCode: shopCode(), ...opts });
  return { items: result?.items || [], total: result?.total || 0 };
}

export async function sqliteGetProduct(id: string) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteGetProduct || !id) return null;
  const result = await bridge.sqliteGetProduct({ shopCode: shopCode(), id: String(id) });
  return result?.product ?? null;
}

export async function sqliteListCategories() {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteListCategories) return [];
  const result = await bridge.sqliteListCategories({ shopCode: shopCode() });
  return result?.items || [];
}

export async function sqliteListBrands() {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteListBrands) return [];
  const result = await bridge.sqliteListBrands({ shopCode: shopCode() });
  return result?.items || [];
}

export async function sqliteReplaceCustomers(customers: unknown[]) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteReplaceCustomers) return null;
  return bridge.sqliteReplaceCustomers({ shopCode: shopCode(), customers });
}

export async function sqliteListCustomers(opts?: { search?: string; limit?: number }) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteListCustomers) return [];
  const result = await bridge.sqliteListCustomers({ shopCode: shopCode(), ...opts });
  return result?.items || [];
}

export async function sqliteUpsertCustomer(customer: unknown) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteUpsertCustomer) return null;
  return bridge.sqliteUpsertCustomer({ shopCode: shopCode(), customer });
}

export async function sqliteSetMeta(key: string, value: string) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteSetMeta) return;
  await bridge.sqliteSetMeta({ shopCode: shopCode(), key, value });
}

export async function sqliteGetMeta(key: string, fallback: string | null = null): Promise<string | null> {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteGetMeta) return fallback;
  const result = await bridge.sqliteGetMeta({ shopCode: shopCode(), key, fallback });
  return (result?.value as string | null) ?? fallback;
}

/** Load the full local catalog (paged under the hood). */
export async function sqliteListAllProducts(): Promise<{ items: unknown[]; total: number }> {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteListProducts) return { items: [], total: 0 };
  const pageSize = 2000;
  const first = await bridge.sqliteListProducts({
    shopCode: shopCode(),
    limit: pageSize,
    offset: 0,
  });
  const total = Number(first?.total) || 0;
  const items = [...(first?.items || [])];
  for (let offset = pageSize; offset < total; offset += pageSize) {
    const page = await bridge.sqliteListProducts({
      shopCode: shopCode(),
      limit: pageSize,
      offset,
    });
    items.push(...(page?.items || []));
  }
  return { items, total: total || items.length };
}

export async function sqliteSaveSale(sale: unknown) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteSaveSale) throw new Error('SQLite offline store not available.');
  return bridge.sqliteSaveSale({ shopCode: shopCode(), sale });
}

export async function sqliteListPendingSales() {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteListPendingSales) return [];
  const result = await bridge.sqliteListPendingSales({ shopCode: shopCode() });
  return result?.rows || [];
}

export async function sqliteMarkSaleSynced(clientBillId: string, serverBillId?: string | null) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteMarkSaleSynced) return;
  return bridge.sqliteMarkSaleSynced({ shopCode: shopCode(), clientBillId, serverBillId });
}

export async function sqliteMarkSaleError(clientBillId: string, message: string, attempts: number) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteMarkSaleError) return;
  return bridge.sqliteMarkSaleError({ shopCode: shopCode(), clientBillId, message, attempts });
}

export async function sqlitePendingCount(): Promise<number> {
  const bridge = getDesktopBridge();
  if (!bridge?.sqlitePendingCount) return 0;
  const result = await bridge.sqlitePendingCount({ shopCode: shopCode() });
  return Number(result?.pending) || 0;
}
