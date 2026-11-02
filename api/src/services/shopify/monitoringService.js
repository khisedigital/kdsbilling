const { Op } = require('sequelize');
const { getMasterModels } = require('../../models/master');
const jobQueue = require('./jobQueue');
const { isConfigured } = require('./shopifyUtils');

/** Super-admin monitoring: read-only, never includes tokens or other credentials. */
async function listShopifyConnections(query = {}) {
  const { Tenant, ShopifyShop } = getMasterModels();
  const search = String(query.search || '').trim();
  const status = String(query.status || '').trim();

  const where = { status: { [Op.ne]: 'deleted' } };
  if (search) {
    where[Op.or] = [
      { name: { [Op.like]: `%${search}%` } },
      { slug: { [Op.like]: `%${search}%` } },
      { '$shopifyShop.shop_domain$': { [Op.like]: `%${search}%` } },
    ];
  }
  if (status === 'not_connected') {
    where[Op.and] = [{ [Op.or]: [{ '$shopifyShop.id$': null }, { '$shopifyShop.status$': 'disconnected' }] }];
  } else if (status) {
    where['$shopifyShop.status$'] = status;
  }

  const tenants = await Tenant.findAll({
    where,
    attributes: ['id', 'name', 'slug', 'status'],
    include: [{
      model: ShopifyShop,
      as: 'shopifyShop',
      required: false,
      attributes: ['shop_domain', 'shop_name', 'status', 'sync_status', 'last_sync_at', 'last_error', 'last_error_at', 'connected_at', 'disconnected_at'],
    }],
    order: [['name', 'ASC']],
  });

  const stats = await jobQueue.jobStats(tenants.map((t) => t.id));
  const items = tenants.map((t) => {
    const shop = t.shopifyShop;
    const jobs = stats.get(t.id) || { pending: 0, running: 0, failed: 0 };
    return {
      tenantId: t.id,
      customer: t.name,
      slug: t.slug,
      tenantStatus: t.status,
      connected: shop?.status === 'connected',
      connectionStatus: shop?.status || 'not_connected',
      store: shop?.shop_domain || null,
      storeName: shop?.shop_name || null,
      syncStatus: shop?.sync_status || null,
      lastSyncAt: shop?.last_sync_at || null,
      lastError: shop?.last_error || null,
      lastErrorAt: shop?.last_error_at || null,
      connectedAt: shop?.connected_at || null,
      pendingJobs: jobs.pending + jobs.running,
      failedJobs: jobs.failed,
    };
  });

  const summary = {
    configured: isConfigured(),
    total: items.length,
    connected: items.filter((i) => i.connected).length,
    errors: items.filter((i) => i.connectionStatus === 'error' || i.syncStatus === 'error').length,
    pendingJobs: items.reduce((sum, i) => sum + i.pendingJobs, 0),
  };
  return { items, summary };
}

module.exports = { listShopifyConnections };
