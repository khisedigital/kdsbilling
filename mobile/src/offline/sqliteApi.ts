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
  syncStock?: boolean;
  insertOnly?: boolean;
}) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteReplaceCatalog) return null;
  return bridge.sqliteReplaceCatalog({ shopCode: shopCode(), ...payload });
}

/** Drop heavy nested fields so Electron IPC can serialize large catalogs reliably. */
export function slimProductForSqlite(product: any): any {
  if (!product || typeof product !== 'object') return product;
  const variants = Array.isArray(product.variants)
    ? product.variants.map((v: any) => {
        if (!v || typeof v !== 'object') return v;
        const barcodes = Array.isArray(v.barcodes)
          ? v.barcodes
              .map((b: any) => {
                if (typeof b === 'string') return { barcode: b, is_primary: false, quantity: null };
                const qtyRaw = b?.quantity;
                const qty =
                  qtyRaw != null && qtyRaw !== '' && Number.isFinite(Number(qtyRaw)) && Number(qtyRaw) > 0
                    ? Number(qtyRaw)
                    : null;
                return {
                  barcode: String(b?.barcode || b?.code || '').trim(),
                  is_primary: !!b?.is_primary,
                  ...(qty != null ? { quantity: qty } : { quantity: null }),
                };
              })
              .filter((b: { barcode: string }) => !!b.barcode)
          : [];
        // Preserve pack barcodes even if API nested them separately.
        if (Array.isArray(v.quantityBarcodes)) {
          for (const qb of v.quantityBarcodes) {
            const code = String(qb?.barcode || qb?.code || '').trim();
            const qty = Number(qb?.quantity);
            if (!code || !Number.isFinite(qty) || qty <= 0) continue;
            if (barcodes.some((b: any) => b.barcode === code)) continue;
            barcodes.push({ barcode: code, is_primary: false, quantity: qty });
          }
        }
        const plain = barcodes.find((b: any) => b.quantity == null) || barcodes[0];
        return {
          id: v.id,
          sku: v.sku,
          size: v.size,
          color: v.color,
          status: v.status,
          tax_group_id: v.tax_group_id ?? v.taxGroupId ?? v.taxGroup?.id ?? null,
          taxGroupId: v.taxGroupId ?? v.tax_group_id ?? v.taxGroup?.id ?? null,
          taxGroup: v.taxGroup
            ? {
                id: v.taxGroup.id,
                name: v.taxGroup.name,
                total_rate: v.taxGroup.total_rate,
              }
            : undefined,
          barcode: v.barcode || plain?.barcode || null,
          barcodes,
          selling_price: v.selling_price ?? v.sellingPrice,
          sellingPrice: v.sellingPrice ?? v.selling_price,
          cost_price: v.cost_price ?? v.costPrice,
          costPrice: v.costPrice ?? v.cost_price,
          mrp: v.mrp,
          stock_qty: v.stock_qty ?? v.stockQty,
          stockQty: v.stockQty ?? v.stock_qty,
          unit: v.unit,
          isWeightBased: v.isWeightBased,
          allowDecimalQty: v.allowDecimalQty,
        };
      })
    : [];
  return {
    id: product.id,
    name: product.name,
    name_mr: product.name_mr ?? product.nameMr ?? null,
    nameMr: product.nameMr ?? product.name_mr ?? null,
    description: product.description,
    category_id: product.category_id ?? product.categoryId ?? null,
    categoryId: product.categoryId ?? product.category_id ?? null,
    brand_id: product.brand_id ?? product.brandId ?? null,
    brandId: product.brandId ?? product.brand_id ?? null,
    uom_id: product.uom_id ?? product.uomId,
    uomId: product.uomId ?? product.uom_id,
    tax_group_id: product.tax_group_id ?? product.taxGroupId ?? null,
    taxGroupId: product.taxGroupId ?? product.tax_group_id ?? null,
    taxGroup: product.taxGroup
      ? {
          id: product.taxGroup.id,
          name: product.taxGroup.name,
          total_rate: product.taxGroup.total_rate,
        }
      : undefined,
    tax_code: product.tax_code ?? product.taxCode ?? null,
    is_weight_based: product.is_weight_based ?? product.isWeightBased,
    allow_decimal_qty: product.allow_decimal_qty ?? product.allowDecimalQty,
    has_variants: product.has_variants ?? product.hasVariants,
    is_favorite: product.is_favorite ?? product.isFavorite,
    isFavorite: product.isFavorite ?? product.is_favorite,
    status: product.status || 'active',
    stockQty: product.stockQty ?? product.stock_qty,
    stock_qty: product.stock_qty ?? product.stockQty,
    uom: product.uom
      ? { id: product.uom.id, code: product.uom.code, name: product.uom.name, type: product.uom.type }
      : undefined,
    category: product.category
      ? {
          id: product.category.id,
          name: product.category.name,
          name_mr: product.category.name_mr ?? product.category.nameMr,
        }
      : undefined,
    brand: product.brand
      ? { id: product.brand.id, name: product.brand.name }
      : undefined,
    variants,
  };
}

