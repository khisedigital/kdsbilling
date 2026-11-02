const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const config = require('../../config');
const AppError = require('../../utils/AppError');
const tenantConnectionManager = require('../../config/tenantConnectionManager');
const { getMasterModels } = require('../../models/master');
const {
  WEBHOOK_TOPICS,
  isConfigured,
  assertConfigured,
  normalizeShopDomain,
  isValidShopDomain,
  safeEqual,
  verifyOAuthHmac,
  decryptToken,
  errorMessage,
} = require('./shopifyUtils');
const {
  ShopifyAuthError,
  exchangeCodeForToken,
  tokenFields,
  createClient,
  assertNoUserErrors,
} = require('./shopifyClient');
const jobQueue = require('./jobQueue');
const stockHook = require('./stockHook');

const STATE_TYPE = 'shopify_oauth';
const STATE_TTL = '15m';

function stateSecret() {
  return crypto.createHmac('sha256', config.jwt.secret).update('shopify-oauth-state').digest('hex');
}

function callbackUrl() {
  return `${config.shopify.appUrl}/api/v1/shopify/oauth/callback`;
}

function webhookUrl() {
  return `${config.shopify.appUrl}/api/v1/shopify/webhooks`;
}

function wrapMissingTable(err) {
  const code = err?.original?.code || err?.parent?.code;
  if (code === 'ER_NO_SUCH_TABLE') {
    return new AppError(
      'Shopify integration tables are missing for this shop. Run tenant migrations.',
      503,
      'SHOPIFY_NOT_READY'
    );
  }
  return err;
}

/** The tenant's current (non-disconnected first) Shopify connection, if any. */
async function getActiveConnection(db) {
  const { ShopifyConnection } = db;
  return (
    (await ShopifyConnection.findOne({
      where: { status: { [Op.in]: ['connected', 'error', 'pending'] } },
      order: [['updated_at', 'DESC']],
    })) ||
    (await ShopifyConnection.findOne({ order: [['updated_at', 'DESC']] }))
  );
}

async function getConnectedConnection(db) {
  return db.ShopifyConnection.findOne({
    where: { status: 'connected' },
    order: [['updated_at', 'DESC']],
  });
}

async function updateMasterShop(tenantId, fields) {
  const { ShopifyShop } = getMasterModels();
  const existing = await ShopifyShop.findOne({ where: { tenant_id: tenantId } });
  if (existing) return existing.update(fields);
  return ShopifyShop.create({ tenant_id: tenantId, ...fields });
}

async function mirrorMasterSafe(tenantId, fields) {
  try {
    await updateMasterShop(tenantId, fields);
  } catch (err) {
    console.error('[shopify] master mirror failed:', err.message);
  }
}

/** Updates sync fields on the tenant connection and mirrors a summary to master monitoring. */
async function setSyncState(db, tenantId, connection, fields, masterFields = {}) {
  await connection.update(fields);
  const master = { ...masterFields };
  if (fields.last_sync_at) master.last_sync_at = fields.last_sync_at;
  if (fields.last_error !== undefined) {
    master.last_error = fields.last_error;
    master.last_error_at = fields.last_error ? new Date() : null;
  }
  if (Object.keys(master).length) await mirrorMasterSafe(tenantId, master);
}

async function markConnectionAuthError(db, tenantId, connection, err) {
  const message = errorMessage(err);
  await connection.update({ status: 'error', last_error: message, last_error_at: new Date() });
  stockHook.invalidate(tenantId);
  await mirrorMasterSafe(tenantId, {
    status: 'error',
    sync_status: 'error',
    last_error: message,
    last_error_at: new Date(),
  });
}

