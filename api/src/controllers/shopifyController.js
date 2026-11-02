const config = require('../config');
const connectionService = require('../services/shopify/connectionService');
const { routeWebhook } = require('../services/shopify/webhookService');
const {
  isConfigured,
  verifyWebhookHmac,
  parseJsonPreservingIds,
} = require('../services/shopify/shopifyUtils');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function returnUrl(status) {
  const base = config.shopify.mobileReturnUrl;
  return `${base}${base.includes('?') ? '&' : '?'}status=${encodeURIComponent(status)}`;
}

function resultPage({ ok, title, message }) {
  const link = returnUrl(ok ? 'connected' : 'error');
  const color = ok ? '#16a34a' : '#dc2626';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${ok ? `<meta http-equiv="refresh" content="2;url=${escapeHtml(link)}">` : ''}
<title>${escapeHtml(title)}</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f4f6fb;color:#1f2937;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
  .card{background:#fff;border-radius:16px;box-shadow:0 8px 30px rgba(15,23,42,.08);padding:32px 24px;max-width:420px;width:100%;text-align:center}
  .icon{width:56px;height:56px;border-radius:50%;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:28px;color:#fff;background:${color}}
  h1{font-size:20px;margin:0 0 8px}
  p{font-size:15px;line-height:1.5;color:#4b5563;margin:0 0 24px}
  a.btn{display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600}
</style></head>
<body><div class="card">
  <div class="icon">${ok ? '&#10003;' : '!'}</div>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
  <a class="btn" href="${escapeHtml(link)}">Return to POS app</a>
</div></body></html>`;
}

async function getStatus(req, res) {
  const data = await connectionService.getStatus(req.db, req.tenant.id);
  res.json({ success: true, data });
}

async function connect(req, res) {
  const data = await connectionService.startConnect(req.db, {
    tenantId: req.tenant.id,
    userId: req.auth.sub,
    branchId: req.auth.branchId,
    shopDomain: req.body?.shopDomain,
  });
  res.json({ success: true, data });
}

async function sync(req, res) {
  const data = await connectionService.requestSync(req.db, req.tenant.id);
  res.json({ success: true, data });
}

async function disconnect(req, res) {
  const data = await connectionService.disconnect(req.db, req.tenant.id);
  res.json({ success: true, data });
}

async function oauthCallback(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await connectionService.handleOAuthCallback(req.query);
    res.type('html').send(resultPage({
      ok: true,
      title: 'Shopify connected',
      message: `${result.shopName} is now linked to your POS. Products and stock will sync in the background.`,
    }));
  } catch (err) {
    if (!err.statusCode) console.error('[shopify] OAuth callback failed:', err.message);
    res.status(err.statusCode && err.statusCode < 500 ? err.statusCode : 400).type('html').send(resultPage({
      ok: false,
      title: 'Could not connect Shopify',
      message: err.statusCode ? err.message : 'Something went wrong while connecting your store. Please try again from the app.',
    }));
  }
}

async function webhook(req, res) {
  if (!isConfigured()) return res.status(503).send('Not configured');
  const raw = req.body;
  if (!verifyWebhookHmac(raw, req.get('X-Shopify-Hmac-Sha256'))) {
    return res.status(401).send('Invalid signature');
  }
  const topic = String(req.get('X-Shopify-Topic') || '').toLowerCase();
  const shop = String(req.get('X-Shopify-Shop-Domain') || '').toLowerCase();
  const webhookId = req.get('X-Shopify-Webhook-Id') || req.get('X-Shopify-Event-Id') || null;

  let body;
  try {
    body = parseJsonPreservingIds(raw);
  } catch (_) {
    return res.status(400).send('Invalid JSON');
  }

  await routeWebhook({ topic, shop, webhookId, body });
  return res.status(200).json({ success: true });
}

module.exports = { getStatus, connect, sync, disconnect, oauthCallback, webhook };
