export interface Category {
  id: string;
  name: string;
  parent_id?: string | null;
  description?: string;
  status: string;
  parent?: { id: string; name: string };
}

export interface Brand {
  id: string;
  name: string;
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
  mrp?: string | number;
  wholesale_price?: string | number;
  status?: string;
  /** `quantity` set = scanning this barcode adds that quantity (in the product's unit). */
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
  description?: string;
  category_id?: string;
  brand_id?: string;
  uom_id: string;
  tax_group_id?: string;
  tax_code?: string;
  is_weight_based: boolean;
  allow_decimal_qty: boolean;
  has_variants: boolean;
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
  quantityBarcodes?: QuantityBarcodeInput[];
  costPrice?: number;
  sellingPrice: number;
  mrp?: number;
  variants?: Array<{
    id?: string;
    sku?: string;
    barcode?: string;
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
  description?: string;
  categoryId?: string | null;
  brandId?: string | null;
  uomId?: string;
  taxGroupId?: string | null;
  taxCode?: string;
  isWeightBased?: boolean;
  allowDecimalQty?: boolean;
  variantId?: string;
  sku?: string;
  barcode?: string;
  size?: string;
  color?: string;
  costPrice?: number;
  sellingPrice?: number;
  mrp?: number;
  variants?: Array<{
    id?: string;
    sku?: string;
    barcode?: string;
    quantityBarcodes?: QuantityBarcodeInput[];
    size?: string;
    color?: string;
    costPrice?: number;
    sellingPrice: number;
    mrp?: number;
    stockQty?: number;
  }>;
}