function serializeStatus(connection, extra = {}) {
  const base = {
    configured: isConfigured(),
    connected: false,
    status: 'not_connected',
    shopDomain: null,
    shopName: null,
    locationName: null,
    branchId: null,
    branchName: null,
    productSync: { status: 'idle', lastSyncAt: null, mappedCount: 0, summary: null },
    inventorySync: { status: 'idle', lastSyncAt: null },
    orderSync: { status: 'idle', lastSyncAt: null, orderCount: 0 },
    lastSyncAt: null,
    lastError: null,
    lastErrorAt: null,
    connectedAt: null,
    syncInProgress: false,
    ...extra,
  };
  if (!connection) return base;
  return {
    ...base,
    connected: connection.status === 'connected',
    status: connection.status,
    shopDomain: connection.shop_domain,
    shopName: connection.shop_name,
    locationName: connection.shopify_location_name,
    branchId: connection.branch_id,
    branchName: connection.branch?.name || null,
    productSync: {
      status: connection.product_sync_status,
      lastSyncAt: connection.product_sync_at,
      mappedCount: extra.mappedCount || 0,
      summary: connection.product_sync_summary || null,
    },
    inventorySync: {
      status: connection.inventory_sync_status,
      lastSyncAt: connection.inventory_sync_at,
    },
    orderSync: {
      status: connection.order_sync_status,
      lastSyncAt: connection.order_sync_at,
      orderCount: extra.orderCount || 0,
    },
    lastSyncAt: connection.last_sync_at,
    lastError: connection.last_error,
    lastErrorAt: connection.last_error_at,
    connectedAt: connection.connected_at,
  };
}

async function getStatus(db, tenantId) {
  try {
    const connection = await getActiveConnection(db);
    if (!connection) return serializeStatus(null);
    await connection.reload({ include: [{ model: db.Branch, as: 'branch', attributes: ['id', 'name'] }] });
    const [mappedCount, orderCount, syncInProgress] = await Promise.all([
      db.ShopifyProductMapping.count({ where: { connection_id: connection.id } }),
      db.ShopifyOrderMapping.count({ where: { connection_id: connection.id } }),
      connection.status === 'connected'
        ? jobQueue.hasPendingJob(tenantId, ['full_sync'])
        : Promise.resolve(false),
    ]);
    // Never include tokens, nonces or scopes in anything sent to the app.
    return serializeStatus(connection, { mappedCount, orderCount, syncInProgress });
  } catch (err) {
    throw wrapMissingTable(err);
  }
}

async function resolveBranchId(db, preferredBranchId) {
  if (preferredBranchId) {
    const branch = await db.Branch.findOne({ where: { id: preferredBranchId, status: 'active' } });
    if (branch) return branch.id;
  }
  const fallback =
    (await db.Branch.findOne({ where: { is_default: true, status: 'active' } })) ||
    (await db.Branch.findOne({ where: { status: 'active' }, order: [['created_at', 'ASC']] }));
  return fallback?.id || null;
}

