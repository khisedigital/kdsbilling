import api from './api';
import { apiErrorCode } from '../utils/apiError';
import {
  applyCatalogPricePatches,
  invalidateCachedCategories,
  invalidateCachedProducts,
  invalidateCatalogCache,
  isCatalogCacheEnabled,
  patchCachedProductFavorite,
  patchCachedProductsFavoriteByCategory,
  readCachedProducts,
  upsertCachedProduct,
  writeCachedCategories,
  writeCachedProducts,
} from './catalogCache';
import type {
  Brand,
  Category,
  CreateProductPayload,
  Paginated,
  Product,
  ProductVariant,
  TaxGroup,
  UnitOfMeasure,
  UpdateProductPayload,
} from '../types/catalog';

function normalizeNameMr<T extends { name_mr?: string | null; nameMr?: string | null }>(row: T): T {
  const name_mr = row.name_mr ?? row.nameMr ?? null;
  return { ...row, name_mr, nameMr: name_mr };
}

export async function fetchCategories(
  search?: string,
  opts?: { forceNetwork?: boolean },
): Promise<Category[]> {
  if (!opts?.forceNetwork) {
    try {
      const { hasSqliteBridge } = await import('../offline/sqliteApi');
      const { readSqliteCategories } = await import('../offline/localCatalog');
      if (hasSqliteBridge()) {
        const local = (await readSqliteCategories()) as Category[];
        const q = search?.trim().toLowerCase();
        const rows = local.map((row) => normalizeNameMr(row));
        if (!q) return rows;
        return rows.filter((c) => (c.name || '').toLowerCase().includes(q));
      }
    } catch {
      /* fall through */
    }
  }

  const { data } = await api.get('/categories', { params: { search } });
  const rows = ((data.data || []) as Category[]).map((row) => {
    const normalized = normalizeNameMr(row);
    if (normalized.parent) {
      normalized.parent = normalizeNameMr(normalized.parent);
    }
    return normalized;
  });
  // Persist full list only (no search filter).
  if (isCatalogCacheEnabled() && !search?.trim()) {
    void writeCachedCategories(rows);
  }
  return rows;
}

/** Pull master categories + brands into this shop (create missing, refresh Marathi names). */
const MASTER_SYNC_TTL_MS = 15 * 60_000;
let lastMasterSyncAt = 0;
let lastMasterSyncRelinkAt = 0;
type MasterSyncResult = {
  categories: number;
  brands: number;
  categoriesCreated: number;
  brandsCreated: number;
  categoriesUpdated: number;
  brandsUpdated: number;
  productsRelinked?: number;
};
const EMPTY_MASTER_SYNC: MasterSyncResult = {
  categories: 0,
  brands: 0,
  categoriesCreated: 0,
  brandsCreated: 0,
  categoriesUpdated: 0,
  brandsUpdated: 0,
  productsRelinked: 0,
};
let masterSyncInFlight: Promise<MasterSyncResult> | null = null;

export async function syncCatalogFromMaster(options?: {
  /** Slow: re-attach products with missing category/brand. Use rarely (e.g. Category list). */
  relinkProducts?: boolean;
  /** Bypass the 15-minute throttle (pull-to-refresh). */
  force?: boolean;
}): Promise<MasterSyncResult> {
  const relink = options?.relinkProducts === true;
  const force = options?.force === true;
  const now = Date.now();
  const lastAt = relink ? lastMasterSyncRelinkAt : lastMasterSyncAt;
  if (!force && lastAt > 0 && now - lastAt < MASTER_SYNC_TTL_MS) {
    return { ...EMPTY_MASTER_SYNC };
  }

  // Share one in-flight request so concurrent screens all see create/update counts.
  // force/relink still runs a fresh pass after the shared call finishes.
  if (masterSyncInFlight) {
    const shared = await masterSyncInFlight.catch(() => ({ ...EMPTY_MASTER_SYNC }));
    if (!force) return shared;
  }

  masterSyncInFlight = (async () => {
    const { data } = await api.post('/master-catalog/sync-names', {
      relinkProducts: relink,
    });
    lastMasterSyncAt = Date.now();
    if (relink) lastMasterSyncRelinkAt = lastMasterSyncAt;
    // Categories may have been created/updated — drop stale disk cache.
    if (
      (data?.data?.categoriesCreated || 0) + (data?.data?.categoriesUpdated || 0) > 0
    ) {
      void invalidateCachedCategories();
    }
    return (data?.data as MasterSyncResult) || { ...EMPTY_MASTER_SYNC };
  })();

  try {
    return await masterSyncInFlight;
  } finally {
    masterSyncInFlight = null;
  }
}

