export interface Category {
  id: string;
  name: string;
  name_mr?: string | null;
  nameMr?: string | null;
  parent_id?: string | null;
  description?: string;
  status: string;
  parent?: { id: string; name: string; name_mr?: string | null; nameMr?: string | null };
}

export interface Brand {
  id: string;
  name: string;
  name_mr?: string | null;
  nameMr?: string | null;
  description?: string;
  status: string;
}

export interface UnitOfMeasure {
  id: string;
  code: string;
  name: string;
  type: 'count' | 'weight' | 'volume' | 'length';
}

export interface TaxGroup {
  id: string;
  name: string;
  total_rate: string | number;
}

export interface ProductVariant {
  id: string;
  sku: string;
  size?: string;
  color?: string;
  cost_price: string | number;
  selling_price: string | number;
  mrp?: string | number | null;
  wholesale_price?: string | number;
  status?: string;
  tax_group_id?: string | null;
  taxGroup?: TaxGroup;
  barcode?: string;
  barcodes?: { barcode: string; is_primary: boolean; quantity?: string | number | null }[];
  stockQty?: number;
}

/** A barcode that stands for a fixed quantity, e.g. a 500 g pack. Empty barcode = generate one. */
export interface QuantityBarcodeInput {
  barcode?: string;
  quantity: number;
}

export interface Product {
  id: string;
  name: string;
  name_mr?: string | null;
  description?: string;
  category_id?: string;
  brand_id?: string;
  uom_id: string;
  tax_group_id?: string | null;
  tax_code?: string;
  is_weight_based: boolean;
  allow_decimal_qty: boolean;
  has_variants: boolean;
  is_favorite?: boolean;
  isFavorite?: boolean;
  status: string;
  category?: Category;
  brand?: Brand;
  uom?: UnitOfMeasure;
  taxGroup?: TaxGroup;
  variants?: ProductVariant[];
  images?: { id: string; url?: string; file_path: string; is_primary: boolean }[];
  /** Sum of variant stock for current branch */
  stockQty?: number;
}

export interface Paginated<T> {
  items: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface CreateProductPayload {
  name: string;
  nameMr?: string | null;
  description?: string;
  categoryId?: string;
  brandId?: string;
  uomId: string;
  taxGroupId?: string | null;
  taxCode?: string;
  isWeightBased?: boolean;
  allowDecimalQty?: boolean;
  sku?: string;
  barcode?: string;
  /** All plain barcodes for the default variant (first = primary). Prefer over single barcode. */
  barcodes?: string[];
  quantityBarcodes?: QuantityBarcodeInput[];
  costPrice?: number;
  sellingPrice: number;
  mrp?: number;
  /** Opening quantity for a product with no sizes. */
  stockQty?: number;
  variants?: Array<{
    id?: string;
    sku?: string;
    barcode?: string;
    barcodes?: string[];
    quantityBarcodes?: QuantityBarcodeInput[];
    size?: string;
    color?: string;
    costPrice?: number;
    sellingPrice: number;
    mrp?: number;
    stockQty?: number;
  }>;
}

export interface UpdateProductPayload {
  name?: string;
  nameMr?: string | null;
  description?: string;
  categoryId?: string | null;
  brandId?: string | null;
  uomId?: string;
  taxGroupId?: string | null;
  taxCode?: string;
  isWeightBased?: boolean;
  allowDecimalQty?: boolean;
  isFavorite?: boolean;
  variantId?: string;
  sku?: string;
  barcode?: string;
  barcodes?: string[];
  quantityBarcodes?: QuantityBarcodeInput[];
  size?: string;
  color?: string;
  costPrice?: number;
  sellingPrice?: number;
  mrp?: number;
  /** append = create/update listed sizes only; never soft-delete others */
  variantSyncMode?: 'replace' | 'append';
  variants?: Array<{
    id?: string;
    sku?: string;
    barcode?: string;
    barcodes?: string[];
    quantityBarcodes?: QuantityBarcodeInput[];
    size?: string;
    color?: string;
    costPrice?: number;
    sellingPrice: number;
    mrp?: number;
    stockQty?: number;
  }>;
}