/**
 * Upsert catalog in small IPC chunks — a single multi‑MB replace often fails
 * silently on Electron and leaves desktop missing mobile-created products.
 */
export async function sqliteReplaceCatalogBatched(payload: {
  products?: unknown[];
  categories?: unknown[];
  brands?: unknown[];
  clearProducts?: boolean;
  syncStock?: boolean;
  insertOnly?: boolean;
  productChunkSize?: number;
}): Promise<{ products: number; categories: number; brands: number }> {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteReplaceCatalog) {
    return { products: 0, categories: 0, brands: 0 };
  }
  const code = shopCode();
  const products = (payload.products || []).map(slimProductForSqlite);
  const categories = payload.categories || [];
  const brands = payload.brands || [];
  const chunkSize = Math.max(25, Math.min(150, payload.productChunkSize || 75));

  // Masters first (small). clearProducts only on the first product chunk.
  const masterResult = await bridge.sqliteReplaceCatalog({
    shopCode: code,
    products: [],
    categories,
    brands,
    clearProducts: false,
    syncStock: payload.syncStock !== false,
    insertOnly: payload.insertOnly,
  });

  let written = 0;
  if (!products.length) {
    return { products: 0, categories: masterResult.categories ?? categories.length, brands: masterResult.brands ?? brands.length };
  }

  for (let i = 0; i < products.length; i += chunkSize) {
    const chunk = products.slice(i, i + chunkSize);
    const clear = payload.clearProducts === true && i === 0;
    const result = await bridge.sqliteReplaceCatalog({
      shopCode: code,
      products: chunk,
      categories: [],
      brands: [],
      clearProducts: clear,
      syncStock: payload.syncStock !== false,
      insertOnly: payload.insertOnly,
    });
    written += result.products ?? chunk.length;
  }
  return { products: written, categories: masterResult.categories ?? categories.length, brands: masterResult.brands ?? brands.length };
}

export async function sqliteListProducts(opts?: {
  search?: string;
  limit?: number;
  offset?: number;
  categoryId?: string | null;
  brandId?: string | null;
  status?: string;
}) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteListProducts) throw new Error('Local product database is unavailable');
  const result = await bridge.sqliteListProducts({ shopCode: shopCode(), ...opts });
  return { items: result?.items || [], total: result?.total || 0 };
}

export async function sqliteGetProduct(id: string) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteGetProduct) throw new Error('Local product database is unavailable');
  if (!id) throw new Error('Product id is required');
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

export async function sqliteReplaceCustomers(customers: unknown[], insertOnly = false) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteReplaceCustomers) return null;
  const rows = Array.isArray(customers) ? customers : [];
  const code = shopCode();
  const chunkSize = 200;
  if (rows.length <= chunkSize) {
    return bridge.sqliteReplaceCustomers({ shopCode: code, customers: rows, insertOnly });
  }
  let last: unknown = null;
  let written = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const result = await bridge.sqliteReplaceCustomers({
      shopCode: code,
      customers: rows.slice(i, i + chunkSize),
      insertOnly,
    });
    last = result;
    written += result.customers ?? rows.slice(i, i + chunkSize).length;
  }
  return last ? { ok: true, customers: written } : null;
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
  if (!bridge?.sqliteSetMeta) throw new Error('Local sync metadata is unavailable');
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

