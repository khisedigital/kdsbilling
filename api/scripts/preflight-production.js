#!/usr/bin/env node
require('dotenv').config();

const WEAK_SECRETS = new Set([
  'change-this-jwt-secret-in-production',
  'change-this-refresh-secret-in-production',
  'dev-jwt-secret',
  'dev-refresh-secret',
  'Admin@123',
]);

function fail(message) {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`✓ ${message}`);
}

function warn(message) {
  console.warn(`! ${message}`);
}

function required(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    fail(`${name} is required`);
    return null;
  }
  return String(value).trim();
}

console.log('Billing POS — production preflight\n');

if (process.env.NODE_ENV !== 'production') {
  warn('NODE_ENV is not "production" (set in .env or PM2 env)');
}

const port = process.env.PORT || '3000';
ok(`PORT=${port}`);

const masterHost = required('MASTER_DB_HOST');
const masterUser = required('MASTER_DB_USER');
const masterPass = required('MASTER_DB_PASSWORD');
const masterDb = required('MASTER_DB_NAME');

if (masterHost && masterUser && masterPass && masterDb) {
  ok(`Master DB: ${masterUser}@${masterHost}/${masterDb}`);
}

const tenantHost = required('TENANT_DB_HOST');
const tenantUser = required('TENANT_DB_USER');
const tenantPass = required('TENANT_DB_PASSWORD');

if (tenantHost && tenantUser && tenantPass) {
  ok(`Tenant DB host: ${tenantHost}`);
}

const jwtSecret = required('JWT_SECRET');
const refreshSecret = required('JWT_REFRESH_SECRET');

if (jwtSecret) {
  if (jwtSecret.length < 32 || WEAK_SECRETS.has(jwtSecret)) {
    fail('JWT_SECRET must be 32+ chars and not a default value');
  } else {
    ok('JWT_SECRET looks strong');
  }
}

if (refreshSecret) {
  if (refreshSecret.length < 32 || WEAK_SECRETS.has(refreshSecret)) {
    fail('JWT_REFRESH_SECRET must be 32+ chars and not a default value');
  } else {
    ok('JWT_REFRESH_SECRET looks strong');
  }
}

const platformPassword = required('PLATFORM_ADMIN_PASSWORD');
if (platformPassword) {
  if (platformPassword.length < 12 || WEAK_SECRETS.has(platformPassword)) {
    fail('PLATFORM_ADMIN_PASSWORD must be 12+ chars and not the default Admin@123');
  } else {
    ok('PLATFORM_ADMIN_PASSWORD looks strong');
  }
}

const cors = process.env.CORS_ORIGINS || '';
if (!cors || cors.includes('localhost') || cors.includes('127.0.0.1')) {
  warn('CORS_ORIGINS still includes localhost — set your real app domain(s) for production');
} else {
  ok(`CORS_ORIGINS=${cors}`);
}

const uploadPath = process.env.UPLOAD_PATH;
if (!uploadPath) {
  fail('UPLOAD_PATH is required (e.g. /var/www/billing-poz/uploads)');
} else {
  ok(`UPLOAD_PATH=${uploadPath}`);
}

if (process.env.TRUST_PROXY !== '1') {
  warn('TRUST_PROXY should be 1 when running behind Nginx');
} else {
  ok('TRUST_PROXY=1');
}

if (process.exitCode) {
  console.error('\nPreflight failed. Fix api/.env before deploying.');
  process.exit(1);
}

console.log('\nPreflight passed. Ready to migrate and start with PM2.');
