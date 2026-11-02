const crypto = require('crypto');

const PREFIX = 'v1';

function parseKey(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  const b64 = Buffer.from(value, 'base64');
  if (b64.length === 32) return b64;
  return null;
}

function requireKey(raw) {
  const key = parseKey(raw);
  if (!key) {
    throw new Error('Encryption key must be 32 bytes (64 hex chars or base64)');
  }
  return key;
}

/** AES-256-GCM. Output: v1:<iv>:<tag>:<ciphertext> (base64 parts). */
function encrypt(plainText, rawKey) {
  if (plainText === null || plainText === undefined || plainText === '') return null;
  const key = requireKey(rawKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

function decrypt(payload, rawKey) {
  if (!payload) return null;
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error('Unsupported encrypted payload');
  }
  const key = requireKey(rawKey);
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

function isValidKey(rawKey) {
  return Boolean(parseKey(rawKey));
}

module.exports = { encrypt, decrypt, isValidKey };
