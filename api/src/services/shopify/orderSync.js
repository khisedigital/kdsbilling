const { applyStockMovement, MOVEMENT_TYPES } = require('../stockEngine');
const { paginate } = require('./shopifyClient');
const { toGid, truncate } = require('./shopifyUtils');
const { getSystemUserId } = require('./productSync');

const ORDER_FIELDS = `
  id name createdAt cancelledAt
  displayFinancialStatus displayFulfillmentStatus currencyCode
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  lineItems(first: 25) {
    pageInfo { hasNextPage endCursor }
    nodes { sku name quantity variant { id } }
  }
`;

const ORDERS_QUERY = `
  query Orders($cursor: String, $query: String) {
    orders(first: 10, after: $cursor, query: $query, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes { ${ORDER_FIELDS} }
    }
  }
`;

const ORDER_LINES_QUERY = `
  query OrderLines($id: ID!, $cursor: String) {
    order(id: $id) {
      lineItems(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { sku name quantity variant { id } }
      }
    }
  }
`;

function fromGraphqlOrder(node, lineNodes) {
  return {
    id: node.id,
    name: node.name,
    createdAt: node.createdAt,
    cancelledAt: node.cancelledAt,
    financialStatus: node.displayFinancialStatus,
    fulfillmentStatus: node.displayFulfillmentStatus,
    currency: node.currentTotalPriceSet?.shopMoney?.currencyCode || node.currencyCode,
    total: node.currentTotalPriceSet?.shopMoney?.amount,
    lineItems: lineNodes.map((l) => ({
      variantId: l.variant?.id || null,
      sku: l.sku || null,
      title: l.name || null,
      quantity: Number(l.quantity) || 0,
    })),
  };
}

/** Minimal, PII-free projection of an orders/* webhook payload. */
function fromWebhookOrder(body) {
  return {
    id: body.admin_graphql_api_id || toGid('Order', body.id),
    name: body.name || null,
    createdAt: body.created_at || null,
    cancelledAt: body.cancelled_at || null,
    financialStatus: body.financial_status || null,
    fulfillmentStatus: body.fulfillment_status || null,
    currency: body.currency || null,
    total: body.current_total_price ?? body.total_price ?? null,
    lineItems: (body.line_items || []).map((l) => ({
      variantId: l.variant_id ? toGid('ProductVariant', l.variant_id) : null,
      sku: l.sku || null,
      title: l.title || l.name || null,
      quantity: Number(l.quantity) || 0,
    })),
  };
}

function orderSummaryFields(order) {
  const itemCount = order.lineItems.reduce((sum, l) => sum + (l.quantity || 0), 0);
  const total = parseFloat(order.total);
  return {
    shopify_order_name: truncate(order.name, 50),
    financial_status: truncate(order.financialStatus, 40),
    fulfillment_status: truncate(order.fulfillmentStatus, 40),
    currency_code: truncate(order.currency, 3),
    total_amount: Number.isFinite(total) ? total : null,
    item_count: itemCount,
    shopify_created_at: order.createdAt ? new Date(order.createdAt) : null,
  };
}

async function applyLines(ctx, lines, sign, referenceType, referenceId, transaction) {
  const { db, connection } = ctx;
  const userId = ctx.systemUserId || (ctx.systemUserId = await getSystemUserId(db, connection));
  const result = [];
  for (const line of lines) {
    const entry = { ...line, applied: false };
    if (line.variantId && line.quantity > 0 && connection.branch_id && userId) {
      const mapping = await db.ShopifyProductMapping.findOne({
        where: { connection_id: connection.id, shopify_variant_id: line.variantId },
        transaction,
      });
      if (mapping) {
        const variantActive = await db.ProductVariant.findOne({
          where: { id: mapping.variant_id, deleted_at: null, status: 'active' },
          attributes: ['id'],
          transaction,
        });
        if (variantActive) {
          await applyStockMovement(
            db,
            {
              branchId: connection.branch_id,
              variantId: mapping.variant_id,
              quantityChange: sign * line.quantity,
              movementType: sign < 0 ? MOVEMENT_TYPES.SALE : MOVEMENT_TYPES.STOCK_IN,
              referenceType,
              referenceId,
              notes: `Shopify order ${ctx.orderName || ''}`.trim(),
              userId,
              allowNegative: true,
            },
            transaction
          );
          entry.applied = true;
          entry.posVariantId = mapping.variant_id;
        }
      }
    }
    result.push(entry);
  }
  return result;
}

