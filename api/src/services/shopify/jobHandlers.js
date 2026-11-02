const { Op } = require('sequelize');
const tenantConnectionManager = require('../../config/tenantConnectionManager');
const { createClient, ShopifyAuthError } = require('./shopifyClient');
const connectionService = require('./connectionService');
const productSync = require('./productSync');
const inventorySync = require('./inventorySync');
const orderSync = require('./orderSync');
const jobQueue = require('./jobQueue');
const { errorMessage } = require('./shopifyUtils');

/** Job types that act on a disconnected/uninstalled store and must not require a live connection. */
const LIFECYCLE_JOBS = new Set(['app_uninstalled', 'shop_redact']);

async function loadContext(job) {
  const tenant = await tenantConnectionManager.getTenantById(job.tenant_id);
  if (tenant.status !== 'active' && tenant.status !== 'trial') {
    return { skip: `tenant ${tenant.status}` };
  }
  const db = await tenantConnectionManager.getTenantModels(tenant);
  const ctx = { job, tenant, tenantId: tenant.id, db, heartbeat: () => jobQueue.heartbeat(job) };
  if (LIFECYCLE_JOBS.has(job.job_type)) return ctx;

  const connection = await connectionService.getConnectedConnection(db);
  if (!connection) return { skip: 'store not connected' };
  ctx.connection = connection;
  ctx.client = createClient(db, connection);
  return ctx;
}

function jobKey(job) {
  return `${job.id}:${job.attempts}`;
}

async function runPhase(ctx, statusField, atField, fn) {
  const { connection } = ctx;
  await connection.update({ [statusField]: 'running' });
  try {
    const result = await fn();
    const partial = Boolean(result?.errors);
    await connection.update({ [statusField]: partial ? 'partial' : 'ok', [atField]: new Date() });
    return { result };
  } catch (err) {
    if (err instanceof ShopifyAuthError) throw err;
    await connection.update({ [statusField]: 'error' });
    return { error: err };
  } finally {
    await ctx.heartbeat();
  }
}

async function fullSync(ctx) {
  const { db, tenantId, connection, job } = ctx;
  await connectionService.setSyncState(db, tenantId, connection, {
    product_sync_status: 'queued',
    inventory_sync_status: 'queued',
    order_sync_status: 'queued',
  }, { sync_status: 'running' });

  const problems = [];
  let retryable = null;

  const products = await runPhase(ctx, 'product_sync_status', 'product_sync_at', () => productSync.syncAllProducts(ctx));
  if (products.result) {
    await connection.update({ product_sync_summary: products.result });
    if (products.result.errors) problems.push(`Products: ${products.result.errors} failed (${products.result.lastErrors[0] || ''})`);
  } else {
    retryable = products.error;
    problems.push(`Products: ${errorMessage(products.error)}`);
  }

  const inventory = await runPhase(ctx, 'inventory_sync_status', 'inventory_sync_at', () =>
    inventorySync.pushAllInventory(ctx, jobKey(job))
  );
  if (inventory.result?.errors) problems.push(`Inventory: ${inventory.result.errors} failed (${inventory.result.lastErrors[0] || ''})`);
  if (inventory.error) {
    retryable = retryable || inventory.error;
    problems.push(`Inventory: ${errorMessage(inventory.error)}`);
  }

  const orders = await runPhase(ctx, 'order_sync_status', 'order_sync_at', () => orderSync.importRecentOrders(ctx));
  if (orders.result?.errors) problems.push(`Orders: ${orders.result.errors} failed`);
  if (orders.error) {
    retryable = retryable || orders.error;
    problems.push(`Orders: ${errorMessage(orders.error)}`);
  }

  const now = new Date();
  const lastError = problems.length ? problems.join(' | ').slice(0, 2000) : null;
  await connectionService.setSyncState(
    db,
    tenantId,
    connection,
    { last_sync_at: now, last_error: lastError, last_error_at: lastError ? now : null },
    { sync_status: lastError ? 'error' : 'ok' }
  );

  // Phase-level (network/API) failures are retried a few times; per-item problems are only reported.
  if (retryable && retryable.retryable !== false && job.attempts < 3) throw retryable;
}

async function appUninstalled(ctx) {
  const { db, tenantId } = ctx;
  const connection = await db.ShopifyConnection.findOne({
    where: { shop_domain: ctx.job.payload?.shop, status: { [Op.ne]: 'disconnected' } },
  });
  if (connection) {
    await connectionService.markDisconnected(db, tenantId, connection, 'App was uninstalled from Shopify');
  }
}

/** GDPR shop/redact (sent 48h after uninstall): remove everything stored for that shop. */
async function shopRedact(ctx) {
  const { db } = ctx;
  const shop = ctx.job.payload?.shop;
  if (!shop) return;
  await db.ShopifyConnection.destroy({ where: { shop_domain: shop, status: 'disconnected' } });
}

const handlers = {
  full_sync: fullSync,
  inventory_push: (ctx) => inventorySync.pushVariant(ctx, ctx.job.payload || {}, jobKey(ctx.job)),
  product_sync_one: (ctx) => productSync.syncProductById(ctx, ctx.job.payload?.productGid),
  product_delete: (ctx) => productSync.removeProductMappings(ctx, ctx.job.payload?.productGid),
  order_upsert: (ctx) => orderSync.importOrder(ctx, ctx.job.payload.order),
  order_cancelled: (ctx) => orderSync.cancelOrder(ctx, ctx.job.payload.order),
  register_webhooks: (ctx) => connectionService.registerWebhooks(ctx.db, ctx.connection),
  app_uninstalled: appUninstalled,
  shop_redact: shopRedact,
};

module.exports = { handlers, loadContext };