/** Step 1: validate the shop and return Shopify's authorize URL with a signed, single-use state. */
async function startConnect(db, { tenantId, userId, branchId, shopDomain }) {
  assertConfigured();
  const shop = normalizeShopDomain(shopDomain);
  if (!shop) {
    throw new AppError('Enter a valid store domain, e.g. mystore.myshopify.com', 400, 'VALIDATION_ERROR');
  }

  const { ShopifyShop } = getMasterModels();
  const claimed = await ShopifyShop.findOne({
    where: {
      shop_domain: shop,
      tenant_id: { [Op.ne]: tenantId },
      status: { [Op.in]: ['connected', 'error'] },
    },
  });
  if (claimed) {
    throw new AppError('This Shopify store is already connected to another account', 409, 'SHOPIFY_STORE_IN_USE');
  }

  try {
    const { ShopifyConnection } = db;
    const other = await ShopifyConnection.findOne({
      where: { status: { [Op.in]: ['connected', 'error'] }, shop_domain: { [Op.ne]: shop } },
    });
    if (other) {
      throw new AppError(
        `Disconnect ${other.shop_domain} before connecting a different store`,
        409,
        'SHOPIFY_ALREADY_CONNECTED'
      );
    }

    const nonce = crypto.randomBytes(24).toString('hex');
    let connection = await ShopifyConnection.findOne({ where: { shop_domain: shop } });
    const fields = {
      oauth_nonce: nonce,
      oauth_requested_at: new Date(),
      branch_id: connection?.branch_id || (await resolveBranchId(db, branchId)),
    };
    if (connection) {
      if (connection.status === 'disconnected') fields.status = 'pending';
      await connection.update(fields);
    } else {
      connection = await ShopifyConnection.create({ shop_domain: shop, status: 'pending', ...fields });
    }

    const state = jwt.sign(
      { typ: STATE_TYPE, tid: tenantId, uid: userId, bid: branchId || null, shop, nonce },
      stateSecret(),
      { expiresIn: STATE_TTL }
    );
    const params = new URLSearchParams({
      client_id: config.shopify.apiKey,
      scope: config.shopify.scopes,
      redirect_uri: callbackUrl(),
      state,
    });
    return { shopDomain: shop, authUrl: `https://${shop}/admin/oauth/authorize?${params.toString()}` };
  } catch (err) {
    throw wrapMissingTable(err);
  }
}

const SHOP_INFO_QUERY = `
  query ShopInfo {
    shop { name currencyCode myshopifyDomain }
    location { id name isActive }
  }
`;

const FIRST_LOCATION_QUERY = `
  query FirstLocation {
    locations(first: 1) { nodes { id name isActive } }
  }
`;

const WEBHOOKS_QUERY = `
  query Webhooks($cursor: String) {
    webhookSubscriptions(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { id topic uri }
    }
  }
`;

const WEBHOOK_CREATE = `
  mutation WebhookCreate($topic: WebhookSubscriptionTopic!, $uri: String!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: { uri: $uri, format: JSON }) {
      webhookSubscription { id topic }
      userErrors { field message }
    }
  }
`;

const WEBHOOK_DELETE = `
  mutation WebhookDelete($id: ID!) {
    webhookSubscriptionDelete(id: $id) {
      deletedWebhookSubscriptionId
      userErrors { field message }
    }
  }
`;

async function listWebhooks(client) {
  const nodes = [];
  let cursor = null;
  do {
    const data = await client.query(WEBHOOKS_QUERY, { cursor });
    const conn = data.webhookSubscriptions;
    nodes.push(...(conn?.nodes || []));
    cursor = conn?.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor);
  return nodes;
}

/** Idempotent: creates only the topics not already pointing at this API. */
async function registerWebhooks(db, connection) {
  const client = createClient(db, connection);
  const uri = webhookUrl();
  const existing = await listWebhooks(client);
  const ids = {};
  for (const topic of WEBHOOK_TOPICS) {
    const found = existing.find((w) => w.topic === topic && w.uri === uri);
    if (found) {
      ids[topic] = found.id;
      continue;
    }
    const data = await client.query(WEBHOOK_CREATE, { topic, uri });
    assertNoUserErrors(data.webhookSubscriptionCreate, `Webhook ${topic}`);
    ids[topic] = data.webhookSubscriptionCreate.webhookSubscription.id;
  }
  await connection.update({ webhook_ids: ids });
  return ids;
}

async function deleteWebhooks(db, connection) {
  const client = createClient(db, connection);
  const uri = webhookUrl();
  const existing = await listWebhooks(client);
  for (const hook of existing.filter((w) => w.uri === uri)) {
    try {
      await client.query(WEBHOOK_DELETE, { id: hook.id });
    } catch (_) {
      /* best effort */
    }
  }
}