async function cancelMapping(ctx, mapping, cancelledAt, transaction) {
  if (mapping.status !== 'imported') return false;
  const applied = (mapping.line_items || []).filter((l) => l.applied);
  ctx.orderName = mapping.shopify_order_name;
  await applyLines(ctx, applied, +1, 'shopify_order_cancel', mapping.id, transaction);
  await mapping.update(
    {
      status: 'cancelled',
      shopify_cancelled_at: cancelledAt ? new Date(cancelledAt) : new Date(),
      processed_at: new Date(),
    },
    { transaction }
  );
  return true;
}

/**
 * Records a Shopify order and, for orders placed after the store was connected,
 * deducts sold quantities from the linked POS branch exactly once.
 */
async function importOrder(ctx, order) {
  const { db, connection } = ctx;
  const { ShopifyOrderMapping } = db;
  ctx.orderName = order.name;

  return db.sequelize.transaction(async (transaction) => {
    const existing = await ShopifyOrderMapping.findOne({
      where: { connection_id: connection.id, shopify_order_id: order.id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (existing) {
      await existing.update(orderSummaryFields(order), { transaction });
      if (order.cancelledAt) await cancelMapping(ctx, existing, order.cancelledAt, transaction);
      return { status: 'exists' };
    }

    const mapping = await ShopifyOrderMapping.create(
      {
        connection_id: connection.id,
        shopify_order_id: order.id,
        ...orderSummaryFields(order),
        status: order.cancelledAt ? 'cancelled' : 'imported',
        shopify_cancelled_at: order.cancelledAt ? new Date(order.cancelledAt) : null,
        line_items: order.lineItems.map((l) => ({ ...l, applied: false })),
        processed_at: new Date(),
      },
      { transaction }
    );

    const placedAfterConnect =
      !connection.connected_at || !order.createdAt || new Date(order.createdAt) >= new Date(connection.connected_at);
    if (order.cancelledAt || !placedAfterConnect) return { status: 'recorded' };

    const lines = await applyLines(ctx, order.lineItems, -1, 'shopify_order', mapping.id, transaction);
    const unmapped = lines.filter((l) => !l.applied && l.quantity > 0).length;
    await mapping.update(
      { line_items: lines, error: unmapped ? `${unmapped} line(s) not linked to a POS product` : null },
      { transaction }
    );
    return { status: 'imported', unmapped };
  });
}

async function cancelOrder(ctx, order) {
  const { db, connection } = ctx;
  const existing = await db.ShopifyOrderMapping.findOne({
    where: { connection_id: connection.id, shopify_order_id: order.id },
  });
  if (!existing) return importOrder(ctx, { ...order, cancelledAt: order.cancelledAt || new Date().toISOString() });
  return db.sequelize.transaction(async (transaction) => {
    const locked = await db.ShopifyOrderMapping.findByPk(existing.id, { transaction, lock: transaction.LOCK.UPDATE });
    await cancelMapping(ctx, locked, order.cancelledAt, transaction);
    return { status: 'cancelled' };
  });
}

async function loadAllLines(client, node) {
  const lines = [...(node.lineItems?.nodes || [])];
  let cursor = node.lineItems?.pageInfo?.hasNextPage ? node.lineItems.pageInfo.endCursor : null;
  while (cursor) {
    const data = await client.query(ORDER_LINES_QUERY, { id: node.id, cursor });
    const conn = data.order?.lineItems;
    lines.push(...(conn?.nodes || []));
    cursor = conn?.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
  }
  return lines;
}

/** Catches up on orders created since connection (or the last sync, with overlap) — covers missed webhooks. */
async function importRecentOrders(ctx) {
  const { connection, client } = ctx;
  const connectedAt = connection.connected_at ? new Date(connection.connected_at) : new Date(Date.now() - 86400000);
  const lastSync = connection.order_sync_at ? new Date(new Date(connection.order_sync_at).getTime() - 86400000) : null;
  const since = lastSync && lastSync > connectedAt ? lastSync : connectedAt;
  const summary = { fetched: 0, imported: 0, cancelled: 0, errors: 0 };

  await paginate(
    client,
    ORDERS_QUERY,
    { query: `created_at:>='${since.toISOString()}'` },
    (data) => data.orders,
    async (nodes) => {
      for (const node of nodes) {
        summary.fetched += 1;
        try {
          const order = fromGraphqlOrder(node, await loadAllLines(client, node));
          const result = await importOrder(ctx, order);
          if (result.status === 'imported') summary.imported += 1;
          if (order.cancelledAt) summary.cancelled += 1;
        } catch (err) {
          if (err.name === 'ShopifyAuthError') throw err;
          summary.errors += 1;
        }
      }
      if (ctx.heartbeat) await ctx.heartbeat();
    }
  );
  return summary;
}

module.exports = { fromWebhookOrder, importOrder, cancelOrder, importRecentOrders };
