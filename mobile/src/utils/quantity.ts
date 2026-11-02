export type UomInfo = {
  code: string;
  name?: string;
  type?: 'count' | 'weight' | 'volume' | 'length';
};

type ProductQtyMeta = {
  allowDecimalQty?: boolean;
  isWeightBased?: boolean;
  uom?: UomInfo | null;
};

const WEIGHT_UNITS: Record<string, number> = {
  g: 0.001,
  gm: 0.001,
  gram: 0.001,
  grams: 0.001,
  kg: 1,
  kgs: 1,
  kilogram: 1,
  kilograms: 1,
};

const VOLUME_UNITS: Record<string, number> = {
  ml: 0.001,
  l: 1,
  ltr: 1,
  litre: 1,
  liters: 1,
};

function isCountUom(uom?: UomInfo | null): boolean {
  if (!uom) return false;
  if (uom.type === 'count') return true;
  const code = (uom.code || '').toLowerCase();
  return code === 'pcs' || code === 'pc' || code === 'piece' || code === 'pieces' || code === 'nos' || code === 'unit';
}

/** Ask "How much?" only for weighable / decimal items — never for pieces packs. */
export function needsQuantityPrompt(product: ProductQtyMeta & { scannedQuantity?: number | null }): boolean {
  if (product.scannedQuantity && product.scannedQuantity > 0) return false;
  // Packs sold as pieces (e.g. Chaha Powder 50g pack) always add as 1.
  if (isCountUom(product.uom)) return false;

  const code = product.uom?.code;
  const type = product.uom?.type;
  const measurable =
    isMeasurableUom(code) || type === 'weight' || type === 'volume' || type === 'length';

  // Non-measure units (box, dozen, etc.): add as 1 even if weight flags were left on.
  if (product.uom && !measurable) return false;

  return !!(product.allowDecimalQty || product.isWeightBased || measurable);
}

function isMeasurableUom(code?: string): boolean {
  if (!code) return false;
  const c = code.toLowerCase();
  return c in WEIGHT_UNITS || c in VOLUME_UNITS;
}

function unitFactor(code: string, uomType?: string): number | null {
  const c = code.toLowerCase();
  if (c in WEIGHT_UNITS) return WEIGHT_UNITS[c];
  if (c in VOLUME_UNITS) return VOLUME_UNITS[c];
  if (uomType === 'weight') return c === 'kg' ? 1 : null;
  if (uomType === 'volume') return c === 'ltr' ? 1 : null;
  return c === 'pcs' ? 1 : null;
}

/** Convert a value entered in `inputUnit` into the product's billing UOM. */
export function toProductQuantity(
  value: number,
  inputUnit: string,
  productUom: UomInfo,
): number | null {
  const productCode = productUom.code.toLowerCase();
  const inputFactor = unitFactor(inputUnit, productUom.type);
  const productFactor = unitFactor(productCode, productUom.type);
  if (inputFactor == null || productFactor == null || productFactor === 0) return null;
  return roundQty((value * inputFactor) / productFactor);
}

/**
 * Parse free-text quantity like "250g", "0.5kg", "1.5", "2".
 * For kg products without a suffix: values > 1 are kg; use g suffix for grams (250g, 500g).
 */
export function parseQuantityInput(raw: string, productUom: UomInfo): number | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  const match = trimmed.match(/^([\d.]+)\s*([a-z]+)?$/);
  if (!match) return null;

  const num = parseFloat(match[1]);
  if (Number.isNaN(num) || num <= 0) return null;

  const productCode = productUom.code.toLowerCase();
  let inputUnit = match[2];

  if (!inputUnit) {
    inputUnit = productCode;
  }

  return toProductQuantity(num, inputUnit, productUom);
}

/** Like parseQuantityInput, but also accepts plain numbers (or "<n> <code>") for units it can't convert, e.g. box. */
export function parseQuantityForUom(raw: string, productUom?: UomInfo | null): number | null {
  const parsed = productUom ? parseQuantityInput(raw, productUom) : null;
  if (parsed) return parsed;
  const match = raw.trim().toLowerCase().match(/^([\d.]+)\s*([a-z]+)?$/);
  if (!match || (match[2] && productUom && match[2] !== productUom.code.toLowerCase())) return null;
  const n = parseFloat(match[1]);
  return n > 0 ? roundQty(n) : null;
}

export function formatQuantity(qty: number, uom?: UomInfo | null): string {
  if (!uom?.code) return formatNumber(qty);

  const code = uom.code.toLowerCase();
  if (code === 'kg') {
    if (qty < 1) {
      const grams = Math.round(qty * 1000);
      return grams >= 1000 ? '1 kg' : `${grams} g`;
    }
    return `${stripTrailingZeros(qty)} kg`;
  }
  if (code === 'ltr') {
    if (qty < 1) {
      const ml = Math.round(qty * 1000);
      return ml >= 1000 ? '1 ltr' : `${ml} ml`;
    }
    return `${stripTrailingZeros(qty)} ltr`;
  }
  if (code === 'g') return `${Math.round(qty)} g`;
  if (code === 'ml') return `${Math.round(qty)} ml`;
  if (Number.isInteger(qty)) return `${qty} ${uom.code}`;
  return `${stripTrailingZeros(qty)} ${uom.code}`;
}

export function getQuantityPresets(uom?: UomInfo | null): { label: string; quantity: number }[] {
  const code = uom?.code?.toLowerCase();
  if (code === 'kg') {
    return [
      { label: '250g', quantity: 0.25 },
      { label: '500g', quantity: 0.5 },
      { label: '750g', quantity: 0.75 },
      { label: '1 kg', quantity: 1 },
      { label: '1.5 kg', quantity: 1.5 },
      { label: '2 kg', quantity: 2 },
    ];
  }
  if (code === 'g') {
    return [
      { label: '100g', quantity: 100 },
      { label: '250g', quantity: 250 },
      { label: '500g', quantity: 500 },
      { label: '1 kg', quantity: 1000 },
    ];
  }
  if (code === 'ltr') {
    return [
      { label: '250ml', quantity: 0.25 },
      { label: '500ml', quantity: 0.5 },
      { label: '750ml', quantity: 0.75 },
      { label: '1 ltr', quantity: 1 },
    ];
  }
  if (code === 'ml') {
    return [
      { label: '100ml', quantity: 100 },
      { label: '250ml', quantity: 250 },
      { label: '500ml', quantity: 500 },
      { label: '1 ltr', quantity: 1000 },
    ];
  }
  return [
    { label: '0.5', quantity: 0.5 },
    { label: '1', quantity: 1 },
    { label: '2', quantity: 2 },
    { label: '5', quantity: 5 },
  ];
}

export function quantityHint(uom?: UomInfo | null): string {
  const code = uom?.code?.toLowerCase();
  if (code === 'kg') return 'e.g. 250g, 500g, 1.5, 2 (plain numbers = kg)';
  if (code === 'ltr') return 'e.g. 250ml, 500, 0.5ltr';
  if (code === 'g' || code === 'ml') return `Enter amount in ${code}`;
  return 'Enter quantity';
}

function roundQty(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function stripTrailingZeros(n: number): string {
  return parseFloat(n.toFixed(4)).toString();
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : stripTrailingZeros(n);
}
