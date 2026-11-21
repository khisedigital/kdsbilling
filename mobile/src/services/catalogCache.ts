import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '../store/authStore';
import type { Category, Product } from '../types/catalog';

/**
 * Persist catalog on all platforms so Billing / lists open from disk
 * instead of re-downloading the full catalog on every visit (critical on 4G).
 */
export function isCatalogCacheEnabled(): boolean {
  return true;
}

const PRODUCTS_CAP = 5000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** In-memory stamp so Billing / lists know prices or products changed. */
let catalogRevision = 0;

export type CatalogPricePatch = {
  variantId: string;
  productId?: string;
  sellingPrice?: number;
  costPrice?: number;
  mrp?: number | null;
  name?: string;
  nameMr?: string | null;
  stockQty?: number;
  barcode?: string;
  barcodes?: string[];
};

type CatalogChangeListener = (revision: number, pricePatches: CatalogPricePatch[]) => void;

const catalogListeners = new Set<CatalogChangeListener>();
let lastPricePatches: CatalogPricePatch[] = [];

export function getCatalogRevision(): number {
  return catalogRevision;
}

export function getLastCatalogPricePatches(): CatalogPricePatch[] {
  return lastPricePatches;
}

/** Consume patches once so catalog reloads cannot keep re-applying a stale 0 price. */
export function consumeLastCatalogPricePatches(): CatalogPricePatch[] {
  const patches = lastPricePatches;
  lastPricePatches = [];
  return patches;
}

export function bumpCatalogRevision(pricePatches: CatalogPricePatch[] = []): void {
  catalogRevision += 1;
  // Only replace remembered patches when the caller actually has price edits.
  // Empty bumps (favorite toggle, etc.) must not wipe a pending product-edit patch
  // before Billing has applied it — and must not leave old patches forever either.
  if (pricePatches.length) {
    lastPricePatches = pricePatches;
  }
  catalogListeners.forEach((listener) => {
    try {
      listener(catalogRevision, pricePatches);
    } catch {
      // ignore listener errors
    }
  });
}

/** Live updates for Billing (and others) when prices/catalog change. */
export function subscribeCatalogChanges(listener: CatalogChangeListener): () => void {
  catalogListeners.add(listener);
  return () => {
    catalogListeners.delete(listener);
  };
}

type CategoriesPayload = {
  updatedAt: number;
  items: Category[];
};

type ProductsPayload = {
  updatedAt: number;
  total: number;
  items: Product[];
};

function tenantId(): string {
  return useAuthStore.getState().tenant?.id || 'default';
}

function categoriesKey(id = tenantId()) {
  return `catalog.cache.categories.${id}`;
}

function productsKey(id = tenantId()) {
  return `catalog.cache.products.${id}`;
}

function isFresh(updatedAt: number): boolean {
  return Date.now() - updatedAt < MAX_AGE_MS;
}

/** In-memory parse memo — avoids re-JSON.parse of the full catalog on every screen open. */
const productsMemory = new Map<string, ProductsPayload>();

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    if (key.startsWith('catalog.cache.products.')) {
      productsMemory.set(key, value as ProductsPayload);
    }
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota / private mode — ignore; live API still works.
  }
}

export async function readCachedCategories(): Promise<Category[] | null> {
  if (!isCatalogCacheEnabled()) return null;
  const payload = await readJson<CategoriesPayload>(categoriesKey());
  if (!payload?.items?.length || !isFresh(payload.updatedAt)) return null;
  return payload.items;
}

export async function writeCachedCategories(items: Category[]): Promise<void> {
  if (!isCatalogCacheEnabled()) return;
  await writeJson(categoriesKey(), {
    updatedAt: Date.now(),
    items: items || [],
  } satisfies CategoriesPayload);
  void import('../offline/sqliteApi')
    .then(({ hasSqliteBridge, sqliteReplaceCatalog }) => {
      if (!hasSqliteBridge()) return;
      return sqliteReplaceCatalog({ categories: items || [] });
    })
    .catch(() => null);
}

