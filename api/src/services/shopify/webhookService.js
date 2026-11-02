const { getMasterModels } = require('../../models/master');
const jobQueue = require('./jobQueue');
const { fromWebhookOrder } = require('./orderSync');
const { toGid } = require('./shopifyUtils');

/**
 * Turns a verified webhook into a queued job and returns quickly (Shopify expects a
 * 2xx within seconds). X-Shopify-Webhook-Id dedupes Shopify's at-least-once retries.
 */
async function routeWebhook({ topic, shop, webhookId, body }) {
  // Compliance topics: order mappings keep no customer PII, so there is nothing to export/redact per customer.
  if (topic === 'customers/data_request' || topic === 'customers/redact') {
    return { handled: 'compliance' };
  }

  const { ShopifyShop } = getMasterModels();
  const shopRow = await ShopifyShop.findOne({ where: { shop_domain: shop } });
  if (!shopRow) return { ignored: 'unknown shop' };

  const tenantId = shopRow.tenant_id;
  const dedupeKey = webhookId ? `wh:${webhookId}` : null;
  const productGid = body?.admin_graphql_api_id || toGid('Product', body?.id);

  switch (topic) {
    case 'app/uninstalled':
      await jobQueue.enqueue(tenantId, 'app_uninstalled', { shop }, { dedupeKey });
      await shopRow.update({ status: 'disconnected', sync_status: 'idle', disconnected_at: new Date() });
      return { queued: 'app_uninstalled' };
    case 'shop/redact':
      await jobQueue.enqueue(tenantId, 'shop_redact', { shop }, { dedupeKey });
      return { queued: 'shop_redact' };
    case 'orders/create':
      await jobQueue.enqueue(tenantId, 'order_upsert', { order: fromWebhookOrder(body) }, { dedupeKey });
      return { queued: 'order_upsert' };
    case 'orders/cancelled':
      await jobQueue.enqueue(tenantId, 'order_cancelled', { order: fromWebhookOrder(body) }, { dedupeKey });
      return { queued: 'order_cancelled' };
    case 'products/create':
    case 'products/update':
      if (!productGid) return { ignored: 'no product id' };
      await jobQueue.enqueue(tenantId, 'product_sync_one', { productGid }, {
        coalesceKey: `prod:${tenantId}:${productGid}`,
        runAfter: new Date(Date.now() + 5000),
      });
      return { queued: 'product_sync_one' };
    case 'products/delete':
      if (!productGid) return { ignored: 'no product id' };
      await jobQueue.enqueue(tenantId, 'product_delete', { productGid }, { dedupeKey });
      return { queued: 'product_delete' };
    default:
      return { ignored: topic };
  }
}

module.exports = { routeWebhook };
