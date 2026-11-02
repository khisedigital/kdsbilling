const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const errorHandler = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth');
const platformRoutes = require('./routes/platform');
const catalogRoutes = require('./routes/catalog');
const inventoryRoutes = require('./routes/inventory');
const businessRoutes = require('./routes/business');
const integrationRoutes = require('./routes/integrations');
const shopifyPublicRoutes = require('./routes/shopifyPublic');

const app = express();
const publicBasePath = config.publicBasePath || '';

if (config.trustProxy) {
  app.set('trust proxy', 1);
}

const adminHtmlPath = path.join(__dirname, '../public/admin/index.html');
let adminHtmlTemplate = null;
let adminHtmlMtimeMs = 0;

function resolvePublicBase(req) {
  if (publicBasePath) return publicBasePath;
  const host = String(req.hostname || '')
    .split(':')[0]
    .replace(/^www\./, '');
  if (host === 'khisedigital.info') return '/kdspozr';
  return '';
}

function loadAdminHtml() {
  const stat = fs.statSync(adminHtmlPath);
  // Always reload in development so design/CSS edits show up without restart.
  // In production, reload only when the file mtime changes.
  const shouldReload =
    !adminHtmlTemplate ||
    config.env !== 'production' ||
    stat.mtimeMs !== adminHtmlMtimeMs;
  if (shouldReload) {
    adminHtmlTemplate = fs.readFileSync(adminHtmlPath, 'utf8');
    adminHtmlMtimeMs = stat.mtimeMs;
  }
  return adminHtmlTemplate;
}

function sendAdmin(req, res) {
  const prefix = resolvePublicBase(req);
  const html = loadAdminHtml().replaceAll('__ADMIN_BASE__', `${prefix}/admin/`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.type('html').send(html);
}

app.use(
  helmet({
    // Local admin is served over HTTP; default Helmet upgrades to HTTPS and breaks login.
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'upgrade-insecure-requests': null,
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
        'img-src': ["'self'", 'data:', 'blob:'],
        // Allow sync boot.js in <head> for admin session restore
        'script-src-attr': ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(
  cors({
    origin: config.corsOrigins,
    credentials: true,
  })
);
// Must precede express.json: webhook HMAC verification needs the untouched raw body.
app.use('/api/v1/shopify', shopifyPublicRoutes);
app.use(express.json({ limit: '10mb' }));
app.use(
  '/uploads',
  express.static(path.join(config.uploadPath), {
    // Shop logos are shown inside the desktop app, which runs on its own origin.
    setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
  })
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/health', (_req, res) => {
  res.json({
    success: true,
    status: 'ok',
    publicBasePath: publicBasePath || null,
    timestamp: new Date().toISOString(),
  });
});

app.get(['/admin', '/admin/'], sendAdmin);
app.use('/admin', (req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
  next();
});
app.use('/admin', express.static(path.join(__dirname, '../public/admin'), { index: false }));

app.use('/api/v1/auth', authLimiter, authRoutes);
app.use('/api/v1/platform', platformRoutes);
app.use('/api/v1/integrations', integrationRoutes);
app.use('/api/v1', catalogRoutes);
app.use('/api/v1', inventoryRoutes);
app.use('/api/v1', businessRoutes);

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  });
});

app.use(errorHandler);

module.exports = app;
