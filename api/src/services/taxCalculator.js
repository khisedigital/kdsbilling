const AppError = require('../utils/AppError');
const { getMasterModels } = require('../models/master');

function round2(n) {
  if (n == null || !Number.isFinite(Number(n))) return 0;
  const sign = Number(n) < 0 ? -1 : 1;
  const abs = Math.abs(Number(n));
  return sign * Number(Math.round(Number(abs + 'e2')) + 'e-2');
}

function round4(n) {
  if (n == null || !Number.isFinite(Number(n))) return 0;
  const sign = Number(n) < 0 ? -1 : 1;
  const abs = Math.abs(Number(n));
  return sign * Number(Math.round(Number(abs + 'e4')) + 'e-4');
}

function toPaise(n) {
  if (n == null || !Number.isFinite(Number(n))) return 0;
  const sign = Number(n) < 0 ? -1 : 1;
  const abs = Math.abs(Number(n));
  return sign * Math.round(Number(abs + 'e2'));
}

function fromPaise(paise) {
  if (!Number.isFinite(Number(paise))) return 0;
  return Number((paise / 100).toFixed(2));
}

function toUnits4(n) {
  if (n == null || !Number.isFinite(Number(n))) return 0;
  const sign = Number(n) < 0 ? -1 : 1;
  const abs = Math.abs(Number(n));
  return sign * Math.round(Number(abs + 'e4'));
}

function fromUnits4(units) {
  if (!Number.isFinite(Number(units))) return 0;
  return Number((units / 10000).toFixed(4));
}

/** Cache master Marathi names for one bill calculation (by English product name). */
async function lookupMasterNameMr(englishName, cache) {
  const key = String(englishName || '').trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  try {
    const { MasterProduct } = getMasterModels();
    const row = await MasterProduct.findOne({
      where: { name: String(englishName).trim(), status: 'active' },
      attributes: ['name_mr'],
    });
    const mr = row?.name_mr ? String(row.name_mr).trim() || null : null;
    cache.set(key, mr);
    return mr;
  } catch {
    cache.set(key, null);
    return null;
  }
}

async function getTaxGroupForVariant(db, variant) {
  const { TaxGroup, TaxGroupComponent, TaxType } = db;
  // Product tax group is the source of truth (variants store a copy that can go stale).
  // Prefer product so a newly selected rate is used on the next bill without re-saving variants.
  const taxGroupId = variant.product?.tax_group_id || variant.tax_group_id;
  if (!taxGroupId) return null;

  return TaxGroup.findByPk(taxGroupId, {
    include: [{
      model: TaxGroupComponent,
      as: 'components',
      include: [{ model: TaxType, as: 'taxType' }],
    }],
  });
}

function formatLineProductName(name, size, color) {
  const parts = [size, color].filter(Boolean);
  return parts.length ? `${name} (${parts.join(' · ')})` : name;
}

/** Bill print language: Marathi name when set, otherwise English. */
function pickCatalogProductName(product, item, language, masterNameMr = null) {
  const english = String(product?.name || item?.productName || '').trim();
  const marathi = String(
    product?.name_mr
    || item?.productNameMr
    || item?.product_name_mr
    || masterNameMr
    || '',
  ).trim();
  if (language === 'mr' && marathi) return marathi;
  return english || marathi;
}

function isCustomBillItem(item) {
  if (item?.isCustom === true) return true;
  const id = String(item?.variantId || '');
  return !id || id.startsWith('custom-');
}

function calculateCustomLine(item) {
  const qty = parseFloat(item.quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new AppError('Custom item quantity must be greater than 0', 400, 'VALIDATION_ERROR');
  }
  const unitPrice = parseFloat(item.unitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new AppError('Custom item price is required', 400, 'VALIDATION_ERROR');
  }
  const productName = String(item.productName || item.name || '').trim();
  if (!productName) {
    throw new AppError('Custom item name is required', 400, 'VALIDATION_ERROR');
  }
  if (productName.length > 200) {
    throw new AppError('Custom item name is too long', 400, 'VALIDATION_ERROR');
  }

  const lineSubtotal = round4(qty * unitPrice);
  let lineDiscount = 0;
  if (item.discountPercent) {
    lineDiscount = round4(lineSubtotal * parseFloat(item.discountPercent) / 100);
  } else if (item.discountAmount) {
    lineDiscount = round4(parseFloat(item.discountAmount));
  }
  const taxable = round4(Math.max(0, lineSubtotal - lineDiscount));

  return {
    // Keep client cart id (custom-...) for UI mapping; DB stores null when persisting
    variantId: item.variantId || null,
    isCustom: true,
    productName,
    sku: 'CUSTOM',
    quantity: qty,
    unitPrice,
    mrp: item.mrp != null && item.mrp !== '' ? parseFloat(item.mrp) || null : null,
    costPrice: 0,
    discountAmount: lineDiscount,
    discountPercent: parseFloat(item.discountPercent || 0),
    taxAmount: 0,
    lineTotal: taxable,
    taxes: [],
    taxable,
    lineSubtotal,
  };
}

