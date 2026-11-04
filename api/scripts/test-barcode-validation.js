/**
 * Self-checks for barcode validation / status classification (no DB).
 * Run: node scripts/test-barcode-validation.js
 */
const assert = require('assert');
const {
  INTERNAL_PREFIX,
  IN_STORE_PREFIX,
  isValidEan13,
  isInternalCode128,
  isNumericBarcode,
  isValidBarcodeValue,
  randomInStoreEan13,
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

const internal = randomInStoreEan13();
assert.ok(internal.startsWith(IN_STORE_PREFIX));
assert.ok(/^\d{13}$/.test(internal));
assert.ok(isValidEan13(internal));
assert.ok(!isInternalCode128(internal));
assert.ok(isValidBarcodeValue(internal));
assert.strictEqual(detectBarcodeType(internal), 'ean13');
assert.strictEqual(detectBarcodeType(ean), 'ean13');

const legacy = `${INTERNAL_PREFIX}12345678`;
assert.ok(isInternalCode128(legacy));
assert.ok(!isNumericBarcode(legacy));
assert.ok(!isValidBarcodeValue(legacy));
assert.strictEqual(detectBarcodeType(legacy), 'code128');

assert.ok(isNumericBarcode('8901234567890'));
assert.ok(isValidBarcodeValue('8901234567890'));
assert.ok(!isValidBarcodeValue('ABC-12345'));
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
  const code = randomInStoreEan13();
  assert.ok(isValidEan13(code), 'generated barcode must be a valid EAN-13');
  assert.ok(!seen.has(code), 'collision in randomInStoreEan13');
  seen.add(code);
}

console.log('barcode validation checks passed');
