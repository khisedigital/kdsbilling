const { getMasterModels } = require('../../models/master');
const jobQueue = require('./jobQueue');

const CACHE_TTL_MS = 30 * 1000;
const ERROR_TTL_MS = 5 * 60 * 1000;
/** Stock that came from Shopify with the same quantity Shopify already has — nothing to push. */
const SKIP_REFERENCE_TYPES = new Set(['shopify_import']);

const connectedCache = new Map();

async function isTenantConnected(tenantId) {
  const cached = connectedCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.connected;
  try {
    const { ShopifyShop } = getMasterModels();
    const row = await ShopifyShop.findOne({
      where: { tenant_id: tenantId, status: 'connected' },
      attributes: ['id'],
    });
    const connected = Boolean(row);
    connectedCache.set(tenantId, { connected, expiresAt: Date.now() + CACHE_TTL_MS });
    return connected;
  } catch (err) {
    connectedCache.set(tenantId, { connected: false, expiresAt: Date.now() + ERROR_TTL_MS });
    throw err;
  }
}

function invalidate(tenantId) {
  connectedCache.delete(tenantId);
}

async function enqueuePush(tenantId, { variantId, branchId }) {
  if (!(await isTenantConnected(tenantId))) return;
  await jobQueue.enqueue(
    tenantId,
    'inventory_push',
    { variantId, branchId },
    {
      coalesceKey: `inv:${tenantId}:${branchId}:${variantId}`,
      runAfter: new Date(Date.now() + 2000),
      maxAttempts: 10,
    }
  );
}

/**
 * Called by stockEngine.applyStockMovement for every POS stock change. Must never
 * throw or slow down billing: work is deferred until the surrounding transaction commits.
 */
function notifyStockMovement(db, { variantId, branchId, referenceType }, transaction) {
  try {
    const tenantId = db?.tenantId;
    if (!tenantId || !variantId || !branchId || SKIP_REFERENCE_TYPES.has(referenceType)) return;
    const run = () => {
      enqueuePush(tenantId, { variantId, branchId }).catch((err) => {
        console.error('[shopify] inventory push enqueue failed:', err.message);
      });
    };
    if (transaction && typeof transaction.afterCommit === 'function') transaction.afterCommit(run);
    else setImmediate(run);
  } catch (err) {
    console.error('[shopify] stock hook error:', err.message);
  }
}

module.exports = { notifyStockMovement, invalidate };
