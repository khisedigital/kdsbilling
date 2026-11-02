const crypto = require('crypto');
const config = require('../../config');
const AppError = require('../../utils/AppError');
const secretBox = require('../../utils/secretBox');

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

// Stock from Shopify arrives via orders (not inventory_levels/update) so our own pushes are never echoed back.
const WEBHOOK_TOPICS = [
  'APP_UNINSTALLED',
  'ORDERS_CREATE',
  'ORDERS_CANCELLED',
  'PRODUCTS_CREATE',
  'PRODUCTS_UPDATE',
  'PRODUCTS_DELETE',
];

function isConfigured() {
  const s = config.shopify;
  return Boolean(s.apiKey && s.apiSecret && s.appUrl && secretBox.isValidKey(s.tokenEncryptionKey));
}

function assertConfigured() {
  if (!isConfigured()) {
    throw new AppError(
      'Shopify integration is not configured on the server',
      503,
      'SHOPIFY_NOT_CONFIGURED'
    );
  }
}

/** Accepts "store", "store.myshopify.com" or a full admin URL; returns "store.myshopify.com". */
function normalizeShopDomain(input) {
  let value = String(input || '').trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^https?:\/\//, '').split('/')[0].split('?')[0];
  if (!value.includes('.')) value = `${value}.myshopify.com`;
  return SHOP_DOMAIN_RE.test(value) ? value : null;
}

function isValidShopDomain(shop) {
  return SHOP_DOMAIN_RE.test(String(shop || ''));
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Verifies the `hmac` query parameter Shopify appends to OAuth redirects. */
function verifyOAuthHmac(query) {
  const { hmac, signature: _signature, ...rest } = query || {};
  if (!hmac) return false;
  const message = Object.keys(rest)
    .sort()
    .map((key) => {
      const value = Array.isArray(rest[key]) ? rest[key].join(',') : rest[key];
      return `${key}=${value}`;
    })
    .join('&');
  const digest = crypto.createHmac('sha256', config.shopify.apiSecret).update(message).digest('hex');
  return safeEqual(digest, String(hmac));
}

/** Verifies X-Shopify-Hmac-Sha256 against the raw request body. */
function verifyWebhookHmac(rawBody, hmacHeader) {
  if (!hmacHeader || !Buffer.isBuffer(rawBody)) return false;
  const digest = crypto.createHmac('sha256', config.shopify.apiSecret).update(rawBody).digest('base64');
  return safeEqual(digest, String(hmacHeader));
}

/**
 * Shopify REST-style webhook payloads carry 64-bit numeric IDs that exceed
 * Number.MAX_SAFE_INTEGER; quote long integers before parsing.
 */
function parseJsonPreservingIds(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
  if (!text) return {};
  return JSON.parse(text.replace(/("[A-Za-z_]*id"\s*:\s*)(-?\d{16,})/g, '$1"$2"'));
}

function toGid(type, id) {
  if (id === null || id === undefined || id === '') return null;
  const value = String(id);
  return value.startsWith('gid://') ? value : `gid://shopify/${type}/${value}`;
}

function gidTail(gid) {
  if (!gid) return null;
  return String(gid).split('/').pop().split('?')[0];
}

function encryptToken(token) {
  return secretBox.encrypt(token, config.shopify.tokenEncryptionKey);
}

function decryptToken(value) {
  return secretBox.decrypt(value, config.shopify.tokenEncryptionKey);
}

function truncate(value, max) {
  if (value === null || value === undefined) return null;
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}

function errorMessage(err) {
  return truncate(err?.message || String(err), 2000);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  WEBHOOK_TOPICS,
  isConfigured,
  assertConfigured,
  normalizeShopDomain,
  isValidShopDomain,
  safeEqual,
  verifyOAuthHmac,
  verifyWebhookHmac,
  parseJsonPreservingIds,
  toGid,
  gidTail,
  encryptToken,
  decryptToken,
  truncate,
  errorMessage,
  sleep,
};
