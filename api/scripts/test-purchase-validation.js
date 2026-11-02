/**
 * Lightweight self-checks for purchase item validation (no DB).
 * Run: node scripts/test-purchase-validation.js
 */
const assert = require('assert');
const { validatePurchaseItems } = require('../src/services/purchaseValidation');

function expectFail(items, includes) {
  const result = validatePurchaseItems(items);
  assert.strictEqual(result.ok, false, `expected failure for ${JSON.stringify(items)}`);
  if (includes) assert.ok(String(result.message).includes(includes), result.message);
}

function expectOk(items) {
  const result = validatePurchaseItems(items);
  assert.strictEqual(result.ok, true, result.message || 'expected ok');
  assert.strictEqual(result.items.length, items.length);
}

expectFail([], 'At least one item');
expectFail(null, 'At least one item');
expectFail([{ quantity: 1, unitCost: 10 }], 'variant');
expectFail([{ variantId: 'v1', quantity: 0, unitCost: 10 }], 'quantity');
expectFail([{ variantId: 'v1', quantity: -2, unitCost: 10 }], 'quantity');
expectFail([{ variantId: 'v1', quantity: 1, unitCost: -1 }], 'purchase price');
expectFail([{ variantId: 'v1', quantity: 'x', unitCost: 10 }], 'quantity');
expectOk([{ variantId: 'v1', quantity: 2, unitCost: 0 }]);
expectOk([
  { variantId: 'v1', quantity: 1, unitCost: 50 },
  { variantId: 'v2', quantity: 3.5, unitCost: 12.25, taxAmount: 1 },
]);

// Only qty > 0 rows should be submitted by the client; server still rejects zeros.
const filtered = [
  { variantId: 'a', quantity: 0, unitCost: 10 },
  { variantId: 'b', quantity: 2, unitCost: 15 },
].filter((row) => (parseFloat(row.quantity) || 0) > 0);
expectOk(filtered);
assert.strictEqual(filtered.length, 1);

console.log('purchase validation checks passed');