export async function readCachedProducts(): Promise<{ items: Product[]; total: number; updatedAt: number } | null> {
  if (!isCatalogCacheEnabled()) return null;
  // AsyncStorage / memory only. Do NOT return the Billing favorites SQLite page here —
  // that made Price Management + stock patches think a 280-row OOS slice was the catalog.
  // Billing/Price Management load live stock via sqliteListProducts / getProduct.
  const key = productsKey();
  let payload = productsMemory.get(key) || null;
  if (!payload) {
    payload = await readJson<ProductsPayload>(key);
    if (payload?.items?.length) productsMemory.set(key, payload);
  }
  if (!payload?.items?.length || !isFresh(payload.updatedAt)) return null;
  return {
    items: payload.items,
    total: payload.total || payload.items.length,
    updatedAt: payload.updatedAt,
  };
}

/** Replace or merge products into the desktop cache (uncapped network filter views are not stored). */
export async function writeCachedProducts(
  items: Product[],
  total: number,
  mode: 'replace' | 'merge' = 'replace',
): Promise<void> {
  if (!isCatalogCacheEnabled()) return;
  let next = items || [];
  if (mode === 'merge') {
    const prev = await readCachedProducts();
    if (prev?.items?.length) {
      const map = new Map<string, Product>();
      for (const row of prev.items) map.set(row.id, row);
      for (const row of next) map.set(row.id, row);
      next = [...map.values()];
    }
  }
  // Do not push this cache into SQLite — it is often a partial/stale page and was
  // overwriting local stock display. Catalog sync / product upsert own SQLite writes.
  if (next.length > PRODUCTS_CAP) {
    next = next.slice(0, PRODUCTS_CAP);
  }
  await writeJson(productsKey(), {
    updatedAt: Date.now(),
    total,
    items: next,
  } satisfies ProductsPayload);
}

export async function patchCachedProductFavorite(
  productId: string,
  isFavorite: boolean,
): Promise<void> {
  if (!isCatalogCacheEnabled()) return;
  const prev = await readCachedProducts();
  if (!prev?.items?.length) return;
  let changed = false;
  const items = prev.items.map((row) => {
    if (row.id !== productId) return row;
    changed = true;
    return { ...row, is_favorite: isFavorite, isFavorite };
  });
  if (!changed) return;
  await writeJson(productsKey(), {
    updatedAt: Date.now(),
    total: prev.total,
    items,
  } satisfies ProductsPayload);
}

