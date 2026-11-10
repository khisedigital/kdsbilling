const AppError = require('../utils/AppError');

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function round2(n) {
  return Math.round(n * 100) / 100;
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

async function calculateLine(db, item, variant) {
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
    for (const comp of taxGroup.components) {
      const rate = parseFloat(comp.rate_percent);
      const amt = round4(taxable * rate / 100);
      taxes.push({
        taxTypeCode: comp.taxType?.code,
        taxName: comp.taxType?.name,
        ratePercent: rate,
        taxAmount: amt,
      });
      taxAmount += amt;
    }
  }

  taxAmount = round4(taxAmount);
  const lineTotal = round4(taxable + taxAmount);

  return {
    variantId: variant.id,
    isCustom: false,
    productName: formatLineProductName(
      variant.product?.name || item.productName,
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

async function calculateBill(db, { items, billDiscountAmount, billDiscountPercent, offer, roundOffAmount }) {
  const { ProductVariant, Product } = db;
  const calculatedItems = [];
  let subtotal = 0;
  let taxAmount = 0;

  for (const item of items) {
    if (isCustomBillItem(item)) {
      const line = calculateCustomLine(item);
      calculatedItems.push(line);
      subtotal += line.taxable;
      taxAmount += line.taxAmount;
      continue;
    }

    const variant = await ProductVariant.findOne({
      where: { id: item.variantId, deleted_at: null, status: 'active' },
      include: [{ model: Product, as: 'product' }],
    });
    if (!variant) throw new AppError(`Variant not found: ${item.variantId}`, 404, 'NOT_FOUND');

    const line = await calculateLine(db, item, variant);
    calculatedItems.push(line);
    subtotal += line.taxable;
    taxAmount += line.taxAmount;
  }

  subtotal = round4(subtotal);
  taxAmount = round4(taxAmount);

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
        billDiscount += round4(base * parseFloat(offer.value) / 100);
      } else {
        billDiscount += round4(parseFloat(offer.value));
      }
    }
  }

  const exactTotal = round4(Math.max(0, subtotal + taxAmount - billDiscount));
  const roundOff = round4(parseFloat(roundOffAmount || 0));
  const totalAmount = round4(Math.max(0, exactTotal + roundOff));

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

module.exports = { calculateBill, calculateLine, round4, round2 };
