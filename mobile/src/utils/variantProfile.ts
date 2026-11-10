/**
 * Product variant UI depends on the shop's business type:
 * clothing → apparel sizes + color
 * kirana / grocery / default → pack weights (no color)
 */

export type VariantAxis = 'apparel' | 'pack';

export type VariantProfile = {
  axis: VariantAxis;
  showColor: boolean;
  /** Column / field name for the size axis */
  sizeLabel: string;
  sizeOptions: string[];
  checkboxTitle: string;
  checkboxHint: string;
  variantsSubtitle: string;
  lockedHint: string;
  intro: string;
  addButtonLabel: string;
  emptyRowsHint: string;
  missingRowsError: string;
  priceNote: string;
  stockHint: string;
  skuPrefixHint: string;
};

const APPAREL: VariantProfile = {
  axis: 'apparel',
  showColor: true,
  sizeLabel: 'Size',
  sizeOptions: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Free Size'],
  checkboxTitle: 'This product has sizes',
  checkboxHint: 'Enable sizes (S, M, L…) and color. Pricing moves to each size.',
  variantsSubtitle: 'Each size has its own price & barcode',
  lockedHint: 'Tick “This product has sizes” in the Product column to add sizes here.',
  intro: 'Manage variants by size, color, selling price, MRP and barcode.',
  addButtonLabel: 'Add size',
  emptyRowsHint: 'No sizes yet. Add S, M, L… to sell this product.',
  missingRowsError: 'Add at least one size (S, M, L…)',
  priceNote: 'Product pricing is off. Set price on each size in the Variants column.',
  stockHint: 'Each size has its own stock — set qty per size',
  skuPrefixHint: 'Used when adding sizes',
};

const PACK: VariantProfile = {
  axis: 'pack',
  showColor: false,
  sizeLabel: 'Pack',
  sizeOptions: ['100g', '250g', '500g', '1kg', '2kg', '5kg', '500ml', '1L', '2L'],
  checkboxTitle: 'This product has pack sizes',
  checkboxHint: 'Enable packs (500g, 1kg…). Pricing moves to each pack.',
  variantsSubtitle: 'Each pack has its own price & barcode',
  lockedHint: 'Tick “This product has pack sizes” in the Product column to add packs here.',
  intro: 'Manage pack variants by weight/volume, selling price, MRP and barcode.',
  addButtonLabel: 'Add pack',
  emptyRowsHint: 'No packs yet. Add 500g, 1kg… to sell this product.',
  missingRowsError: 'Add at least one pack (500g, 1kg…)',
  priceNote: 'Product pricing is off. Set price on each pack in the Variants column.',
  stockHint: 'Each pack has its own stock — set qty per pack',
  skuPrefixHint: 'Used when adding packs',
};

const APPAREL_CODES = new Set([
  'clothing',
  'apparel',
  'fashion',
  'garment',
  'garments',
  'textile',
  'boutique',
]);

export function variantProfileForBusinessType(code?: string | null): VariantProfile {
  const normalized = String(code || '').trim().toLowerCase();
  if (APPAREL_CODES.has(normalized)) return APPAREL;
  return PACK;
}
