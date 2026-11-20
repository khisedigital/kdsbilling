import type { Product } from '../types/catalog';
import type { SearchProductResult } from '../services/catalogService';
import { hasSqliteBridge, sqliteListAllProducts, sqliteListProducts, sqliteStatus } from './sqliteApi';

function asProduct(row: unknown): Product | null {
  if (!row || typeof row !== 'object') return null;
  const p = row as Product;
  if (!p.id) return null;
  return p;
}

/** Billing grid cap — favorites first; search uses SQLite separately. */
export const BILLING_CATALOG_LIMIT = 280;

/** Full product list from SQLite (desktop local DB). Prefer capped reads for UI. */
export async function readSqliteProducts(opts?: {
  limit?: number;
  offset?: number;
  categoryId?: string | null;
}): Promise<{
  items: Product[];
  total: number;
  updatedAt: number;
} | null> {
  if (!hasSqliteBridge()) return null;
  const status = await sqliteStatus().catch(() => null);
  const limit = opts?.limit;
  // Uncapped only when caller explicitly asks (limit omitted and no category) — rare.
  if (limit == null && !opts?.categoryId) {
    const { items, total } = await sqliteListAllProducts();
    const products = items.map(asProduct).filter(Boolean) as Product[];
    if (!products.length) return null;
    const updatedAt = status?.catalogUpdatedAt
      ? Date.parse(String(status.catalogUpdatedAt)) || Date.now()
      : Date.now();
    return { items: products, total: total || products.length, updatedAt };
  }
  const { items, total } = await sqliteListProducts({
    limit: Math.max(1, limit || BILLING_CATALOG_LIMIT),
    offset: opts?.offset || 0,
    categoryId: opts?.categoryId ?? null,
  });
  const products = items.map(asProduct).filter(Boolean) as Product[];
  if (!products.length) return null;
  const updatedAt = status?.catalogUpdatedAt
    ? Date.parse(String(status.catalogUpdatedAt)) || Date.now()
    : Date.now();
  return { items: products, total: total || products.length, updatedAt };
}

/** Fast billing tiles: favorites-first page from SQLite (not the full 10k+ catalog). */
export async function readSqliteBillingCatalog(opts?: {
  limit?: number;
  categoryId?: string | null;
}): Promise<{ items: Product[]; total: number; updatedAt: number } | null> {
  return readSqliteProducts({
    limit: opts?.limit ?? BILLING_CATALOG_LIMIT,
    categoryId: opts?.categoryId ?? null,
    offset: 0,
  });
}

function variantSearchRows(product: Product, categoryId?: string | null): SearchProductResult[] {
  const productCategoryId =
    (product as { categoryId?: string | null }).categoryId ??
    (product as { category_id?: string | null }).category_id ??
    null;
  if (categoryId && productCategoryId !== categoryId) {
    return [];
  }
  const rows: SearchProductResult[] = [];
  for (const v of product.variants || []) {
    if (!v?.id) continue;
    const barcodes = (v.barcodes || [])
      .map((b) => (typeof b === 'string' ? b : b?.barcode))
      .filter(Boolean) as string[];
    const vv = v as {
      barcode?: string;
      sellingPrice?: number;
      selling_price?: number;
      costPrice?: number;
      cost_price?: number;
      stockQty?: number;
      stock_qty?: number;
      isWeightBased?: boolean;
      allowDecimalQty?: boolean;
      size?: string | null;
      color?: string | null;
      sku?: string;
      mrp?: number | null;
      id: string;
      barcodes?: Array<string | { barcode?: string }>;
    };
    const primary = vv.barcode;
    if (primary && !barcodes.includes(primary)) barcodes.unshift(primary);
    rows.push({
      variantId: vv.id,
      productId: product.id,
      productName: product.name || '',
      productNameMr: product.name_mr ?? product.nameMr ?? null,
      isFavorite: !!(product.is_favorite || (product as { isFavorite?: boolean }).isFavorite),
      sku: vv.sku || '',
      size: vv.size ?? null,
      color: vv.color ?? null,
      sellingPrice: Number(vv.sellingPrice ?? vv.selling_price) || 0,
      costPrice: Number(vv.costPrice ?? vv.cost_price) || 0,
      mrp: vv.mrp ?? null,
      barcodes,
      stockQty: Number(vv.stockQty ?? vv.stock_qty) || 0,
      categoryId: productCategoryId,
      categoryName: product.category?.name ?? null,
      isWeightBased: !!(vv.isWeightBased || vv.allowDecimalQty),
      allowDecimalQty: !!vv.allowDecimalQty,
    });
  }
  return rows;
}

/** Lower score = better match. Exact name / barcode / SKU beat loose "contains". */
function searchRank(row: SearchProductResult, lower: string): number {
  const name = String(row.productName || '').toLowerCase().trim();
  const nameMr = String(row.productNameMr || '').toLowerCase().trim();
  const sku = String(row.sku || '').toLowerCase();
  const codes = (row.barcodes || []).map((c) => String(c).toLowerCase());
  if (sku === lower || codes.some((c) => c === lower)) return 0;
  if (name === lower || nameMr === lower) return 1;
  if (name.startsWith(lower) || nameMr.startsWith(lower)) return 2;
  // Whole-word-ish: "sugar" in "Brown Sugar 500 g", not only inside "sugary"
  const word = new RegExp(`(^|[^a-z0-9])${lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
  if (word.test(name) || word.test(nameMr)) return 3;
  if (name.includes(lower) || nameMr.includes(lower) || sku.includes(lower) || codes.some((c) => c.includes(lower))) {
    return 4;
  }
  return 5;
}

/**
 * Local product search for billing / barcode — used when offline
 * or when the API is unreachable on desktop.
 */
export async function searchSqliteProducts(
  q: string,
  opts?: { categoryId?: string | null },
): Promise<SearchProductResult[]> {
  if (!hasSqliteBridge()) return [];
  const query = String(q || '').trim();
  if (!query) return [];
  // Pull a wide candidate set; rank in JS so exact "Sugar" is not buried under "sugar free".
  const { items } = await sqliteListProducts({ search: query, limit: 400, offset: 0 });
  const products = items.map(asProduct).filter(Boolean) as Product[];
  const out: SearchProductResult[] = [];
  for (const p of products) {
    out.push(...variantSearchRows(p, opts?.categoryId));
  }
  const lower = query.toLowerCase();
  out.sort((a, b) => {
    const ra = searchRank(a, lower);
    const rb = searchRank(b, lower);
    if (ra !== rb) return ra - rb;
    if (!!b.isFavorite !== !!a.isFavorite) return a.isFavorite ? -1 : 1;
    return (a.productName || '').localeCompare(b.productName || '');
  });
  return out.slice(0, 120);
}

/** Desktop SQLite: always use local catalog for day-to-day billing (sync is manual). */
export function shouldUseLocalCatalog(): boolean {
  return hasSqliteBridge();
}

export async function readSqliteCategories(): Promise<unknown[]> {
  if (!hasSqliteBridge()) return [];
  const { sqliteListCategories } = await import('./sqliteApi');
  return sqliteListCategories();
}

export async function readSqliteBrands(): Promise<unknown[]> {
  if (!hasSqliteBridge()) return [];
  const { sqliteListBrands } = await import('./sqliteApi');
  return sqliteListBrands();
}

export async function readSqliteCustomers(search?: string): Promise<unknown[]> {
  if (!hasSqliteBridge()) return [];
  const { sqliteListCustomers } = await import('./sqliteApi');
  return sqliteListCustomers({ search, limit: 200 });
}
