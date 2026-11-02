/**
 * Self-checks for barcode validation / status classification (no DB).
 * Run: node scripts/test-barcode-validation.js
 */
const assert = require('assert');
const {
  INTERNAL_PREFIX,
  isValidEan13,
  isInternalCode128,
  isValidBarcodeValue,
  randomInternalCode128,
  pickPlainBarcode,
  classifyBarcodeStatus,
  detectBarcodeType,
  ean13CheckDigit,
} = require('../src/services/barcodeValidation');

const body = '200000000000';
const ean = body + ean13CheckDigit(body);
assert.strictEqual(ean, '2000000000008');
assert.ok(isValidEan13(ean));
assert.ok(!isValidEan13('123'));
assert.ok(!isValidEan13('2000000000000'));

const internal = randomInternalCode128();
assert.ok(internal.startsWith(INTERNAL_PREFIX));
assert.ok(isInternalCode128(internal));
assert.ok(isValidBarcodeValue(internal));
assert.strictEqual(detectBarcodeType(internal), 'code128');
assert.strictEqual(detectBarcodeType(ean), 'ean13');

assert.ok(isValidBarcodeValue('ABC-12345'));
assert.ok(!isValidBarcodeValue(''));
assert.ok(!isValidBarcodeValue('ab'));

assert.strictEqual(
  pickPlainBarcode([
    { barcode: 'QTY1', quantity: 5, is_primary: false },
    { barcode: 'MAIN1', quantity: null, is_primary: true },
  ]),
  'MAIN1',
);
assert.strictEqual(pickPlainBarcode([]), '');

assert.deepStrictEqual(classifyBarcodeStatus([]), {
  status: 'missing',
  barcode: '',
  barcodeType: null,
});
assert.strictEqual(
  classifyBarcodeStatus([{ barcode: ean, quantity: null, is_primary: true }]).status,
  'available',
);
assert.strictEqual(
  classifyBarcodeStatus([{ barcode: ean, quantity: null, is_primary: true }], { [ean]: 2 }).status,
  'duplicate',
);

const seen = new Set();
for (let i = 0; i < 200; i += 1) {
  const code = randomInternalCode128();
  assert.ok(!seen.has(code), 'collision in randomInternalCode128');
  seen.add(code);
}

console.log('barcode validation checks passed');
