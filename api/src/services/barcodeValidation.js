/**
 * Barcode format helpers — supports manufacturer EAN-13 and internal Code 128.
 * Internal namespace is reserved: codes starting with KDSPOZ (Code 128).
 */

const INTERNAL_PREFIX = 'KDSPOZ';

function ean13CheckDigit(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

function isValidEan13(value) {
  const code = String(value || '').trim();
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === code[12];
}

/** Reserved internal Code 128 identifiers (never collide with typical manufacturer EAN). */
function isInternalCode128(value) {
  const code = String(value || '').trim().toUpperCase();
  return code.startsWith(INTERNAL_PREFIX) && code.length >= INTERNAL_PREFIX.length + 8;
}

function isValidBarcodeValue(value) {
  const code = String(value || '').trim();
  if (!code) return false;
  if (code.length > 50) return false;
  if (isValidEan13(code)) return true;
  if (isInternalCode128(code)) return true;
  // Other manufacturer formats (UPC-A, Code 128, etc.) — allow printable ASCII.
  return /^[\x20-\x7E]{4,50}$/.test(code);
}

/**
 * Generate a unique-looking internal Code 128 value in the KDSPOZ namespace.
 * Uniqueness must still be checked against the barcodes table by the caller.
 */
function randomInternalCode128() {
  const alphabet = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let body = '';
  while (body.length < 12) {
    body += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${INTERNAL_PREFIX}${body}`;
}

/** Plain (non-quantity) barcode preferred for labeling / billing. */
function pickPlainBarcode(barcodes) {
  const list = Array.isArray(barcodes) ? barcodes : [];
  const plain = list
    .filter((b) => b && b.quantity == null && String(b.barcode || '').trim())
    .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)));
  return plain[0]?.barcode ? String(plain[0].barcode).trim() : '';
}

/**
 * Classify barcode presence for a variant given its barcodes and a map of
 * barcode → distinct variant_id count across the catalog.
 */
function classifyBarcodeStatus(barcodes, occupancyByCode = {}) {
  const code = pickPlainBarcode(barcodes);
  if (!code) return { status: 'missing', barcode: '', barcodeType: null };
  const occupants = occupancyByCode[code] || 1;
  if (occupants > 1) {
    return { status: 'duplicate', barcode: code, barcodeType: detectBarcodeType(code) };
  }
  return { status: 'available', barcode: code, barcodeType: detectBarcodeType(code) };
}

function detectBarcodeType(value) {
  const code = String(value || '').trim();
  if (isValidEan13(code)) return 'ean13';
  if (isInternalCode128(code)) return 'code128';
  return 'other';
}

module.exports = {
  INTERNAL_PREFIX,
  ean13CheckDigit,
  isValidEan13,
  isInternalCode128,
  isValidBarcodeValue,
  randomInternalCode128,
  pickPlainBarcode,
  classifyBarcodeStatus,
  detectBarcodeType,
};