export async function createCategory(payload: {
  name: string;
  nameMr?: string | null;
  parentId?: string;
  description?: string;
}): Promise<Category> {
  try {
    const { isFullyLocalMode, localEnqueueSync } = await import('../offline/localApi');
    const { sqliteReplaceCatalog } = await import('../offline/sqliteApi');
    if (isFullyLocalMode()) {
      const id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `cat-${Date.now()}`;
      const category = {
        id,
        name: payload.name,
        nameMr: payload.nameMr ?? null,
        name_mr: payload.nameMr ?? null,
        parentId: payload.parentId,
        description: payload.description,
        status: 'active',
      } as Category;
      await sqliteReplaceCatalog({ categories: [category], clearProducts: false });
      await localEnqueueSync({
        entityType: 'category',
        entityId: id,
        op: 'create',
        payload: category,
      });
      void invalidateCachedCategories();
      return category;
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.post('/categories', payload);
  void invalidateCachedCategories();
  return data.data;
}

export type BulkImportSummary = {
  success: number;
  skipped: number;
  failed: number;
  errors: { row: number; message: string }[];
};

export async function bulkImportCategories(
  rows: Array<{ name: string; description?: string }>,
): Promise<BulkImportSummary> {
  const { data } = await api.post('/categories/bulk-import', { rows });
  return data.data;
}

export async function updateCategory(id: string, payload: {
  name?: string;
  nameMr?: string | null;
  parentId?: string | null;
  description?: string;
}): Promise<Category> {
  try {
    const { isFullyLocalMode, localEnqueueSync } = await import('../offline/localApi');
    const { sqliteListCategories, sqliteReplaceCatalog } = await import('../offline/sqliteApi');
    if (isFullyLocalMode()) {
      const existing = ((await sqliteListCategories()) as Category[]).find((c) => c.id === id);
      const category = {
        ...(existing || { id, status: 'active' }),
        ...payload,
        id,
        nameMr: payload.nameMr ?? (existing as Category | undefined)?.nameMr ?? null,
        name_mr: payload.nameMr ?? (existing as any)?.name_mr ?? null,
      } as Category;
      await sqliteReplaceCatalog({ categories: [category], clearProducts: false });
      await localEnqueueSync({
        entityType: 'category',
        entityId: id,
        op: 'update',
        payload: category,
      });
      void invalidateCachedCategories();
      return category;
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.put(`/categories/${id}`, payload);
  void invalidateCachedCategories();
  return data.data;
}

export async function deleteCategory(id: string) {
  const { data } = await api.delete(`/categories/${id}`);
  // Deleting a category unlinks products — refresh both caches next load.
  void invalidateCatalogCache();
  return data.data;
}

export async function fetchBrands(
  search?: string,
  opts?: { forceNetwork?: boolean },
): Promise<Brand[]> {
  if (!opts?.forceNetwork) {
    try {
      const { hasSqliteBridge } = await import('../offline/sqliteApi');
      const { readSqliteBrands } = await import('../offline/localCatalog');
      if (hasSqliteBridge()) {
        const local = (await readSqliteBrands()) as Brand[];
        const q = search?.trim().toLowerCase();
        const rows = local.map((row) => normalizeNameMr(row));
        if (!q) return rows;
        return rows.filter((b) => (b.name || '').toLowerCase().includes(q));
      }
    } catch {
      /* fall through */
    }
  }
  const { data } = await api.get('/brands', { params: { search } });
  return ((data.data || []) as Brand[]).map(normalizeNameMr);
}

export async function createBrand(payload: {
  name: string;
  nameMr?: string | null;
  description?: string;
}): Promise<Brand> {
  try {
    const { isFullyLocalMode, localEnqueueSync } = await import('../offline/localApi');
    const { sqliteReplaceCatalog } = await import('../offline/sqliteApi');
    if (isFullyLocalMode()) {
      const id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `brand-${Date.now()}`;
      const brand = {
        id,
        name: payload.name,
        nameMr: payload.nameMr ?? null,
        name_mr: payload.nameMr ?? null,
        description: payload.description,
        status: 'active',
      } as Brand;
      await sqliteReplaceCatalog({ brands: [brand], clearProducts: false });
      await localEnqueueSync({
        entityType: 'brand',
        entityId: id,
        op: 'create',
        payload: brand,
      });
      return brand;
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.post('/brands', payload);
  return data.data;
}

export async function bulkImportBrands(
  rows: Array<{ name: string; description?: string }>,
): Promise<BulkImportSummary> {
  const { data } = await api.post('/brands/bulk-import', { rows });
  return data.data;
}

export async function updateBrand(id: string, payload: {
  name?: string;
  nameMr?: string | null;
  description?: string;
}): Promise<Brand> {
  try {
    const { isFullyLocalMode, localEnqueueSync } = await import('../offline/localApi');
    const { sqliteListBrands, sqliteReplaceCatalog } = await import('../offline/sqliteApi');
    if (isFullyLocalMode()) {
      const existing = ((await sqliteListBrands()) as Brand[]).find((b) => b.id === id);
      const brand = {
        ...(existing || { id, status: 'active' }),
        ...payload,
        id,
        nameMr: payload.nameMr ?? (existing as Brand | undefined)?.nameMr ?? null,
        name_mr: payload.nameMr ?? (existing as any)?.name_mr ?? null,
      } as Brand;
      await sqliteReplaceCatalog({ brands: [brand], clearProducts: false });
      await localEnqueueSync({
        entityType: 'brand',
        entityId: id,
        op: 'update',
        payload: brand,
      });
      return brand;
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.put(`/brands/${id}`, payload);
  return data.data;
}

export async function deleteBrand(id: string) {
  const { data } = await api.delete(`/brands/${id}`);
  return data.data;
}

export async function fetchUnits(): Promise<UnitOfMeasure[]> {
  const { data } = await api.get('/units');
  return data.data;
}

export async function fetchTaxGroups(): Promise<TaxGroup[]> {
  const { data } = await api.get('/tax-groups');
  return data.data;
}

export async function fetchProducts(params?: {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
  brandId?: string;
  status?: string;
  /** Billing catalog: smaller JSON (no brand/tax). */
  view?: 'pos' | 'full';
  /** Skip writing AsyncStorage (caller writes once after full download). */
  skipCacheWrite?: boolean;
}): Promise<Paginated<Product>> {
  const page = params?.page || 1;
  const pageLimit = params?.limit || 200;

  try {
    const { shouldUseLocalCatalog } = await import('../offline/localCatalog');
    const { sqliteListProducts } = await import('../offline/sqliteApi');
    if (shouldUseLocalCatalog()) {
      const search = String(params?.search || '').trim();
      const listed = await sqliteListProducts({
        search: search || undefined,
        categoryId: params?.categoryId || null,
        limit: pageLimit,
        offset: (page - 1) * pageLimit,
      });
      let items = (listed.items || []) as Product[];
      if (params?.brandId) {
        items = items.filter(
          (p) => (p as any).brandId === params.brandId || (p as any).brand_id === params.brandId,
        );
      }
      if (params?.status) {
        items = items.filter((p) => String(p.status || 'active') === params.status);
      }
      const total = Number(listed.total) || items.length + (page - 1) * pageLimit;
      return {
        items,
        pagination: {
          page,
          limit: pageLimit,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageLimit) || 1),
        },
      };
    }
  } catch {
    /* fall through to API */
  }

  const { data } = await api.get('/products', {
    params: {
      page,
      limit: pageLimit,
      search: params?.search,
      categoryId: params?.categoryId,
      brandId: params?.brandId,
      status: params?.status,
      view: params?.view,
    },
  });
  const result = data.data as Paginated<Product>;
  // Only the full unfiltered catalog may replace/merge the disk cache.
  // List/Price Management page-size browses must not wipe Billing's cached catalog.
  if (
    !params?.skipCacheWrite
    && isCatalogCacheEnabled()
    && !params?.search?.trim()
    && !params?.categoryId
    && !params?.brandId
    && !params?.status
    && pageLimit >= 200
    && result?.items?.length
  ) {
    const total = result.pagination?.total ?? result.items.length;
    void writeCachedProducts(result.items, total, page <= 1 ? 'replace' : 'merge');
  }
  return result;
}

function productsHaveNestedVariants(items: Product[]): boolean {
  return items.some((p) => (p.variants || []).some((v) => !!v?.id));
}

/** Load every matching product by paging past the API page cap. */
export async function fetchAllProducts(params?: {
  search?: string;
  categoryId?: string;
  brandId?: string;
  status?: string;
  /** Called after each page with the accumulated product list (favorites first). */
  onPage?: (products: Product[], loaded: number, total: number) => void;
}): Promise<Product[]> {
  // Smaller pages on native — big JSON payloads OOM / timeout on phones.
  const pageSize = 200;
  const all: Product[] = [];
  let page = 1;
  let totalPages = 1;
  let total = 0;
  // Prefer lean POS payload; fall back to full list if variants are missing (older API).
  let view: 'pos' | 'full' = 'pos';

  const emit = () => {
    const sorted = sortFavoritesFirst(all);
    params?.onPage?.(sorted, all.length, total || all.length);
    return sorted;
  };

  for (;;) {
    try {
      const result = await fetchProducts({
        page,
        limit: pageSize,
        search: params?.search,
        categoryId: params?.categoryId,
        brandId: params?.brandId,
        status: params?.status,
        view: view === 'pos' ? 'pos' : undefined,
        skipCacheWrite: true,
      });
      const items = result?.items || [];
      const reportedTotal = result?.pagination?.total ?? 0;

      // Lean POS empty/broken on first page → same path Product List uses (full payload).
      if (
        page === 1
        && view === 'pos'
        && (
          (items.length > 0 && !productsHaveNestedVariants(items))
          || (!items.length && reportedTotal > 0)
        )
      ) {
        view = 'full';
        continue;
      }

      all.push(...items);
      total = reportedTotal || all.length;
      totalPages = result?.pagination?.totalPages || 1;
      emit();
      if (page >= totalPages || items.length < pageSize) break;
      page += 1;
      if (page > 500) break;
    } catch (err) {
      // First-page lean failure → retry full list (matches Product screen).
      if (page === 1 && view === 'pos' && !all.length) {
        view = 'full';
        continue;
      }
      // Keep what we already downloaded so Billing is not empty after a late-page failure.
      if (all.length) {
        emit();
        break;
      }
      throw err;
    }
  }
  return sortFavoritesFirst(all);
}
export async function fetchProduct(id: string): Promise<Product> {
  const { shouldUseLocalCatalog } = await import('../offline/localCatalog');
  if (shouldUseLocalCatalog()) {
    const { sqliteGetProduct } = await import('../offline/sqliteApi');
    const local = await sqliteGetProduct(id);
    if (local) return local as Product;
    // Desktop local mode: never fall back to live — server stock is often stale/negative.
    const cached = await readCachedProducts();
    const hit = cached?.items?.find((p) => p.id === id);
    if (hit) return hit;
    throw new Error('Product not found in local catalog');
  }
  const { data } = await api.get(`/products/${id}`);
  return data.data;
}

export function isProductFavorite(product: { is_favorite?: boolean | null; isFavorite?: boolean | null } | null | undefined) {
  return !!(product?.is_favorite ?? product?.isFavorite);
}

/** Shared collator — building one per localeCompare call is expensive on Hermes. */
const NAME_COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base' });

/** Favorites first, then name. */
export function sortFavoritesFirst<T extends {
  name?: string | null;
  productName?: string | null;
  is_favorite?: boolean | null;
  isFavorite?: boolean | null;
}>(items: T[]): T[] {
  if (items.length < 2) return items;
  return [...items].sort((a, b) => {
    const af = isProductFavorite(a);
    const bf = isProductFavorite(b);
    if (af !== bf) return af ? -1 : 1;
    return NAME_COLLATOR.compare(
      String(a.name || a.productName || ''),
      String(b.name || b.productName || ''),
    );
  });
}

export async function setProductFavorite(id: string, isFavorite: boolean): Promise<{ id: string; isFavorite: boolean }> {
  const { data } = await api.put(`/products/${id}/favorite`, { isFavorite });
  const row = data.data || {};
  const next = !!(row.isFavorite ?? row.is_favorite ?? isFavorite);
  void patchCachedProductFavorite(id, next);
  return {
    id: row.id || id,
    isFavorite: next,
  };
}

/** Favorite / unfavorite every product in a category (optionally also brand). */
export async function setProductsFavoriteBulk(params: {
  categoryId: string;
  brandId?: string | null;
  isFavorite: boolean;
}): Promise<{ updated: number; isFavorite: boolean }> {
  const { data } = await api.post('/products/favorites/bulk', {
    categoryId: params.categoryId,
    brandId: params.brandId || undefined,
    isFavorite: params.isFavorite,
  });
  const row = data.data || {};
  const next = !!(row.isFavorite ?? params.isFavorite);
  void patchCachedProductsFavoriteByCategory(params.categoryId, next);
  return {
    updated: Number(row.updated) || 0,
    isFavorite: next,
  };
}

export interface GeneratedBarcode {
  variantId: string;
  barcode: string;
  /** False when the variant already had a barcode (it is returned unchanged). */
  generated: boolean;
}

export type VariantBarcodeStatusKind = 'available' | 'missing' | 'duplicate';

export interface QuantityBarcodeStatus {
  quantity: number;
  barcode?: string | null;
  barcodeType?: 'ean13' | 'code128' | 'other' | null;
  status: VariantBarcodeStatusKind;
}

export interface VariantBarcodeStatus {
  variantId: string;
  sku: string;
  size?: string | null;
  color?: string | null;
  mrp?: number | null;
  sellingPrice: number;
  costPrice?: number;
  barcode?: string | null;
  barcodeType?: 'ean13' | 'code128' | 'other' | null;
  status: VariantBarcodeStatusKind;
  stockQty?: number | null;
  /** Extra plain barcodes for the same variant (not pack/qty codes). */
  alternateBarcodes?: Array<{
    barcode?: string | null;
    barcodeType?: 'ean13' | 'code128' | 'other' | null;
    status: VariantBarcodeStatusKind;
  }>;
  quantityBarcodes?: QuantityBarcodeStatus[];
}

export interface ProductBarcodeStatus {
  productId: string;
  productName: string;
  hasVariants: boolean;
  uom?: { code: string; name?: string; type?: 'count' | 'weight' | 'volume' | 'length' } | null;
  variants: VariantBarcodeStatus[];
}

/** Assigns a number-only EAN-13 to each listed variant that has none. Replaces letter barcodes (KDSPOZ…). Never overwrites manufacturer barcodes. */
export async function generateBarcodes(variantIds: string[]): Promise<GeneratedBarcode[]> {
  const { data } = await api.post('/products/barcodes/generate', { variantIds });
  return data.data;
}

/** Active variants + Available / Missing / Duplicate barcode status. Does not generate. */
export async function fetchProductBarcodeStatus(productId: string): Promise<ProductBarcodeStatus> {
  const { data } = await api.get(`/products/${productId}/barcode-status`);
  return data.data;
}

/** Reuses or creates the barcode that stands for each variant + quantity. */
export async function ensureQuantityBarcodes(
  items: { variantId: string; quantity: number }[],
): Promise<{ variantId: string; quantity: number; barcode: string; generated: boolean }[]> {
  const { data } = await api.post('/products/barcodes/quantity', { items });
  return data.data;
}

export async function createProduct(
  payload: CreateProductPayload,
  opts?: { forceNetwork?: boolean },
): Promise<Product> {
  if (!opts?.forceNetwork) {
    try {
      const { isFullyLocalMode, localUpsertProduct, localEnqueueSync } = await import(
        '../offline/localApi'
      );
      if (isFullyLocalMode()) {
        const id =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `prod-${Date.now()}`;
        const variantId =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `var-${Date.now()}`;
        const product = {
          id,
          name: payload.name,
          name_mr: payload.nameMr ?? null,
          category_id: payload.categoryId,
          brand_id: payload.brandId,
          uom_id: payload.uomId,
          status: 'active',
          is_favorite: false,
          variants: (payload.variants || []).map((v, idx) => ({
            id: v.id || `${variantId}-${idx}`,
            sku: v.sku || '',
            barcode: v.barcode,
            barcodes: v.barcodes,
            selling_price: v.sellingPrice,
            cost_price: v.costPrice || 0,
            mrp: v.mrp,
            stock_qty: v.stockQty || 0,
            sellingPrice: v.sellingPrice,
            costPrice: v.costPrice || 0,
            stockQty: v.stockQty || 0,
          })),
          sync_status: 'pending',
        } as Product;
        if (!product.variants?.length) {
          product.variants = [
            {
              id: variantId,
              sku: payload.sku || '',
              barcode: payload.barcode,
              selling_price: payload.sellingPrice,
              cost_price: payload.costPrice || 0,
              mrp: payload.mrp,
              stock_qty: payload.stockQty || 0,
              sellingPrice: payload.sellingPrice,
              costPrice: payload.costPrice || 0,
              stockQty: payload.stockQty || 0,
            } as any,
          ];
        }
        await localUpsertProduct(product);
        await localEnqueueSync({
          entityType: 'product',
          entityId: id,
          op: 'create',
          payload,
        });
        void upsertCachedProduct(product);
        return product;
      }
    } catch {
      /* fall through */
    }
  }
  const { data } = await api.post('/products', payload);
  const product = data.data as Product;
  void upsertCachedProduct(product);
  return product;
}

export async function updateProduct(
  id: string,
  payload: UpdateProductPayload,
  opts?: { forceNetwork?: boolean },
): Promise<Product> {
  if (!opts?.forceNetwork) {
    try {
      const { isFullyLocalMode, localUpsertProduct, localEnqueueSync } = await import(
        '../offline/localApi'
      );
      const { sqliteListProducts } = await import('../offline/sqliteApi');
      if (isFullyLocalMode()) {
        const listed = await sqliteListProducts({ search: '', limit: 1, offset: 0 });
        // Prefer reading via search by loading all is heavy; store merge from payload + id.
        const product = {
          id,
          name: payload.name,
          name_mr: payload.nameMr,
          category_id: payload.categoryId,
          brand_id: payload.brandId,
          status: 'active',
          ...payload,
          variants: (payload as any).variants,
          sync_status: 'pending',
        } as Product;
        // If variants missing, keep existing from a targeted list search by name.
        if (!product.variants?.length && payload.name) {
          const found = await sqliteListProducts({ search: payload.name, limit: 20, offset: 0 });
          const prev = (found.items || []).find((p: any) => p?.id === id) as Product | undefined;
          if (prev) Object.assign(product, prev, { ...payload, id, sync_status: 'pending' });
        }
        void listed;
        await localUpsertProduct(product);
        await localEnqueueSync({
          entityType: 'product',
          entityId: id,
          op: 'update',
          payload: { id, ...payload },
        });
        void upsertCachedProduct(product);
        return product;
      }
    } catch {
      /* fall through */
    }
  }
  const { data } = await api.put(`/products/${id}`, payload);
  const product = data.data as Product;
  // Patch cache + notify Billing — avoid wiping cache / full catalog reload.
  void upsertCachedProduct(product);
  return product;
}

export async function deleteProduct(id: string, opts?: { forceNetwork?: boolean }) {
  if (!opts?.forceNetwork) {
    try {
      const { isFullyLocalMode, localDeleteProduct, localEnqueueSync } = await import(
        '../offline/localApi'
      );
      if (isFullyLocalMode()) {
        await localDeleteProduct(id);
        await localEnqueueSync({
          entityType: 'product',
          entityId: id,
          op: 'delete',
          payload: { id },
        });
        void invalidateCachedProducts();
        return { deleted: true };
      }
    } catch {
      /* fall through */
    }
  }
  const { data } = await api.delete(`/products/${id}`);
  void invalidateCachedProducts();
  return data.data as { deleted: boolean };
}

export async function deleteAllProducts() {
  const { data } = await api.post('/products/delete-all');
  void invalidateCatalogCache();
  return data.data as { deleted: number };
}

export type PriceBulkItem = {
  variantId: string;
  productId?: string;
  name?: string;
  nameMr?: string | null;
  sellingPrice?: number;
  costPrice?: number;
  mrp?: number | null;
  barcode?: string;
  /** All plain barcodes (first = primary). Prefer over single barcode when set. */
  barcodes?: string[];
  stockQty?: number;
};

/**
 * Prefer dedicated bulk route. If production API is older (404 Route not found),
 * fall back to per-product PUT which already exists on live servers.
 */
export async function bulkUpdateVariantPricing(items: PriceBulkItem[]) {
  const publishPricePatches = () => applyCatalogPricePatches(
    (items || []).map((row) => ({
      variantId: row.variantId,
      productId: row.productId,
      sellingPrice: row.sellingPrice,
      costPrice: row.costPrice,
      mrp: row.mrp,
      name: row.name,
      nameMr: row.nameMr,
      stockQty: row.stockQty,
    })),
  );

  try {
    const { data } = await api.post('/products/price-bulk', { items });
    // Notify Billing immediately (bump is sync inside applyCatalogPricePatches).
    await publishPricePatches();
    return data.data as { updated: number };
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    const code = apiErrorCode(err);
    const missingRoute = status === 404 || code === 'NOT_FOUND';
    if (!missingRoute) throw err;

    for (const row of items) {
      const productId = row.productId;
      if (!productId) {
        throw new Error('productId is required when using the price-save fallback.');
      }
      await updateProduct(productId, {
        name: row.name,
        nameMr: row.nameMr,
        variantId: row.variantId,
        sellingPrice: row.sellingPrice,
        costPrice: row.costPrice,
        mrp: row.mrp ?? undefined,
        barcode: row.barcode,
        barcodes: row.barcodes,
        variantSyncMode: 'append',
        variants: [
          {
            id: row.variantId,
            sellingPrice: row.sellingPrice ?? 0,
            costPrice: row.costPrice,
            mrp: row.mrp ?? undefined,
            barcode: row.barcode,
            barcodes: row.barcodes,
            stockQty: row.stockQty,
          },
        ],
      });
    }
    // updateProduct already upserted; publish patches so Billing gets the exact edited prices.
    await publishPricePatches();
    return { updated: items.length };
  }
}

export async function searchProducts(q: string, opts?: { categoryId?: string | null }) {
  const { searchSqliteProducts, shouldUseLocalCatalog } = await import('../offline/localCatalog');

  // Desktop local-first: search SQLite only (server updates come via Sync).
  if (shouldUseLocalCatalog()) {
    return searchSqliteProducts(q, opts);
  }

  try {
    const { data } = await api.get('/products/search', {
      params: {
        q,
        ...(opts?.categoryId ? { categoryId: opts.categoryId } : {}),
      },
    });
    return (data.data || []) as SearchProductResult[];
  } catch (err) {
    const local = await searchSqliteProducts(q, opts);
    if (local.length) return local;
    throw err;
  }
}

export interface SearchProductResult {
  variantId: string;
  productId: string;
  productName: string;
  productNameMr?: string | null;
  isFavorite?: boolean;
  sku: string;
  size?: string | null;
  color?: string | null;
  sellingPrice: number;
  costPrice?: number;
  mrp?: number | null;
  barcodes?: string[];
  quantityBarcodes?: { barcode: string; quantity: number }[];
  /** Set when the search was an exact scan of a quantity barcode: add this quantity without asking. */
  scannedQuantity?: number | null;
  uom?: { code: string; name?: string; type?: 'count' | 'weight' | 'volume' | 'length' } | null;
  isWeightBased?: boolean;
  allowDecimalQty?: boolean;
  stockQty?: number;
  categoryId?: string | null;
  categoryName?: string | null;
}

/** Primary first, then plain barcodes, then quantity barcodes. */
export function sortedBarcodes(variant: ProductVariant) {
  const rank = (b: NonNullable<ProductVariant['barcodes']>[number]) =>
    b.is_primary ? 0 : b.quantity == null ? 1 : 2;
  return [...(variant.barcodes || [])].sort((a, b) => rank(a) - rank(b));
}

/** The variant's main barcode (never a quantity barcode). */
export function mainBarcodeOf(variant: ProductVariant): string {
  return plainBarcodesOf(variant)[0] || '';
}

/** Plain (non-pack) barcodes only — primary first. */
export function plainBarcodesOf(variant: ProductVariant): string[] {
  return sortedBarcodes(variant)
    .filter((b) => b.quantity == null)
    .map((b) => b.barcode)
    .filter(Boolean);
}

export function quantityBarcodesOf(variant: ProductVariant): { barcode: string; quantity: number }[] {
  return (variant.barcodes || [])
    .filter((b) => b.quantity != null)
    .map((b) => ({ barcode: b.barcode, quantity: parseFloat(String(b.quantity)) }))
    .filter((b) => b.quantity > 0)
    .sort((a, b) => a.quantity - b.quantity);
}

/**
 * Exact barcode match. A quantity barcode sets `scannedQuantity` so each scan
 * adds that amount to the bill line.
 */
export function matchBarcodeProduct(
  products: SearchProductResult[],
  code: string,
): SearchProductResult | null {
  const trimmed = code.trim().toLowerCase();
  if (!trimmed) return null;
  const product = products.find(
    (p) =>
      (p.barcodes || []).some((b) => b.toLowerCase() === trimmed) ||
      (p.quantityBarcodes || []).some((b) => b.barcode.toLowerCase() === trimmed),
  );
  if (!product) return null;
  const hit = product.quantityBarcodes?.find((b) => b.barcode.toLowerCase() === trimmed);
  if (hit && hit.quantity > 0) return { ...product, scannedQuantity: hit.quantity };
  return product;
}

function readVariantMoney(
  variant: ProductVariant & { sellingPrice?: string | number; costPrice?: string | number },
  field: 'selling' | 'cost' | 'mrp',
): number | null {
  const raw = field === 'selling'
    ? (variant.selling_price ?? variant.sellingPrice)
    : field === 'cost'
      ? (variant.cost_price ?? variant.costPrice)
      : variant.mrp;
  if (raw === undefined || raw === null || raw === '') return null;
  const n = parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

export function productVariantToSearchResult(
  product: Product,
  variant: ProductVariant,
): SearchProductResult {
  const selling = readVariantMoney(variant, 'selling');
  const cost = readVariantMoney(variant, 'cost');
  const mrp = readVariantMoney(variant, 'mrp');
  return {
    variantId: variant.id,
    productId: product.id,
    productName: product.name,
    productNameMr: product.name_mr || null,
    isFavorite: isProductFavorite(product),
    sku: variant.sku,
    size: variant.size,
    color: variant.color,
    // Prefer real prices; never coerce a missing field into a sticky ₹0 tile.
    sellingPrice: selling ?? 0,
    costPrice: cost ?? 0,
    mrp,
    barcodes: plainBarcodesOf(variant),
    quantityBarcodes: quantityBarcodesOf(variant),
    uom: product.uom
      ? { code: product.uom.code, name: product.uom.name, type: product.uom.type }
      : null,
    isWeightBased: product.is_weight_based,
    allowDecimalQty: product.allow_decimal_qty,
    stockQty: Number(
      (variant as { stockQty?: number; stock_qty?: number }).stockQty
        ?? (variant as { stock_qty?: number }).stock_qty
    ) || 0,
    categoryId: product.category_id || product.category?.id || null,
    categoryName: product.category?.name || null,
  };
}

export function flattenProductsToVariants(
  products: Product[],
  opts?: { alreadySorted?: boolean },
): SearchProductResult[] {
  const ordered = opts?.alreadySorted ? products : sortFavoritesFirst(products);
  const out: SearchProductResult[] = [];
  for (const product of ordered) {
    for (const variant of product.variants || []) {
      if (!variant?.id) continue;
      out.push(productVariantToSearchResult(product, variant));
    }
  }
  return out;
}

export async function bulkImportProducts(rows: Record<string, unknown>[]) {
  const { data } = await api.post('/products/bulk-import', { rows });
  return data.data;
}

export type MasterCatalogProduct = {
  id: string;
  name: string;
  nameMr?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  brandName?: string | null;
  businessTypeId?: string;
  businessTypeName?: string | null;
  sellingPrice?: number;
  mrp?: number | null;
  variants?: Array<{ size?: string | null; barcodes?: string[]; sellingPrice?: number; mrp?: number | null }>;
};

export async function fetchMasterCatalogBusinessTypes() {
  const { data } = await api.get('/master-catalog/business-types');
  return (data.data || []).map((t: {
    id: string;
    name: string;
    productCount?: number;
    isTenantDefault?: boolean;
  }) => ({
    id: t.id,
    name: t.name,
    productCount: t.productCount || 0,
    isTenantDefault: !!t.isTenantDefault,
  }));
}

export async function fetchMasterCatalogCategories(params?: {
  businessTypeId?: string;
}) {
  const { data } = await api.get('/master-catalog/categories', { params });
  return (data.data || []) as Array<{ id: string; name: string }>;
}

export async function fetchMasterCatalogProducts(params?: {
  businessTypeId?: string;
  categoryId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const { data } = await api.get('/master-catalog/products', { params });
  return (data.data || []) as MasterCatalogProduct[];
}

/** Load all matching master products (pages past the old 1000 cap). */
export async function fetchAllMasterCatalogProducts(params?: {
  businessTypeId?: string;
  categoryId?: string;
  search?: string;
  /** Called after each page so the UI can show progress. */
  onPage?: (loaded: number) => void;
}): Promise<MasterCatalogProduct[]> {
  const pageSize = 2000;
  const all: MasterCatalogProduct[] = [];
  let offset = 0;
  for (;;) {
    const chunk = await fetchMasterCatalogProducts({
      businessTypeId: params?.businessTypeId,
      categoryId: params?.categoryId,
      search: params?.search,
      limit: pageSize,
      offset,
    });
    all.push(...chunk);
    params?.onPage?.(all.length);
    if (chunk.length < pageSize) break;
    offset += chunk.length;
    if (offset > 100000) break;
  }
  return all;
}

export async function importFromMasterCatalog(
  masterProductIds: string[],
  branchId?: string,
  options?: { onProgress?: (done: number, total: number) => void },
) {
  // One big POST times out on mobile/proxies; import in small batches.
  const CHUNK = 25;
  const total = masterProductIds.length;
  const totals = {
    imported: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [] as Array<{ name?: string; message?: string; masterProductId?: string }>,
  };

  options?.onProgress?.(0, total);

  for (let offset = 0; offset < total; offset += CHUNK) {
    const chunk = masterProductIds.slice(offset, offset + CHUNK);
    const { data } = await api.post(
      '/products/import-from-master',
      { masterProductIds: chunk, branchId },
      { timeout: 120000 },
    );
    const result = data.data || {};
    totals.imported += result.imported || 0;
    totals.updated += result.updated || 0;
    totals.skipped += result.skipped || 0;
    totals.failed += result.failed || 0;
    if (Array.isArray(result.errors) && result.errors.length) {
      totals.errors.push(...result.errors);
    }
    options?.onProgress?.(Math.min(offset + chunk.length, total), total);
  }

  // Existing products may have new English/Marathi names — drop stale list cache.
  void invalidateCachedProducts();

  return totals;
}
