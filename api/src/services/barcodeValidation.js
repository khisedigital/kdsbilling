/**
 * Barcode format helpers.
 * New in-store codes are number-only EAN-13 (GS1 prefix 20) so retail scanners can read them.
 * Older internal codes starting with KDSPOZ (Code 128 letters) stay valid until replaced.
 */

const crypto = require('crypto');

const INTERNAL_PREFIX = 'KDSPOZ';
/** GS1 restricted-circulation prefix — in-store numbers, not manufacturer EANs. */
const IN_STORE_PREFIX = '20';

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

/** Digits only. Generated codes are 13-digit EAN-13; typed codes may be 8–14 digit retail numbers. */
function isNumericBarcode(value) {
  return /^\d{4,18}$/.test(String(value || '').trim());
}

function isValidBarcodeValue(value) {
  return isNumericBarcode(value);
}

/**
 * 13-digit in-store EAN-13 (prefix 20 + random digits + check digit).
 * Digits only — laser and camera scanners that ignore Code 128 can read it.
 * Uniqueness must still be checked against the barcodes table by the caller.
 */
function randomInStoreEan13() {
  let body = IN_STORE_PREFIX;
  while (body.length < 12) body += String(crypto.randomInt(0, 10));
  return body + ean13CheckDigit(body);
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
  IN_STORE_PREFIX,
  ean13CheckDigit,
  isValidEan13,
  isInternalCode128,
  isNumericBarcode,
  isValidBarcodeValue,
  randomInStoreEan13,
  pickPlainBarcode,
  classifyBarcodeStatus,
  detectBarcodeType,
};