function verifyState(state, shop) {
  let payload;
  try {
    payload = jwt.verify(String(state || ''), stateSecret());
  } catch (_) {
    throw new AppError('The connection link has expired. Start again from the app.', 400, 'SHOPIFY_STATE_INVALID');
  }
  if (payload.typ !== STATE_TYPE || payload.shop !== shop || !payload.tid || !payload.nonce) {
    throw new AppError('Invalid connection request', 400, 'SHOPIFY_STATE_INVALID');
  }
  return payload;
}

/** Step 2: Shopify redirects here after the merchant approves the app. */
async function handleOAuthCallback(query) {
  assertConfigured();
  if (!verifyOAuthHmac(query)) throw new AppError('Invalid Shopify signature', 400, 'SHOPIFY_HMAC_INVALID');
  const shop = String(query.shop || '').toLowerCase();
  if (!isValidShopDomain(shop)) throw new AppError('Invalid shop domain', 400, 'SHOPIFY_SHOP_INVALID');
  if (!query.code) throw new AppError('Missing authorization code', 400, 'SHOPIFY_CODE_MISSING');
  const ts = Number(query.timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 3600) {
    throw new AppError('The connection request is too old. Start again from the app.', 400, 'SHOPIFY_STATE_INVALID');
  }

  const state = verifyState(query.state, shop);
  const tenant = await tenantConnectionManager.getTenantConfig(state.tid);
  const db = await tenantConnectionManager.getTenantModels(tenant);
  const { ShopifyConnection } = db;

  const connection = await ShopifyConnection.findOne({ where: { shop_domain: shop } });
  if (!connection || !connection.oauth_nonce || !safeEqual(connection.oauth_nonce, state.nonce)) {
    throw new AppError('This connection link was already used or replaced. Start again from the app.', 400, 'SHOPIFY_STATE_INVALID');
  }
  const [consumed] = await ShopifyConnection.update(
    { oauth_nonce: null },
    { where: { id: connection.id, oauth_nonce: state.nonce } }
  );
  if (consumed !== 1) throw new AppError('This connection link was already used', 400, 'SHOPIFY_STATE_INVALID');

  const { ShopifyShop } = getMasterModels();
  const claimed = await ShopifyShop.findOne({
    where: { shop_domain: shop, tenant_id: { [Op.ne]: tenant.id }, status: { [Op.in]: ['connected', 'error'] } },
  });
  if (claimed) {
    throw new AppError('This Shopify store is already connected to another account', 409, 'SHOPIFY_STORE_IN_USE');
  }

  const tokenBody = await exchangeCodeForToken(shop, String(query.code));
  const now = new Date();
  await connection.update({
    ...tokenFields(tokenBody),
    status: 'connected',
    connected_by: state.uid || connection.connected_by,
    connected_at: now,
    disconnected_at: null,
    last_error: null,
    last_error_at: null,
    branch_id: connection.branch_id || (await resolveBranchId(db, state.bid)),
  });

  const client = createClient(db, connection);
  const info = await client.query(SHOP_INFO_QUERY);
  if (!info.location?.id) {
    const fallback = await client.query(FIRST_LOCATION_QUERY);
    info.location = fallback.locations?.nodes?.[0] || null;
  }
  await connection.update({
    shop_name: info.shop?.name || null,
    shop_currency: info.shop?.currencyCode || null,
    shopify_location_id: info.location?.id || null,
    shopify_location_name: info.location?.name || null,
  });

  // Release the domain from any stale (pending/disconnected) claim held by another tenant.
  await ShopifyShop.update(
    { shop_domain: null },
    { where: { shop_domain: shop, tenant_id: { [Op.ne]: tenant.id } } }
  );
  await updateMasterShop(tenant.id, {
    shop_domain: shop,
    shop_name: info.shop?.name || null,
    status: 'connected',
    sync_status: 'queued',
    connected_at: now,
    disconnected_at: null,
    last_error: null,
    last_error_at: null,
  });
  stockHook.invalidate(tenant.id);

  try {
    await registerWebhooks(db, connection);
  } catch (err) {
    console.error('[shopify] webhook registration failed, retrying in background:', err.message);
    await jobQueue.enqueue(tenant.id, 'register_webhooks', {}, { coalesceKey: `webhooks:${tenant.id}` });
  }

  await connection.update({
    product_sync_status: 'queued',
    inventory_sync_status: 'queued',
    order_sync_status: 'queued',
  });
  await jobQueue.enqueue(tenant.id, 'full_sync', { reason: 'connected' }, { coalesceKey: `full:${tenant.id}` });

  return { shop, shopName: info.shop?.name || shop };
}