export async function sqliteRetryMissingVariantSales() {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteRetryMissingVariantSales) throw new Error('Restart the desktop app to enable missing product recovery');
  const result = await bridge.sqliteRetryMissingVariantSales({ shopCode: shopCode() });
  if (!result?.ok) throw new Error('Could not retry missing-product bills');
  return result.count;
}

export async function sqliteMarkSaleSynced(clientBillId: string, serverBillId?: string | null) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteMarkSaleSynced) return;
  return bridge.sqliteMarkSaleSynced({ shopCode: shopCode(), clientBillId, serverBillId });
}

export async function sqliteMarkSaleError(clientBillId: string, message: string, attempts: number, localOnly = false) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteMarkSaleError) throw new Error('Local sale sync is unavailable');
  const result = await bridge.sqliteMarkSaleError({ shopCode: shopCode(), clientBillId, message, attempts, localOnly });
  if (!result?.ok) throw new Error('Local sale sync is unavailable');
  return result;
}

export async function sqlitePendingCount(): Promise<number> {
  const bridge = getDesktopBridge();
  if (!bridge?.sqlitePendingCount) return 0;
  const result = await bridge.sqlitePendingCount({ shopCode: shopCode() });
  return Number(result?.pending) || 0;
}

export async function sqliteGetProductBarcodeStatus(productId: string) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteGetProductBarcodeStatus) throw new Error('Local barcode database is unavailable');
  if (!productId) throw new Error('Product id is required');
  const result = await bridge.sqliteGetProductBarcodeStatus({ shopCode: shopCode(), productId: String(productId) });
  return result?.data ?? null;
}

export async function sqliteGenerateBarcodes(variantIds: string[]) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteGenerateBarcodes) throw new Error('Local barcode database is unavailable');
  const result = await bridge.sqliteGenerateBarcodes({ shopCode: shopCode(), variantIds });
  return result?.data ?? [];
}

export async function sqliteEnsureQuantityBarcodes(items: { variantId: string; quantity: number }[]) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteEnsureQuantityBarcodes) throw new Error('Local barcode database is unavailable');
  const result = await bridge.sqliteEnsureQuantityBarcodes({ shopCode: shopCode(), items });
  return result?.data ?? [];
}

export async function sqliteDeleteCategory(id: string) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteDeleteCategory || !id) return { deleted: false };
  const result = await bridge.sqliteDeleteCategory({ shopCode: shopCode(), id: String(id) });
  return result ?? { deleted: false };
}

export async function sqliteDeleteBrand(id: string) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteDeleteBrand || !id) return { deleted: false };
  const result = await bridge.sqliteDeleteBrand({ shopCode: shopCode(), id: String(id) });
  return result ?? { deleted: false };
}

export async function sqliteDeleteCustomer(id: string) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteDeleteCustomer || !id) return { deleted: false };
  const result = await bridge.sqliteDeleteCustomer({ shopCode: shopCode(), id: String(id) });
  return result ?? { deleted: false };
}

export async function sqliteDeleteSupplier(id: string) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteDeleteSupplier || !id) return { deleted: false };
  const result = await bridge.sqliteDeleteSupplier({ shopCode: shopCode(), id: String(id) });
  return result ?? { deleted: false };
}

export async function sqliteSetProductFavorite(id: string, isFavorite: boolean) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteSetProductFavorite || !id) return { id, isFavorite };
  const result = await bridge.sqliteSetProductFavorite({
    shopCode: shopCode(),
    id: String(id),
    isFavorite: !!isFavorite,
  });
  return result ?? { id, isFavorite };
}

export async function sqliteSetProductsFavoriteBulk(params: {
  categoryId: string;
  isFavorite: boolean;
  brandId?: string | null;
}) {
  const bridge = getDesktopBridge();
  if (!bridge?.sqliteSetProductsFavoriteBulk || !params.categoryId) {
    return { updated: 0, isFavorite: !!params.isFavorite };
  }
  const result = await bridge.sqliteSetProductsFavoriteBulk({
    shopCode: shopCode(),
    categoryId: String(params.categoryId),
    isFavorite: !!params.isFavorite,
    brandId: params.brandId || null,
  });
  return result ?? { updated: 0, isFavorite: !!params.isFavorite };
}
