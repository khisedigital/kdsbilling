import api from './api';
import { apiErrorCode } from '../utils/apiError';
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

export async function fetchCategories(search?: string): Promise<Category[]> {
  const { data } = await api.get('/categories', { params: { search } });
  return data.data;
}

export async function createCategory(payload: {
  name: string;
  parentId?: string;
  description?: string;
}): Promise<Category> {
  const { data } = await api.post('/categories', payload);
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
  parentId?: string | null;
  description?: string;
}): Promise<Category> {
  const { data } = await api.put(`/categories/${id}`, payload);
  return data.data;
}

export async function deleteCategory(id: string) {
  const { data } = await api.delete(`/categories/${id}`);
  return data.data;
}

export async function fetchBrands(search?: string): Promise<Brand[]> {
  const { data } = await api.get('/brands', { params: { search } });
  return data.data;
}

export async function createBrand(payload: {
  name: string;
  description?: string;
}): Promise<Brand> {
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
  description?: string;
}): Promise<Brand> {
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
}): Promise<Paginated<Product>> {
  const { data } = await api.get('/products', {
    params: {
      page: params?.page || 1,
      limit: params?.limit || 200,
      search: params?.search,
      categoryId: params?.categoryId,
      brandId: params?.brandId,
      status: params?.status,
    },
  });
  return data.data;
}

export async function fetchProduct(id: string): Promise<Product> {
  const { data } = await api.get(`/products/${id}`);
  return data.data;
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

export async function createProduct(payload: CreateProductPayload): Promise<Product> {
  const { data } = await api.post('/products', payload);
  return data.data;
}

export async function updateProduct(id: string, payload: UpdateProductPayload): Promise<Product> {
  const { data } = await api.put(`/products/${id}`, payload);
  return data.data;
}

export async function deleteProduct(id: string) {
  const { data } = await api.delete(`/products/${id}`);
  return data.data as { deleted: boolean };
}

export async function deleteAllProducts() {
  const { data } = await api.post('/products/delete-all');
  return data.data as { deleted: number };
}

export type PriceBulkItem = {
  variantId: string;
  productId?: string;
  name?: string;
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
  try {
    const { data } = await api.post('/products/price-bulk', { items });
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
    return { updated: items.length };
  }
}

export async function searchProducts(q: string) {
  const { data } = await api.get('/products/search', { params: { q } });
  return (data.data || []) as SearchProductResult[];
}

export interface SearchProductResult {
  variantId: string;
  productId: string;
  productName: string;
  productNameMr?: string | null;
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

export function productVariantToSearchResult(
  product: Product,
  variant: ProductVariant,
): SearchProductResult {
  return {
    variantId: variant.id,
    productId: product.id,
    productName: product.name,
    productNameMr: product.name_mr || null,
    sku: variant.sku,
    size: variant.size,
    color: variant.color,
    sellingPrice: parseFloat(String(variant.selling_price)) || 0,
    costPrice: parseFloat(String(variant.cost_price)) || 0,
    mrp: variant.mrp != null ? parseFloat(String(variant.mrp)) || null : null,
    barcodes: plainBarcodesOf(variant),
    quantityBarcodes: quantityBarcodesOf(variant),
    uom: product.uom
      ? { code: product.uom.code, name: product.uom.name, type: product.uom.type }
      : null,
    isWeightBased: product.is_weight_based,
    allowDecimalQty: product.allow_decimal_qty,
    stockQty: variant.stockQty ?? 0,
    categoryId: product.category_id || product.category?.id || null,
    categoryName: product.category?.name || null,
  };
}

export function flattenProductsToVariants(products: Product[]): SearchProductResult[] {
  const out: SearchProductResult[] = [];
  for (const product of products) {
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
}) {
  const { data } = await api.get('/master-catalog/products', { params });
  return (data.data || []) as MasterCatalogProduct[];
}

export async function importFromMasterCatalog(masterProductIds: string[], branchId?: string) {
  const { data } = await api.post('/products/import-from-master', {
    masterProductIds,
    branchId,
  });
  const result = data.data || {};
  return {
    imported: result.imported || 0,
    skipped: result.skipped || 0,
    failed: result.failed || 0,
    errors: result.errors || [],
  };
}