async function calculateLine(db, item, variant, language = 'en', masterNameMrCache = null) {
  const qty = parseFloat(item.quantity);
  const unitPrice = parseFloat(item.unitPrice ?? variant.selling_price);
  const lineSubtotal = round4(qty * unitPrice);
  const mrpRaw = item.mrp != null && item.mrp !== ''
    ? parseFloat(item.mrp)
    : (variant.mrp != null ? parseFloat(variant.mrp) : null);
  const mrp = Number.isFinite(mrpRaw) && mrpRaw > 0 ? mrpRaw : null;

  let lineDiscount = 0;
  if (item.discountPercent) {
    lineDiscount = round4(lineSubtotal * parseFloat(item.discountPercent) / 100);
  } else if (item.discountAmount) {
    lineDiscount = round4(parseFloat(item.discountAmount));
  }

  const taxable = round4(Math.max(0, lineSubtotal - lineDiscount));
  const taxGroup = await getTaxGroupForVariant(db, variant);
  const taxes = [];
  let taxAmount = 0;

  if (taxGroup?.components) {
    let compTaxUnits = 0;
    for (const comp of taxGroup.components) {
      const rate = parseFloat(comp.rate_percent);
      const amt = round4(taxable * rate / 100);
      taxes.push({
        taxTypeCode: comp.taxType?.code,
        taxName: comp.taxType?.name,
        ratePercent: rate,
        taxAmount: amt,
      });
      compTaxUnits += toUnits4(amt);
    }
    taxAmount = fromUnits4(compTaxUnits);
  }

  taxAmount = round4(taxAmount);
  const lineTotal = fromUnits4(toUnits4(taxable) + toUnits4(taxAmount));

  let masterNameMr = null;
  const hasLocalMr = !!(
    variant.product?.name_mr
    || item?.productNameMr
    || item?.product_name_mr
  );
  if (language === 'mr' && !hasLocalMr && masterNameMrCache) {
    masterNameMr = await lookupMasterNameMr(variant.product?.name || item?.productName, masterNameMrCache);
    // Persist so Billing / future prints don't keep hitting master.
    if (masterNameMr && variant.product?.id && !variant.product.name_mr) {
      variant.product.update({ name_mr: masterNameMr }).catch(() => null);
    }
  }

  return {
    variantId: variant.id,
    isCustom: false,
    productName: formatLineProductName(
      pickCatalogProductName(variant.product, item, language, masterNameMr),
      variant.size,
      variant.color
    ),
    sku: variant.sku,
    quantity: qty,
    unitPrice,
    mrp,
    costPrice: parseFloat(variant.cost_price || 0),
    discountAmount: lineDiscount,
    discountPercent: parseFloat(item.discountPercent || 0),
    taxAmount,
    lineTotal,
    taxes,
    taxable,
    lineSubtotal,
  };
}

async function calculateBill(db, {
  items,
  billDiscountAmount,
  billDiscountPercent,
  offer,
  roundOffAmount,
  language,
}) {
  const { ProductVariant, Product } = db;
  const lang = language === 'mr' ? 'mr' : 'en';
  const masterNameMrCache = lang === 'mr' ? new Map() : null;
  const calculatedItems = [];
  let subtotalUnits = 0;
  let taxAmountUnits = 0;

  for (const item of items) {
    if (isCustomBillItem(item)) {
      const line = calculateCustomLine(item);
      calculatedItems.push(line);
      subtotalUnits += toUnits4(line.taxable);
      taxAmountUnits += toUnits4(line.taxAmount);
      continue;
    }

    const variant = await ProductVariant.findOne({
      where: { id: item.variantId, deleted_at: null, status: 'active' },
      include: [{ model: Product, as: 'product' }],
    });
    if (!variant) throw new AppError(`Variant not found: ${item.variantId}`, 404, 'NOT_FOUND');

    const line = await calculateLine(db, item, variant, lang, masterNameMrCache);
    calculatedItems.push(line);
    subtotalUnits += toUnits4(line.taxable);
    taxAmountUnits += toUnits4(line.taxAmount);
  }

  const subtotal = fromUnits4(subtotalUnits);
  const taxAmount = fromUnits4(taxAmountUnits);

  let billDiscount = 0;
  if (billDiscountPercent) {
    billDiscount = round4((subtotal + taxAmount) * parseFloat(billDiscountPercent) / 100);
  } else if (billDiscountAmount) {
    billDiscount = round4(parseFloat(billDiscountAmount));
  }

  if (offer) {
    const base = subtotal + taxAmount;
    if (base >= parseFloat(offer.min_purchase || 0)) {
      if (offer.offer_type === 'percent_off') {
        billDiscount = round4(billDiscount + (base * parseFloat(offer.value) / 100));
      } else {
        billDiscount = round4(billDiscount + parseFloat(offer.value));
      }
    }
  }

  // Exact total in paise (2 decimal places) for retail billing:
  const exactTotal = round2(Math.max(0, subtotal + taxAmount - billDiscount));
  const roundOff = round2(parseFloat(roundOffAmount || 0));
  const totalAmount = round2(Math.max(0, exactTotal + roundOff));

  return {
    items: calculatedItems,
    subtotal,
    taxAmount,
    discountAmount: billDiscount,
    discountPercent: parseFloat(billDiscountPercent || 0),
    roundOffAmount: roundOff,
    exactTotal,
    totalAmount,
  };
}

module.exports = {
  calculateBill,
  calculateLine,
  round4,
  round2,
  toPaise,
  fromPaise,
  toUnits4,
  fromUnits4,
};
