import api from './api';
import { apiErrorCode } from '../utils/apiError';
import { shouldUseLocalCatalog } from '../offline/localCatalog';
import {
  hasSqliteBridge, sqliteEnsureQuantityBarcodes, sqliteGenerateBarcodes,
  sqliteGetProduct, sqliteGetProductBarcodeStatus, sqliteListProducts,
} from '../offline/sqliteApi';
import {
  isFullyLocalMode, localDeleteAllProducts, localDeleteProductAndQueue, localEnqueueSync,
  localSetProductFavorite, localSetProductsFavoriteBulk, localUpsertProduct, localUpsertProductsAndQueue,
} from '../offline/localApi';
import {
  applyCatalogPricePatches,
  bumpCatalogRevision,
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

/** Keep embedded `uom` in sync with `uom_id` (stale cache often keeps pcs while id is kg). */
export function attachUnitsToProducts(products: Product[], units: UnitOfMeasure[]): Product[] {
  if (!products?.length || !units?.length) return products || [];
  const byId = new Map(units.map((u) => [u.id, u]));
  return products.map((product) => {
    const uomId = product.uom_id || (product as { uomId?: string }).uomId || product.uom?.id || '';
    if (!uomId) return product;
    const unit = byId.get(uomId);
    if (!unit) return product;
    const embedded = product.uom;
    const matches = embedded
      && (embedded.id === unit.id || !embedded.id)
      && String(embedded.code || '').toLowerCase() === String(unit.code || '').toLowerCase()
      && (embedded.type || unit.type) === unit.type;
    if (matches && product.uom_id === unit.id) {
      // Still normalize id onto embedded uom when missing.
      if (embedded && !embedded.id) {
        return { ...product, uom: { ...embedded, id: unit.id, name: unit.name, type: unit.type } };
      }
      return product;
    }
    const isMeasure = unit.type === 'weight' || unit.type === 'volume';
    return {
      ...product,
      uom_id: unit.id,
      uom: {
        id: unit.id,
        code: unit.code,
        name: unit.name,
        type: unit.type,
      },
      // Heal weight/decimal flags when embedded unit was wrong (pcs vs kg).
      is_weight_based: isMeasure,
      allow_decimal_qty: isMeasure || unit.type === 'length',
    };
  });
}

async function resolveUnitById(uomId: string): Promise<UnitOfMeasure | null> {
  if (!uomId) return null;
  try {
    const units = await fetchUnits();
    return units.find((u) => u.id === uomId) || null;
  } catch {
    return null;
  }
}

async function resolveTaxGroupById(taxGroupId: string | null | undefined): Promise<TaxGroup | null> {
  if (!taxGroupId) return null;
  try {
    const groups = await fetchTaxGroups();
    return groups.find((group) => group.id === taxGroupId) || null;
  } catch {
    return null;
  }
}

/** Update the cached unit without writing a potentially stale product to SQLite. */
async function healCachedProductUnits(products: Product[], units: UnitOfMeasure[]): Promise<Product[]> {
  const healed = attachUnitsToProducts(products, units);
  const dirty = healed.filter((next, i) => {
    const prev = products[i];
    return (
      prev?.uom?.code !== next.uom?.code
      || prev?.uom_id !== next.uom_id
      || prev?.is_weight_based !== next.is_weight_based
    );
  });
  if (!dirty.length) return healed;

  try {
    if (isCatalogCacheEnabled()) {
      const cached = await readCachedProducts();
      if (cached?.items?.length) {
        const byId = new Map(dirty.map((p) => [p.id, p]));
        const items = cached.items.map((row) => byId.get(row.id) || row);
        await writeCachedProducts(items, cached.total || items.length, 'replace');
      }
    }
  } catch {
    /* ignore */
  }

  return healed;
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

  try {
    const { isFullyLocalMode } = await import('../offline/localApi');
    const { isOfflineNow } = await import('../offline/connectivityStore');
    if (isFullyLocalMode() || isOfflineNow()) {
      return { ...EMPTY_MASTER_SYNC };
    }
  } catch {
    /* fall through */
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
  try {
    const { isFullyLocalMode, localDeleteCategory, localEnqueueSync } = await import(
      '../offline/localApi'
    );
    if (isFullyLocalMode()) {
      await localDeleteCategory(id);
      await localEnqueueSync({
        entityType: 'category',
        entityId: id,
        op: 'delete',
        payload: { id },
      });
      void invalidateCachedCategories();
      void invalidateCatalogCache();
      return { success: true, id };
    }
  } catch {
    /* fall through */
  }
  try {
    const { data } = await api.delete(`/categories/${id}`);
    void invalidateCachedCategories();
    void invalidateCatalogCache();
    return data.data;
  } catch (err) {
    const { isFullyLocalMode, localDeleteCategory, localEnqueueSync } = await import(
      '../offline/localApi'
    );
    if (isFullyLocalMode()) {
      await localDeleteCategory(id);
      await localEnqueueSync({
        entityType: 'category',
        entityId: id,
        op: 'delete',
        payload: { id },
      });
      void invalidateCachedCategories();
      void invalidateCatalogCache();
      return { success: true, id };
    }
    throw err;
  }
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
  try {
    const { isFullyLocalMode, localDeleteBrand, localEnqueueSync } = await import(
      '../offline/localApi'
    );
    if (isFullyLocalMode()) {
      await localDeleteBrand(id);
      await localEnqueueSync({
        entityType: 'brand',
        entityId: id,
        op: 'delete',
        payload: { id },
      });
      void invalidateCatalogCache();
      return { success: true, id };
    }
  } catch {
    /* fall through */
  }
  try {
    const { data } = await api.delete(`/brands/${id}`);
    void invalidateCatalogCache();
    return data.data;
  } catch (err) {
    const { isFullyLocalMode, localDeleteBrand, localEnqueueSync } = await import(
      '../offline/localApi'
    );
    if (isFullyLocalMode()) {
      await localDeleteBrand(id);
      await localEnqueueSync({
        entityType: 'brand',
        entityId: id,
        op: 'delete',
        payload: { id },
      });
      void invalidateCatalogCache();
      return { success: true, id };
    }
    throw err;
  }
}

export const DEFAULT_OFFLINE_UNITS: UnitOfMeasure[] = [
  { id: 'u-pcs', code: 'pcs', name: 'Pieces', type: 'count' },
  { id: 'u-kg', code: 'kg', name: 'Kilograms', type: 'weight' },
  { id: 'u-g', code: 'g', name: 'Grams', type: 'weight' },
  { id: 'u-l', code: 'l', name: 'Liters', type: 'volume' },
  { id: 'u-ml', code: 'ml', name: 'Milliliters', type: 'volume' },
  { id: 'u-m', code: 'm', name: 'Meters', type: 'length' },
  { id: 'u-box', code: 'box', name: 'Box', type: 'count' },
  { id: 'u-pack', code: 'pack', name: 'Pack', type: 'count' },
];

export async function fetchUnits(): Promise<UnitOfMeasure[]> {
  try {
    const { isFullyLocalMode } = await import('../offline/localApi');
    const { getDesktopBridge } = await import('../desktop/bridge');
    const b = getDesktopBridge();
    if (b?.sqliteListJsonTable) {
      const { useAuthStore } = await import('../store/authStore');
      const shopCode = useAuthStore.getState().savedLogin?.shopCode || 'default';
      const res = await b.sqliteListJsonTable({ shopCode, table: 'units' });
      if (Array.isArray(res?.items) && res.items.length) {
        return res.items as UnitOfMeasure[];
      }
    }
    if (isFullyLocalMode()) {
      return DEFAULT_OFFLINE_UNITS;
    }
  } catch (err) {
    if (isFullyLocalMode()) throw err;
  }
  try {
    const { isOfflineNow } = await import('../offline/connectivityStore');
    if (isOfflineNow()) return DEFAULT_OFFLINE_UNITS;
    const { data } = await api.get('/units');
    return data.data;
  } catch {
    return DEFAULT_OFFLINE_UNITS;
  }
}

export const DEFAULT_OFFLINE_TAX_GROUPS: TaxGroup[] = [
  { id: 'tg-0', name: 'GST 0%', total_rate: 0 },
  { id: 'tg-5', name: 'GST 5%', total_rate: 5 },
  { id: 'tg-12', name: 'GST 12%', total_rate: 12 },
  { id: 'tg-18', name: 'GST 18%', total_rate: 18 },
  { id: 'tg-28', name: 'GST 28%', total_rate: 28 },
];

export async function fetchTaxGroups(): Promise<TaxGroup[]> {
  try {
    const { isFullyLocalMode } = await import('../offline/localApi');
    const { getDesktopBridge } = await import('../desktop/bridge');
    const b = getDesktopBridge();
    if (b?.sqliteListJsonTable) {
      const { useAuthStore } = await import('../store/authStore');
      const shopCode = useAuthStore.getState().savedLogin?.shopCode || 'default';
      const res = await b.sqliteListJsonTable({ shopCode, table: 'tax_groups' });
      if (Array.isArray(res?.items) && res.items.length) {
        return res.items as TaxGroup[];
      }
    }
    if (isFullyLocalMode()) {
      return DEFAULT_OFFLINE_TAX_GROUPS;
    }
  } catch (err) {
    if (isFullyLocalMode()) throw err;
  }
  try {
    const { isOfflineNow } = await import('../offline/connectivityStore');
    if (isOfflineNow()) return DEFAULT_OFFLINE_TAX_GROUPS;
    const { data } = await api.get('/tax-groups');
    return data.data;
  } catch {
    return DEFAULT_OFFLINE_TAX_GROUPS;
  }
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
  /** Force fetching directly from API, bypassing SQLite catalog cache. */
  forceNetwork?: boolean;
}): Promise<Paginated<Product>> {
  const page = params?.page || 1;
  const pageLimit = params?.limit || 200;

  if (!params?.forceNetwork && shouldUseLocalCatalog()) {
      const search = String(params?.search || '').trim();
      const listed = await sqliteListProducts({
        search: search || undefined,
        categoryId: params?.categoryId || null,
        brandId: params?.brandId || null,
        status: params?.status,
        limit: pageLimit,
        offset: (page - 1) * pageLimit,
      });
      let items = (listed.items || []) as Product[];
      try {
        const units = await fetchUnits();
        if (units.length) {
          items = await healCachedProductUnits(items, units);
        }
      } catch {
        /* keep raw items */
      }
      const total = Number(listed.total);
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
  // Normalize both `{ items, pagination }` and rare array / double-wrapped shapes.
  const raw = data?.data ?? data;
  const items: Product[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.items)
      ? raw.items
      : Array.isArray(raw?.data?.items)
        ? raw.data.items
        : [];
  const pagination = (!Array.isArray(raw) && raw?.pagination) || {
    page,
    limit: pageLimit,
    total: items.length,
    totalPages: 1,
  };
  const result: Paginated<Product> = { items, pagination };
  // Only the full unfiltered catalog may replace/merge the disk cache.
  // List/Price Management page-size browses must not wipe Billing's cached catalog.
  // Sync pulls pass skipCacheWrite and write once after the full download.
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
  forceNetwork?: boolean;
  /**
   * Desktop sync should use the full product payload so brand/uom/variants are complete.
   * Billing/mobile can keep the lean POS pages.
   */
  preferFull?: boolean;
  /** Fail instead of returning a partial catalog during a sync pull. */
  requireComplete?: boolean;
  /** Called after each page with the accumulated product list (favorites first). */
  onPage?: (products: Product[], loaded: number, total: number) => void;
}): Promise<Product[]> {
  // Keep pages moderate — full product payloads are heavy; still page until done.
  const pageSize = 200;
  const byId = new Map<string, Product>();
  let page = 1;
  let totalPages = 1;
  let total = 0;
  // Prefer lean POS payload; fall back to full list if variants are missing (older API).
  // Sync pulls start on full so mobile-created products are not dropped by lean quirks.
  let view: 'pos' | 'full' = params?.preferFull ? 'full' : 'pos';

  const snapshot = () => sortFavoritesFirst([...byId.values()]);

  const emit = () => {
    const sorted = snapshot();
    params?.onPage?.(sorted, byId.size, total || byId.size);
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
        forceNetwork: params?.forceNetwork,
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

      for (const row of items) {
        if (row?.id) byId.set(String(row.id), row);
      }
      total = reportedTotal || byId.size;
      const serverLimit = Number(result?.pagination?.limit) || pageSize;
      totalPages = Number(result?.pagination?.totalPages)
        || Math.max(1, Math.ceil(total / serverLimit));
      emit();
      // Stop only when the server says we're past the last page, or this page was empty.
      // Do NOT stop solely because items.length < pageSize — server may clamp the limit.
      if (page >= totalPages) break;
      if (items.length === 0) {
        if (params?.requireComplete) throw new Error('Product download ended before the last page');
        break;
      }
      page += 1;
      if (page > 500) {
        if (params?.requireComplete) throw new Error('Product download exceeds the page limit');
        break;
      }
    } catch (err) {
      // First-page lean failure → retry full list (matches Product screen).
      if (page === 1 && view === 'pos' && !byId.size) {
        view = 'full';
        continue;
      }
      // Keep what we already downloaded so Billing is not empty after a late-page failure.
      if (byId.size && !params?.requireComplete) {
        emit();
        break;
      }
      throw err;
    }
  }
  return snapshot();
}
export async function fetchProduct(
  id: string,
  options?: { forceNetwork?: boolean },
): Promise<Product> {
  const healOne = async (product: Product): Promise<Product> => {
    try {
      const units = await fetchUnits();
      if (!units.length) return product;
      const [healed] = await healCachedProductUnits([product], units);
      return healed || product;
    } catch {
      return product;
    }
  };

  if (!options?.forceNetwork && shouldUseLocalCatalog()) {
    const local = await sqliteGetProduct(id);
    if (!local) throw new Error('Product not found in local database');
    return healOne(local as Product);
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
  if (isFullyLocalMode()) {
      await localSetProductFavorite(id, isFavorite);
      void patchCachedProductFavorite(id, isFavorite);
      await localEnqueueSync({
        entityType: 'product',
        entityId: id,
        op: 'favorite',
        payload: { isFavorite },
      });
      bumpCatalogRevision();
      return { id, isFavorite };
  }
  try {
    const { data } = await api.put(`/products/${id}/favorite`, { isFavorite });
    const row = data.data || {};
    const next = !!(row.isFavorite ?? row.is_favorite ?? isFavorite);
    void patchCachedProductFavorite(id, next);
    return {
      id: row.id || id,
      isFavorite: next,
    };
  } catch (err) {
    throw err;
  }
}

/** Favorite / unfavorite every product in a category (optionally also brand). */
export async function setProductsFavoriteBulk(params: {
  categoryId: string;
  brandId?: string | null;
  isFavorite: boolean;
}): Promise<{ updated: number; isFavorite: boolean }> {
  if (isFullyLocalMode()) {
      const res = (await localSetProductsFavoriteBulk(params)) as { updated?: number } | null;
      void patchCachedProductsFavoriteByCategory(params.categoryId, params.isFavorite);
      await localEnqueueSync({
        entityType: 'product_favorites_bulk',
        entityId: `fav-bulk-${Date.now()}`,
        op: 'update',
        payload: params,
      });
      bumpCatalogRevision();
      return {
        updated: Number(res?.updated) || 0,
        isFavorite: params.isFavorite,
      };
  }
  try {
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
  } catch (err) {
    throw err;
  }
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

function computeEan13CheckDigit(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

function checkValidEan13(value: string): boolean {
  const code = String(value || '').trim();
  if (!/^\d{13}$/.test(code)) return false;
  return computeEan13CheckDigit(code.slice(0, 12)) === code[12];
}

function generateRandomEan13(): string {
  let body = '20';
  while (body.length < 12) body += String(Math.floor(Math.random() * 10));
  return body + computeEan13CheckDigit(body);
}

function classifyLocalBarcodeType(value: string): 'ean13' | 'code128' | 'other' {
  const code = String(value || '').trim().toUpperCase();
  if (checkValidEan13(code)) return 'ean13';
  if (code.startsWith('KDSPOZ') && code.length >= 14) return 'code128';
  return 'other';
}

async function buildLocalBarcodeStatus(productId: string): Promise<ProductBarcodeStatus | null> {
  try {
    const product = await fetchProduct(productId);
    if (!product || !product.id) return null;

    const variants = product.variants || [];
    const hasVariants = Boolean(
      product.hasVariants || (product as any).has_variants || variants.length > 1 || variants.some((v) => Boolean(v.size || v.color))
    );

    const resultVariants: VariantBarcodeStatus[] = variants.map((v) => {
      const plainCodes = (v.barcodes || []).map((b) => (typeof b === 'string' ? b : (b as any)?.barcode || '')).filter(Boolean);
      const primaryCode = v.barcode || plainCodes[0] || null;
      const primaryType = primaryCode ? classifyLocalBarcodeType(primaryCode) : null;
      const status: VariantBarcodeStatusKind = primaryCode ? 'available' : 'missing';

      const alternateBarcodes = plainCodes
        .filter((code) => code !== primaryCode)
        .map((code) => ({
          barcode: code,
          barcodeType: classifyLocalBarcodeType(code),
          status: 'available' as VariantBarcodeStatusKind,
        }));

      const quantityBarcodes: QuantityBarcodeStatus[] = ((v as any).quantityBarcodes || []).map((qb: any) => ({
        quantity: Number(qb.quantity),
        barcode: qb.barcode || null,
        barcodeType: qb.barcode ? classifyLocalBarcodeType(qb.barcode) : null,
        status: qb.barcode ? ('available' as VariantBarcodeStatusKind) : ('missing' as VariantBarcodeStatusKind),
      }));

      return {
        variantId: v.id,
        sku: v.sku || '',
        size: v.size || null,
        color: v.color || null,
        mrp: v.mrp != null ? Number(v.mrp) : null,
        sellingPrice: Number(v.sellingPrice ?? (v as any).selling_price) || 0,
        costPrice: Number(v.costPrice ?? (v as any).cost_price) || 0,
        barcode: primaryCode,
        barcodeType: primaryType,
        status,
        stockQty: v.stockQty ?? (v as any).stock_qty ?? null,
        alternateBarcodes,
        quantityBarcodes,
      };
    });

    return {
      productId: product.id,
      productName: product.name,
      hasVariants,
      uom: (product as any).uom || null,
      variants: resultVariants,
    };
  } catch {
    return null;
  }
}

/** Assigns a number-only EAN-13 to each listed variant that has none. Replaces letter barcodes (KDSPOZ…). Never overwrites manufacturer barcodes. */
export async function generateBarcodes(variantIds: string[]): Promise<GeneratedBarcode[]> {
  if (hasSqliteBridge()) {
    const result = await sqliteGenerateBarcodes(variantIds);
    if (result.some((row) => row.generated)) bumpCatalogRevision();
    return result;
  }

  try {
    const { data } = await api.post('/products/barcodes/generate', { variantIds });
    return data.data;
  } catch (err) {
    if (hasSqliteBridge()) {
      try {
        const localFallback = await sqliteGenerateBarcodes(variantIds);
        if (Array.isArray(localFallback) && localFallback.length) {
          return localFallback;
        }
      } catch {}
    }
    throw err;
  }
}

function sameProductName(a: unknown, b: unknown): boolean {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function codesOnProduct(product: Product): Set<string> {
  const codes = new Set<string>();
  for (const variant of product.variants || []) {
    for (const code of allBarcodesOf(variant)) {
      const key = String(code || '').trim().toLowerCase();
      if (key) codes.add(key);
    }
  }
  return codes;
}

/**
 * Desktop save keeps a local id. Sync creates a different id on the server, and the
 * phone lists that one. Label lookup of the local id is a 404 — find the synced row.
 */
async function syncedTwinProductId(localId: string): Promise<string | null> {
  const { hasSqliteBridge, sqliteGetProduct, sqliteListProducts } = await import('../offline/sqliteApi');
  if (!hasSqliteBridge()) return null;
  const local = (await sqliteGetProduct(localId)) as Product | null;
  if (!local?.name) return null;
  const { items } = await sqliteListProducts({ search: local.name, limit: 40 });
  const localCodes = codesOnProduct(local);
  const others = (items as Product[]).filter(
    (product) => product?.id && product.id !== localId && sameProductName(product.name, local.name),
  );
  if (!others.length) return null;
  if (localCodes.size) {
    const byCode = others.filter((product) =>
      [...codesOnProduct(product)].some((code) => localCodes.has(code)),
    );
    if (byCode.length === 1) return byCode[0].id;
    if (byCode.length > 1) return null;
  }
  const live = others.filter(
    (product) => String((product as { sync_status?: string }).sync_status || '') !== 'pending',
  );
  if (live.length === 1) return live[0].id;
  if (others.length === 1) return others[0].id;
  return null;
}

/** Active variants + Available / Missing / Duplicate barcode status. Does not generate. */
export async function fetchProductBarcodeStatus(productId: string): Promise<ProductBarcodeStatus> {
  if (hasSqliteBridge()) {
    const local = await sqliteGetProductBarcodeStatus(productId);
    if (!local?.productId) throw new Error('Product not found in local database');
    return local as ProductBarcodeStatus;
  }

  const load = async (id: string) => {
    const { data } = await api.get(`/products/${id}/barcode-status`);
    return data.data as ProductBarcodeStatus;
  };
  try {
    return await load(productId);
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404 || !status) {
      const twinId = await syncedTwinProductId(productId).catch(() => null);
      if (twinId && twinId !== productId) {
        try {
          return await load(twinId);
        } catch {}
      }
      const localFallback = await buildLocalBarcodeStatus(productId);
      if (localFallback) {
        return localFallback;
      }
    }
    throw err;
  }
}

/** Reuses or creates the barcode that stands for each variant + quantity. */
export async function ensureQuantityBarcodes(
  items: { variantId: string; quantity: number }[],
): Promise<{ variantId: string; quantity: number; barcode: string; generated: boolean }[]> {
  if (hasSqliteBridge()) {
    const result = await sqliteEnsureQuantityBarcodes(items);
    if (result.some((row) => row.generated)) bumpCatalogRevision();
    return result;
  }

  try {
    const { data } = await api.post('/products/barcodes/quantity', { items });
    return data.data;
  } catch (err) {
    if (hasSqliteBridge()) {
      try {
        const local = await sqliteEnsureQuantityBarcodes(items);
        if (Array.isArray(local) && local.length) {
          return local;
        }
      } catch {}
    }
    throw err;
  }
}

export async function createProduct(
  payload: CreateProductPayload,
): Promise<Product> {
  if (!isFullyLocalMode()) {
    try {
      const { data } = await api.post('/products', payload);
      const product = data.data as Product;
      if (hasSqliteBridge()) {
        try {
          await localUpsertProduct(product);
        } catch {}
      }
      void upsertCachedProduct(product);
      return product;
    } catch (err) {
      if (!hasSqliteBridge()) throw err;
    }
  }

  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `prod-${Date.now()}`;
  const variantId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `var-${Date.now()}`;
  const variants = (payload.variants || []).map((v, idx) => {
    const selling = Number(v.sellingPrice ?? (v as any).selling_price) || 0;
    const cost = Number(v.costPrice ?? (v as any).cost_price) || 0;
    const mrp = v.mrp != null && v.mrp !== '' ? Number(v.mrp) : null;
    const stock = Number(v.stockQty ?? (v as any).stock_qty) || 0;
    const barcode = v.barcode || (v.barcodes?.[0]) || null;
    return {
      ...v,
      id: v.id || `${variantId}-${idx}`,
      sku: v.sku || '',
      barcode,
      barcodes: v.barcodes || (barcode ? [barcode] : []),
      selling_price: selling,
      sellingPrice: selling,
      cost_price: cost,
      costPrice: cost,
      mrp,
      stock_qty: stock,
      stockQty: stock,
    };
  });
  if (!variants.length) {
    const selling = Number(payload.sellingPrice) || 0;
    const cost = Number(payload.costPrice) || 0;
    const mrp = payload.mrp != null && payload.mrp !== '' ? Number(payload.mrp) : null;
    const stock = Number(payload.stockQty) || 0;
    const barcode = payload.barcode || (payload.barcodes?.[0]) || null;
    variants.push({
      id: variantId,
      sku: payload.sku || '',
      barcode,
      barcodes: payload.barcodes || (barcode ? [barcode] : []),
      quantityBarcodes: payload.quantityBarcodes,
      selling_price: selling,
      sellingPrice: selling,
      cost_price: cost,
      costPrice: cost,
      mrp,
      stock_qty: stock,
      stockQty: stock,
    } as any);
  }
  const totalStock = variants.reduce((s, v) => s + (v.stockQty || 0), 0);
  const createdUnit = payload.uomId ? await resolveUnitById(payload.uomId) : null;
  const createdTaxGroup = payload.taxGroupId
    ? await resolveTaxGroupById(payload.taxGroupId)
    : null;
  const product = {
    id,
    name: payload.name,
    name_mr: payload.nameMr ?? null,
    nameMr: payload.nameMr ?? null,
    category_id: payload.categoryId,
    brand_id: payload.brandId,
    uom_id: payload.uomId,
    uom: createdUnit
      ? {
          id: createdUnit.id,
          code: createdUnit.code,
          name: createdUnit.name,
          type: createdUnit.type,
        }
      : undefined,
    tax_group_id: payload.taxGroupId || null,
    taxGroupId: payload.taxGroupId || null,
    tax_code: payload.taxCode || null,
    taxGroup: createdTaxGroup
      ? {
        id: createdTaxGroup.id,
        name: createdTaxGroup.name,
        total_rate: createdTaxGroup.total_rate,
      }
      : undefined,
    status: 'active',
    is_favorite: false,
    is_weight_based: !!payload.isWeightBased,
    allow_decimal_qty: !!payload.allowDecimalQty,
    has_variants: variants.length > 1,
    stockQty: totalStock,
    stock_qty: totalStock,
    variants,
    sync_status: 'pending',
  } as unknown as Product;

  await localUpsertProductsAndQueue([product], {
    entityType: 'product',
    entityId: id,
    op: 'create',
    payload: {
      ...payload,
      localInitialVariantStock: Object.fromEntries(variants.map((v) => [v.id, v.stockQty])),
      localInitialProduct: product,
    },
  });
  void upsertCachedProduct(product);
  return product;
}

export async function updateProduct(
  id: string,
  payload: UpdateProductPayload,
): Promise<Product> {
  if (!isFullyLocalMode()) {
    try {
      const { data } = await api.put(`/products/${id}`, payload);
      const product = data.data as Product;
      if (hasSqliteBridge()) {
        try {
          await localUpsertProduct(product);
        } catch {}
      }
      void upsertCachedProduct(product);
      return product;
    } catch (err) {
      if (!hasSqliteBridge()) throw err;
    }
  }

    const existing = (await sqliteGetProduct(id)) as Product | null;
    if (!existing) throw new Error('Product not found in local database');
    const variantsPayload = payload.variants;
    let queuedVariants: UpdateProductPayload['variants'];
    let nextVariants = existing?.variants || [];
    if (variantsPayload?.length) {
      const patchedVariants = variantsPayload.map((vp) => {
        const existingV = vp.id
          ? (existing.variants || []).find((v) => v.id === vp.id)
          : undefined;
        if (vp.id && !existingV) throw new Error(`Local variant not found: ${vp.id}`);
        if (!vp.id && (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function')) {
          throw new Error('Secure variant IDs are unavailable');
        }
        const selling = Number(vp.sellingPrice ?? existingV?.selling_price) || 0;
        const cost = Number(vp.costPrice ?? existingV?.cost_price) || 0;
        const mrp = vp.mrp !== undefined ? vp.mrp : existingV?.mrp;
        const stockIn = vp.stockQty;
        const stock = (stockIn !== undefined && stockIn !== null)
          ? Number(stockIn)
          : Number(existingV?.stockQty) || 0;
        const barcode = vp.barcode !== undefined ? vp.barcode : existingV?.barcode;
        const barcodes = vp.barcodes !== undefined
          ? vp.barcodes.map((code, index) => ({ barcode: code, is_primary: index === 0 }))
          : existingV?.barcodes;
        return {
          ...(existingV || {}),
          ...vp,
          id: vp.id || crypto.randomUUID(),
          sku: vp.sku || existingV?.sku || '',
          barcode: barcode || undefined,
          barcodes: barcodes || (barcode ? [{ barcode, is_primary: true }] : []),
          sellingPrice: selling,
          selling_price: selling,
          costPrice: cost,
          cost_price: cost,
          mrp,
          stockQty: stock,
          stock_qty: stock,
        };
      });
      queuedVariants = variantsPayload.map((variant, idx) => {
        const { stockQty, ...fields } = variant;
        return { ...fields, id: patchedVariants[idx].id };
      });
      if (payload.variantSyncMode === 'append') {
        const patchedById = new Map(patchedVariants.map((variant) => [variant.id, variant]));
        nextVariants = (existing.variants || []).map((variant) => patchedById.get(variant.id) || variant);
        const existingIds = new Set((existing.variants || []).map((variant) => variant.id));
        nextVariants.push(...patchedVariants.filter((variant) => !existingIds.has(variant.id)));
      } else {
        nextVariants = patchedVariants;
      }
    }

    const totalStock = nextVariants.reduce((s, v) =>
      s + (Number(v.stockQty ?? (v as ProductVariant & { stock_qty?: number }).stock_qty) || 0), 0);
    const nextUomId = payload.uomId !== undefined ? payload.uomId : (existing?.uom_id || '');
    let nextUom = existing?.uom;
    if (payload.uomId !== undefined && payload.uomId) {
      const unit = await resolveUnitById(payload.uomId);
      if (unit) {
        nextUom = {
          id: unit.id,
          code: unit.code,
          name: unit.name,
          type: unit.type,
        };
      } else if (existing?.uom && existing.uom_id === payload.uomId) {
        nextUom = existing.uom;
      } else {
        nextUom = existing?.uom ? { ...existing.uom, id: payload.uomId } : undefined;
      }
    }
    const nextTaxGroupId = payload.taxGroupId !== undefined
      ? payload.taxGroupId
      : existing?.tax_group_id;
    let nextTaxGroup = existing?.taxGroup;
    if (payload.taxGroupId !== undefined) {
      nextTaxGroup = payload.taxGroupId
        ? await resolveTaxGroupById(payload.taxGroupId) || undefined
        : undefined;
    }
    const merged = {
      ...(existing || { id, status: 'active' }),
      ...payload,
      id,
      name: payload.name !== undefined ? payload.name.trim() : (existing?.name || ''),
      name_mr: payload.nameMr !== undefined ? (payload.nameMr?.trim() || null) : (existing?.name_mr || null),
      nameMr: payload.nameMr !== undefined ? (payload.nameMr?.trim() || null) : (existing?.name_mr || null),
      category_id: payload.categoryId !== undefined ? payload.categoryId : existing?.category_id,
      brand_id: payload.brandId !== undefined ? payload.brandId : existing?.brand_id,
      uom_id: nextUomId,
      uom: nextUom,
      tax_group_id: nextTaxGroupId,
      taxGroupId: nextTaxGroupId,
      tax_code: payload.taxCode !== undefined ? payload.taxCode : existing?.tax_code,
      taxGroup: nextTaxGroup,
      is_weight_based: payload.isWeightBased !== undefined ? payload.isWeightBased : (existing?.is_weight_based || false),
      allow_decimal_qty: payload.allowDecimalQty !== undefined ? payload.allowDecimalQty : (existing?.allow_decimal_qty || false),
      has_variants: nextVariants.length > 1,
      status: payload.status ?? existing?.status ?? 'active',
      stockQty: totalStock,
      stock_qty: totalStock,
      variants: nextVariants,
      sync_status: 'pending',
    } as unknown as Product;

    await localUpsertProductsAndQueue([merged], {
      entityType: 'product',
      entityId: id,
      op: 'update',
      payload: {
        id,
        ...payload,
        ...(queuedVariants ? { variants: queuedVariants } : {}),
        syncEditProtocol: 2,
        syncPreviousProduct: existing,
        syncUpdatedProduct: merged,
      },
    });
    void upsertCachedProduct(merged);
    return merged;
}

export async function deleteProduct(id: string) {
  if (!isFullyLocalMode()) {
    try {
      const { data } = await api.delete(`/products/${id}`);
      void invalidateCachedProducts();
      return data.data as { deleted: boolean };
    } catch (err) {
      if (!hasSqliteBridge()) throw err;
    }
  }

  const result = await localDeleteProductAndQueue(id);
  void invalidateCachedProducts();
  return result;
}

export async function deleteAllProducts() {
  if (isFullyLocalMode()) {
    const result = await localDeleteAllProducts();
    await invalidateCatalogCache();
    return result;
  }
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
  /** Product-level unit of measure. */
  uomId?: string;
  uom?: { id?: string; code: string; name?: string; type?: 'count' | 'weight' | 'volume' | 'length' } | null;
};

/**
 * Prefer dedicated bulk route. If production API is older (404 Route not found),
 * fall back to per-product PUT which already exists on live servers.
 */
export async function syncPriceBulkToSqlite(items: PriceBulkItem[], queue = false): Promise<void> {
    if (!hasSqliteBridge() || !items?.length) return;

    const byProduct = new Map<string, PriceBulkItem[]>();
    const updatedProducts: Product[] = [];
    for (const item of items) {
      if (!item.productId) throw new Error('productId is required to save prices locally');
      const list = byProduct.get(item.productId) || [];
      list.push(item);
      byProduct.set(item.productId, list);
    }

    for (const [productId, productItems] of byProduct) {
      const existing = (await sqliteGetProduct(productId)) as Product | null;
      if (!existing) throw new Error('Product not found in local database');

      const firstItem = productItems[0];
      const nextName = firstItem.name !== undefined && firstItem.name.trim() !== '' ? firstItem.name.trim() : existing.name;
      const nextNameMr = firstItem.nameMr !== undefined ? (firstItem.nameMr?.trim() || null) : (existing.name_mr || null);
      const uomPatch = productItems.find((it) => it.uomId)?.uomId;
      const uomInfo = productItems.find((it) => it.uom)?.uom;
      const nextUomId = uomPatch || existing.uom_id;
      const nextUom = uomInfo
        ? {
            id: (uomInfo as any).id || nextUomId,
            code: uomInfo.code,
            name: uomInfo.name || uomInfo.code,
            type: uomInfo.type || existing.uom?.type || 'count',
          }
        : existing.uom;
      const isMeasure = nextUom?.type === 'weight' || nextUom?.type === 'volume';

      const itemsByVariant = new Map(productItems.map((it) => [it.variantId, it]));
      for (const item of productItems) {
        if (!(existing.variants || []).some((variant) => variant.id === item.variantId)) {
          throw new Error('Product variant not found in local database');
        }
      }

      const nextVariants = (existing.variants || []).map((v) => {
        const patch = itemsByVariant.get(v.id);
        if (!patch) return v;
        const nextSelling = patch.sellingPrice !== undefined ? patch.sellingPrice : Number(v.selling_price ?? (v as any).sellingPrice) || 0;
        const nextCost = patch.costPrice !== undefined ? patch.costPrice : Number(v.cost_price ?? (v as any).costPrice) || 0;
        const nextMrp = patch.mrp !== undefined ? patch.mrp : v.mrp;
        const nextStock = patch.stockQty !== undefined ? patch.stockQty : Number((v as any).stockQty ?? v.stock_qty) || 0;
        const nextBarcode = patch.barcode !== undefined ? patch.barcode : (v.barcode || null);
        const nextBarcodes = patch.barcodes !== undefined ? patch.barcodes : (v.barcodes || []);
        return {
          ...v,
          sellingPrice: nextSelling,
          selling_price: nextSelling,
          costPrice: nextCost,
          cost_price: nextCost,
          mrp: nextMrp,
          stockQty: nextStock,
          stock_qty: nextStock,
          barcode: nextBarcode,
          barcodes: nextBarcodes,
        };
      });

      const totalStock = nextVariants.reduce((sum, v) => sum + (Number((v as any).stockQty ?? v.stock_qty) || 0), 0);
      const updatedProduct: Product = {
        ...existing,
        name: nextName,
        name_mr: nextNameMr,
        nameMr: nextNameMr,
        uom_id: nextUomId,
        uom: nextUom,
        is_weight_based: uomPatch ? isMeasure : existing.is_weight_based,
        allow_decimal_qty: uomPatch
          ? (isMeasure || nextUom?.type === 'length')
          : existing.allow_decimal_qty,
        stockQty: totalStock,
        stock_qty: totalStock,
        variants: nextVariants,
      };

      updatedProducts.push(updatedProduct);
    }
    if (queue) {
      await localUpsertProductsAndQueue(updatedProducts, {
        entityType: 'price_bulk',
        entityId: `bulk-${Date.now()}`,
        op: 'update',
        payload: { items },
      });
    } else {
      for (const product of updatedProducts) await localUpsertProduct(product);
    }
}

/**
 * Prefer dedicated bulk route. If production API is older (404 Route not found),
 * fall back to per-product PUT which already exists on live servers.
 */
export async function bulkUpdateVariantPricing(items: PriceBulkItem[]) {
  const publishPricePatches = async () => {
    await syncPriceBulkToSqlite(items, isFullyLocalMode());
    await applyCatalogPricePatches(
      (items || []).map((row) => ({
        variantId: row.variantId,
        productId: row.productId,
        sellingPrice: row.sellingPrice,
        costPrice: row.costPrice,
        mrp: row.mrp,
        name: row.name,
        nameMr: row.nameMr,
        stockQty: row.stockQty,
        barcode: row.barcode,
        barcodes: row.barcodes,
        uomId: row.uomId,
        uom: row.uom,
      })),
    );
  };

  if (isFullyLocalMode()) {
      await publishPricePatches();
      return { updated: items.length };
  }

  try {
    const { data } = await api.post('/products/price-bulk', { items });
    // Update SQLite and notify Billing immediately.
    await publishPricePatches();
    return data.data as { updated: number };
  } catch (err) {
    const { hasSqliteBridge } = await import('../offline/sqliteApi');
    const { localEnqueueSync } = await import('../offline/localApi');
    const status = (err as { response?: { status?: number } })?.response?.status;
    const code = apiErrorCode(err);
    const missingRoute = status === 404 || code === 'NOT_FOUND';
    if (!missingRoute) {
      if (hasSqliteBridge()) {
        await publishPricePatches();
        await localEnqueueSync({
          entityType: 'price_bulk',
          entityId: `bulk-${Date.now()}`,
          op: 'update',
          payload: { items },
        });
        return { updated: items.length };
      }
      throw err;
    }

    for (const row of items) {
      const productId = row.productId;
      if (!productId) {
        throw new Error('productId is required when using the price-save fallback.');
      }
      await updateProduct(productId, {
        name: row.name,
        nameMr: row.nameMr,
        uomId: row.uomId,
        isWeightBased: row.uom
          ? (row.uom.type === 'weight' || row.uom.type === 'volume')
          : undefined,
        allowDecimalQty: row.uom
          ? (row.uom.type === 'weight' || row.uom.type === 'volume' || row.uom.type === 'length')
          : undefined,
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
  taxRate?: number;
  taxName?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
}

type NormalizedBarcode = {
  barcode: string;
  is_primary: boolean;
  quantity: number | null;
};

/** Normalize string | object barcodes (and legacy quantityBarcodes) into one list. */
export function normalizedBarcodesOf(
  variant: ProductVariant & {
    barcode?: string | null;
    quantityBarcodes?: Array<{ barcode?: string; quantity?: string | number | null }>;
  },
): NormalizedBarcode[] {
  const out: NormalizedBarcode[] = [];
  const seen = new Set<string>();
  const push = (code: unknown, quantity: unknown, isPrimary: boolean) => {
    const barcode = String(code || '').trim();
    if (!barcode) return;
    const key = barcode.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    let qty: number | null = null;
    if (quantity != null && quantity !== '') {
      const n = parseFloat(String(quantity));
      if (Number.isFinite(n) && n > 0) qty = n;
    }
    out.push({ barcode, is_primary: !!isPrimary, quantity: qty });
  };

  for (const b of variant.barcodes || []) {
    if (typeof b === 'string') {
      push(b, null, out.length === 0);
      continue;
    }
    if (!b || typeof b !== 'object') continue;
    push(
      (b as { barcode?: string; code?: string }).barcode
        || (b as { code?: string }).code,
      (b as { quantity?: string | number | null }).quantity,
      !!(b as { is_primary?: boolean }).is_primary,
    );
  }
  for (const qb of variant.quantityBarcodes || []) {
    push(qb?.barcode, qb?.quantity, false);
  }
  if (variant.barcode) push(variant.barcode, null, true);
  return out;
}

/** Primary first, then plain barcodes, then quantity barcodes. */
export function sortedBarcodes(variant: ProductVariant) {
  const rank = (b: NormalizedBarcode) =>
    b.is_primary ? 0 : b.quantity == null ? 1 : 2;
  return normalizedBarcodesOf(variant).sort((a, b) => rank(a) - rank(b));
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
  return sortedBarcodes(variant)
    .filter((b) => b.quantity != null)
    .map((b) => ({ barcode: b.barcode, quantity: b.quantity as number }))
    .filter((b) => b.quantity > 0)
    .sort((a, b) => a.quantity - b.quantity);
}

/** Every scannable code on a variant (plain + pack). */
export function allBarcodesOf(variant: ProductVariant): string[] {
  return sortedBarcodes(variant).map((b) => b.barcode).filter(Boolean);
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
  const taxGroup =
    product.tax_group_id && product.taxGroup
      ? product.taxGroup
      : variant.taxGroup || product.taxGroup;
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
    taxRate: Number(taxGroup?.total_rate) || 0,
    taxName: taxGroup?.name || null,
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
  if (isFullyLocalMode()) {
    throw new Error('Use master product import on desktop');
  }
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
