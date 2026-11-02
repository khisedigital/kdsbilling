require('dotenv').config();
const path = require('path');

/** URL prefix helper (e.g. /kdspozr). */
function normalizeBasePath(raw) {
  if (!raw || !String(raw).trim()) return '';
  let p = String(raw).trim().replace(/\/+$/, '');
  if (!p.startsWith('/')) p = `/${p}`;
  if (p === '/') return '';
  return p;
}

// Nginx strips /kdspozr before Node, so Express always listens at /.
// BASE_PATH / PUBLIC_BASE_PATH only prefix admin HTML asset URLs.
const publicBasePath =
  normalizeBasePath(process.env.PUBLIC_BASE_PATH) ||
  normalizeBasePath(process.env.BASE_PATH);

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  /** Browser-facing prefix for admin assets, e.g. /kdspozr */
  publicBasePath,
  masterDb: {
    host: process.env.MASTER_DB_HOST || 'localhost',
    port: parseInt(process.env.MASTER_DB_PORT, 10) || 3306,
    database: process.env.MASTER_DB_NAME || 'billing_master',
    username: process.env.MASTER_DB_USER || 'root',
    password: process.env.MASTER_DB_PASSWORD || '',
  },
  tenantDb: {
    host: process.env.TENANT_DB_HOST || 'localhost',
    port: parseInt(process.env.TENANT_DB_PORT, 10) || 3306,
    username: process.env.TENANT_DB_USER || 'root',
    password: process.env.TENANT_DB_PASSWORD || '',
    /**
     * Shared-hosting MySQL users are often limited to prefix DBs.
     * Defaults to "{TENANT_DB_USER}_" when user is not root
     * (e.g. khisedigital → khisedigital_t_demo_kirana).
     */
    prefix: (() => {
      const explicit = String(process.env.TENANT_DB_PREFIX || '').trim();
      if (explicit) return explicit.endsWith('_') ? explicit : `${explicit}_`;
      const user = String(process.env.TENANT_DB_USER || 'root').trim();
      if (!user || user === 'root') return '';
      return `${user}_`;
    })(),
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-jwt-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  platform: {
    adminEmail: process.env.PLATFORM_ADMIN_EMAIL || 'admin@billingpos.com',
    adminUsername: process.env.PLATFORM_ADMIN_USERNAME || '',
    adminPassword: process.env.PLATFORM_ADMIN_PASSWORD || 'Admin@123',
    defaultTenantPassword: process.env.TENANT_DEFAULT_PASSWORD || '123456',
  },
  corsOrigins: [
    ...(process.env.CORS_ORIGINS || 'http://localhost:8081').split(',').map((origin) => origin.trim()),
    // Origin of the packaged Electron desktop app (custom app:// protocol)
    'app://kdspoz',
    // Browser web panel (mobile `npm run web:dist`)
    'https://billing.khisedigital.in',
  ],
  uploadPath: process.env.UPLOAD_PATH || path.join(process.cwd(), 'uploads'),
  trustProxy: process.env.TRUST_PROXY === '1',
  shopify: {
    apiKey: String(process.env.SHOPIFY_API_KEY || '').trim(),
    apiSecret: String(process.env.SHOPIFY_API_SECRET || '').trim(),
    scopes: String(
      process.env.SHOPIFY_SCOPES || 'read_products,read_inventory,write_inventory,read_locations,read_orders'
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .join(','),
    apiVersion: String(process.env.SHOPIFY_API_VERSION || '2026-07').trim(),
    /** Public HTTPS base of this API as Shopify reaches it, e.g. https://khisedigital.info/kdspozr */
    appUrl: String(process.env.SHOPIFY_APP_URL || '').trim().replace(/\/+$/, ''),
    tokenEncryptionKey: String(process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY || '').trim(),
    mobileReturnUrl: String(process.env.SHOPIFY_MOBILE_RETURN_URL || 'kdspoz://integrations/shopify').trim(),
    workerEnabled: process.env.SHOPIFY_WORKER !== '0',
    autoSyncHours: parseFloat(process.env.SHOPIFY_AUTO_SYNC_HOURS) || 12,
  },
};