async function revokeAccessToken(connection) {
  try {
    const token = decryptToken(connection.access_token_enc);
    if (!token) return;
    await fetch(`https://${connection.shop_domain}/admin/api_permissions/current.json`, {
      method: 'DELETE',
      headers: { 'X-Shopify-Access-Token': token },
      signal: AbortSignal.timeout(15000),
    });
  } catch (_) {
    /* best effort — local tokens are wiped regardless */
  }
}

function clearedConnectionFields() {
  return {
    status: 'disconnected',
    access_token_enc: null,
    refresh_token_enc: null,
    access_token_expires_at: null,
    refresh_token_expires_at: null,
    oauth_nonce: null,
    webhook_ids: null,
    disconnected_at: new Date(),
    product_sync_status: 'idle',
    inventory_sync_status: 'idle',
    order_sync_status: 'idle',
  };
}

/** Wipes tokens locally. Mappings are kept so a reconnect to the same store resumes cleanly. */
async function markDisconnected(db, tenantId, connection, reason) {
  await connection.update({ ...clearedConnectionFields(), last_error: reason || null });
  await jobQueue.cancelPendingJobs(tenantId, 'Cancelled: Shopify disconnected');
  stockHook.invalidate(tenantId);
  await mirrorMasterSafe(tenantId, {
    status: 'disconnected',
    sync_status: 'idle',
    disconnected_at: new Date(),
    last_error: reason || null,
    last_error_at: reason ? new Date() : null,
  });
}

async function disconnect(db, tenantId) {
  try {
    const connection = await getActiveConnection(db);
    if (!connection || connection.status === 'disconnected') {
      throw new AppError('No Shopify store is connected', 404, 'SHOPIFY_NOT_CONNECTED');
    }
    if (connection.access_token_enc && isConfigured()) {
      try {
        await deleteWebhooks(db, connection);
      } catch (_) {
        /* token may already be invalid */
      }
      await revokeAccessToken(connection);
    }
    await markDisconnected(db, tenantId, connection, null);
    return getStatus(db, tenantId);
  } catch (err) {
    throw wrapMissingTable(err);
  }
}

async function requestSync(db, tenantId) {
  assertConfigured();
  try {
    const connection = await getConnectedConnection(db);
    if (!connection) {
      throw new AppError('Connect a Shopify store first', 400, 'SHOPIFY_NOT_CONNECTED');
    }
    await jobQueue.enqueue(tenantId, 'full_sync', { reason: 'manual' }, { coalesceKey: `full:${tenantId}` });
    const queued = (s) => (s === 'running' ? s : 'queued');
    await connection.update({
      product_sync_status: queued(connection.product_sync_status),
      inventory_sync_status: queued(connection.inventory_sync_status),
      order_sync_status: queued(connection.order_sync_status),
    });
    await mirrorMasterSafe(tenantId, { sync_status: 'queued' });
    return getStatus(db, tenantId);
  } catch (err) {
    throw wrapMissingTable(err);
  }
}

module.exports = {
  ShopifyAuthError,
  getActiveConnection,
  getConnectedConnection,
  getStatus,
  startConnect,
  handleOAuthCallback,
  registerWebhooks,
  disconnect,
  markDisconnected,
  markConnectionAuthError,
  requestSync,
  setSyncState,
  mirrorMasterSafe,
  updateMasterShop,
};