function variantMoney(
  variant: { selling_price?: string | number; sellingPrice?: string | number; cost_price?: string | number; costPrice?: string | number; mrp?: string | number | null },
  field: 'selling' | 'cost' | 'mrp',
): number | null {
  const raw = field === 'selling'
    ? (variant.selling_price ?? variant.sellingPrice)
    : field === 'cost'
      ? (variant.cost_price ?? variant.costPrice)
      : variant.mrp;
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Merge one product into the desktop cache after create/edit (no full wipe). */
export async function upsertCachedProduct(product: Product): Promise<void> {
  if (!product?.id) {
    bumpCatalogRevision();
    return;
  }

  // Normalize snake_case so Billing flatten (selling_price) never reads a camelCase-only row as ₹0.
  const normalized: Product = {
    ...product,
    variants: (product.variants || []).map((variant) => {
      const selling = variantMoney(variant, 'selling');
      const cost = variantMoney(variant, 'cost');
      const mrp = variantMoney(variant, 'mrp');
      return {
        ...variant,
        selling_price: selling ?? variant.selling_price ?? 0,
        cost_price: cost ?? variant.cost_price ?? 0,
        ...(mrp !== null ? { mrp } : {}),
      };
    }),
  };

  const patches: CatalogPricePatch[] = [];
  for (const variant of normalized.variants || []) {
    const selling = variantMoney(variant, 'selling');
    // Skip missing prices — never publish a fake ₹0 that later reloads keep re-applying.
    if (selling == null) continue;
    const stockRaw = (variant as { stockQty?: number; stock_qty?: number }).stockQty
      ?? (variant as { stock_qty?: number }).stock_qty;
    const firstBarcode =
      variant.barcode ||
      (Array.isArray(variant.barcodes) && variant.barcodes[0] && (typeof variant.barcodes[0] === 'string' ? variant.barcodes[0] : (variant.barcodes[0] as any).barcode || (variant.barcodes[0] as any).code)) ||
      undefined;
    const barcodesList = (variant.barcodes || [])
      .map((b) => (typeof b === 'string' ? b : (b as any)?.barcode || (b as any)?.code))
      .filter(Boolean) as string[];
    patches.push({
      variantId: variant.id,
      productId: normalized.id,
      sellingPrice: selling,
      costPrice: variantMoney(variant, 'cost') ?? 0,
      mrp: variantMoney(variant, 'mrp'),
      name: normalized.name,
      nameMr: normalized.name_mr ?? null,
      stockQty: stockRaw !== undefined && stockRaw !== null ? Number(stockRaw) || 0 : undefined,
      barcode: firstBarcode,
      barcodes: barcodesList.length ? barcodesList : (firstBarcode ? [firstBarcode] : undefined),
    });
  }

  // Notify first so open Billing screens patch prices immediately (don't wait on AsyncStorage).
  bumpCatalogRevision(patches);

  // Sync to SQLite local DB on desktop so offline/billing searches immediately see the updated product
  void import('../offline/localApi')
    .then(({ hasSqliteBridge, localUpsertProduct }) => {
      if (!hasSqliteBridge()) return;
      return localUpsertProduct(normalized);
    })
    .catch(() => null);

  if (!isCatalogCacheEnabled()) return;
  const prev = await readCachedProducts();
  const items = prev?.items?.length ? [...prev.items] : [];
  const idx = items.findIndex((row) => row.id === normalized.id);
  if (idx >= 0) {
    // Keep previous variant prices when the payload omitted them (avoid writing ₹0 into cache).
    const prevProduct = items[idx];
    const prevById = new Map((prevProduct.variants || []).map((v) => [v.id, v]));
    items[idx] = {
      ...normalized,
      variants: (normalized.variants || []).map((variant) => {
        const prevVariant = prevById.get(variant.id);
        const selling = variantMoney(variant, 'selling');
        if (selling != null || !prevVariant) return variant;
        return {
          ...variant,
          selling_price: prevVariant.selling_price,
          cost_price: variantMoney(variant, 'cost') ?? prevVariant.cost_price,
          mrp: variantMoney(variant, 'mrp') ?? prevVariant.mrp,
        };
      }),
    };
  } else {
    items.unshift(normalized);
  }
  await writeJson(productsKey(), {
    updatedAt: Date.now(),
    total: Math.max(prev?.total || 0, items.length),
    items: items.slice(0, PRODUCTS_CAP),
  } satisfies ProductsPayload);
}

/**
 * Apply price/name edits into the desktop product cache and notify listeners
 * so Billing can update tiles + cart lines immediately.
 */
export async function applyCatalogPricePatches(patches: CatalogPricePatch[]): Promise<void> {
  const clean = (patches || []).filter((p) => p?.variantId);
  if (!clean.length) {
    bumpCatalogRevision();
    return;
  }

  // Notify first — Billing applies patches in memory without waiting for disk I/O.
  bumpCatalogRevision(clean);

  // Sync price bulk patches to SQLite on desktop
  void import('./catalogService')
    .then(({ syncPriceBulkToSqlite }) => syncPriceBulkToSqlite(clean.map((p) => ({
      variantId: p.variantId,
      productId: p.productId,
      sellingPrice: p.sellingPrice,
      costPrice: p.costPrice,
      mrp: p.mrp,
      name: p.name,
      nameMr: p.nameMr,
      stockQty: p.stockQty,
      barcode: p.barcode,
      barcodes: p.barcodes,
    }))))
    .catch(() => null);

  if (!isCatalogCacheEnabled()) return;
  const prev = await readCachedProducts();
  if (!prev?.items?.length) return;

  const byVariant = new Map(clean.map((p) => [p.variantId, p]));
  const items = prev.items.map((product) => {
    let touched = false;
    const variants = (product.variants || []).map((variant) => {
      const patch = byVariant.get(variant.id);
      if (!patch) return variant;
      touched = true;
      const nextStock = patch.stockQty !== undefined ? patch.stockQty : variant.stockQty;
      const nextBarcode = patch.barcode !== undefined ? patch.barcode : variant.barcode;
      const nextBarcodes = patch.barcodes !== undefined ? patch.barcodes : variant.barcodes;
      return {
        ...variant,
        selling_price: patch.sellingPrice !== undefined ? patch.sellingPrice : variant.selling_price,
        sellingPrice: patch.sellingPrice !== undefined ? patch.sellingPrice : (variant.sellingPrice ?? variant.selling_price),
        cost_price: patch.costPrice !== undefined ? patch.costPrice : variant.cost_price,
        costPrice: patch.costPrice !== undefined ? patch.costPrice : (variant.costPrice ?? variant.cost_price),
        mrp: patch.mrp !== undefined ? patch.mrp : variant.mrp,
        stockQty: nextStock,
        stock_qty: nextStock,
        barcode: nextBarcode,
        barcodes: nextBarcodes,
      };
    });
    if (!touched) {
      const namePatch = clean.find((p) => p.productId && p.productId === product.id);
      if (!namePatch || (namePatch.name === undefined && namePatch.nameMr === undefined)) {
        return product;
      }
      return {
        ...product,
        name: namePatch.name !== undefined ? namePatch.name : product.name,
        name_mr: namePatch.nameMr !== undefined ? namePatch.nameMr : product.name_mr,
      };
    }
    const namePatch = clean.find((p) => (
      (p.productId && p.productId === product.id)
      || (product.variants || []).some((v) => v.id === p.variantId)
    ));
    const stockTotal = variants.reduce((s, v) => {
      const raw = (v as { stockQty?: number; stock_qty?: number }).stockQty
        ?? (v as { stock_qty?: number }).stock_qty;
      return s + (Number(raw) || 0);
    }, 0);
    return {
      ...product,
      name: namePatch?.name !== undefined ? namePatch.name : product.name,
      name_mr: namePatch?.nameMr !== undefined ? namePatch.nameMr : product.name_mr,
      stockQty: stockTotal,
      stock_qty: stockTotal,
      variants,
    };
  });

  await writeJson(productsKey(), {
    updatedAt: Date.now(),
    total: prev.total,
    items,
  } satisfies ProductsPayload);
}

export async function patchCachedProductsFavoriteByCategory(
  categoryId: string,
  isFavorite: boolean,
): Promise<void> {
  if (!isCatalogCacheEnabled()) return;
  const prev = await readCachedProducts();
  if (!prev?.items?.length) return;
  const items = prev.items.map((row) => {
    const cat = row.category_id || row.category?.id;
    if (cat !== categoryId) return row;
    return { ...row, is_favorite: isFavorite, isFavorite };
  });
  await writeJson(productsKey(), {
    updatedAt: Date.now(),
    total: prev.total,
    items,
  } satisfies ProductsPayload);
}

async function clearCategoriesStorage(): Promise<void> {
  if (!isCatalogCacheEnabled()) return;
  try {
    await AsyncStorage.removeItem(categoriesKey());
  } catch {
    // ignore
  }
}

async function clearProductsStorage(): Promise<void> {
  if (!isCatalogCacheEnabled()) return;
  const key = productsKey();
  productsMemory.delete(key);
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export async function invalidateCachedCategories(): Promise<void> {
  bumpCatalogRevision();
  await clearCategoriesStorage();
}

export async function invalidateCachedProducts(): Promise<void> {
  bumpCatalogRevision();
  await clearProductsStorage();
}

export async function invalidateCatalogCache(): Promise<void> {
  bumpCatalogRevision();
  await Promise.all([clearCategoriesStorage(), clearProductsStorage()]);
}
