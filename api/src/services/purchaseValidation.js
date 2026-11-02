/**
 * Pure validation helpers for purchase bill items.
 * Kept separate so they can be unit-tested without a DB.
 */

function normalizePurchaseItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item, index) => {
    const quantity = parseFloat(item?.quantity);
    const unitCost = parseFloat(item?.unitCost);
    const taxAmount = parseFloat(item?.taxAmount || 0);
    return {
      index,
      variantId: item?.variantId || item?.variant_id || null,
      quantity,
      unitCost,
      taxAmount: Number.isNaN(taxAmount) ? 0 : taxAmount,
    };
  });
}

/**
 * @returns {{ ok: true, items: object[] } | { ok: false, message: string }}
 */
function validatePurchaseItems(rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) {
    return { ok: false, message: 'At least one item is required' };
  }

  const items = normalizePurchaseItems(rawItems);
  for (const item of items) {
    if (!item.variantId) {
      return { ok: false, message: `Item ${item.index + 1}: variant is required` };
    }
    if (Number.isNaN(item.quantity) || item.quantity <= 0) {
      return { ok: false, message: `Item ${item.index + 1}: quantity must be greater than 0` };
    }
    if (Number.isNaN(item.unitCost) || item.unitCost < 0) {
      return { ok: false, message: `Item ${item.index + 1}: purchase price must be a valid non-negative number` };
    }
  }

  return { ok: true, items };
}

module.exports = {
  normalizePurchaseItems,
  validatePurchaseItems,
};
