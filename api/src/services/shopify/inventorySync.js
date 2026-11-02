const crypto = require('crypto');
const { Op } = require('sequelize');
const { ShopifyApiError } = require('./shopifyClient');
const { errorMessage } = require('./shopifyUtils');

const BATCH_SIZE = 100;

// API 2026-04+: @idempotent is mandatory and changeFromQuantity must be sent (null = no compare-and-set).
const SET_QUANTITIES = `
  mutation SetQuantities($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
      inventoryAdjustmentGroup { id }
      userErrors { field message code }
    }
  }
`;

const ACTIVATE = `
  mutation Activate($inventoryItemId: ID!, $locationId: ID!) {
    inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) {
      inventoryLevel { id }
      userErrors { field message }
    }
  }
`;

/** Shopify stores whole units; POS may hold decimals (weight items) or negatives. */
function toShopifyQty(posQty) {
  const n = Math.floor(parseFloat(posQty) || 0);
  return n < 0 ? 0 : n;
}

async function posQuantities(db, branchId, variantIds) {
  const rows = await db.StockBalance.findAll({
    where: { branch_id: branchId, variant_id: { [Op.in]: variantIds } },
    attributes: ['variant_id', 'quantity'],
    raw: true,
  });
  const map = new Map();
  for (const row of rows) map.set(row.variant_id, row.quantity);
  return map;
}

async function runSet(client, locationId, items, idempotencyKey) {
  const data = await client.query(SET_QUANTITIES, {
    idempotencyKey,
    input: {
      name: 'available',
      reason: 'correction',
      referenceDocumentUri: 'kdspoz://pos/stock',
      quantities: items.map((i) => ({
        inventoryItemId: i.mapping.shopify_inventory_item_id,
        locationId,
        quantity: i.quantity,
        changeFromQuantity: null,
      })),
    },
  });
  return data.inventorySetQuantities?.userErrors || [];
}

async function activateAndSet(client, locationId, item, idempotencyKey) {
  await client.query(ACTIVATE, {
    inventoryItemId: item.mapping.shopify_inventory_item_id,
    locationId,
  });
  return runSet(client, locationId, [item], idempotencyKey);
}

/**
 * Sets absolute Shopify "available" quantities. A failing batch falls back to per-item
 * requests (activating the item at the location when it is not stocked there yet).
 */
async function setQuantities(ctx, items, keyBase) {
  const { client, connection } = ctx;
  const locationId = connection.shopify_location_id;
  if (!locationId) throw new ShopifyApiError('No Shopify location selected for inventory sync');
  const result = { pushed: 0, errors: 0, lastErrors: [] };

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const errors = await runSet(client, locationId, batch, `${keyBase}:b${i}`);
    if (!errors.length) {
      result.pushed += batch.length;
      await markPushed(batch);
      continue;
    }
    for (const [index, item] of batch.entries()) {
      const key = `${keyBase}:i${i + index}`;
      try {
        let itemErrors = await runSet(client, locationId, [item], key);
        if (itemErrors.length && itemErrors.some((e) => /stock|location|activ/i.test(e.message || ''))) {
          itemErrors = await activateAndSet(client, locationId, item, `${key}:a`);
        }
        if (itemErrors.length) throw new ShopifyApiError(itemErrors.map((e) => e.message).join('; '));
        result.pushed += 1;
        await markPushed([item]);
      } catch (err) {
        if (err.name === 'ShopifyAuthError') throw err;
        result.errors += 1;
        result.lastErrors.push(`${item.mapping.sku || item.mapping.shopify_variant_id}: ${errorMessage(err)}`);
        await item.mapping.update({ last_error: errorMessage(err) });
      }
    }
  }
  return result;
}

async function markPushed(items) {
  for (const item of items) {
    await item.mapping.update({ last_shopify_qty: item.quantity, last_synced_at: new Date(), last_error: null });
  }
}

/** Single-variant push after a POS stock movement; reads the current balance at run time. */
async function pushVariant(ctx, { variantId, branchId }, jobId) {
  const { db, connection } = ctx;
  if (!connection.branch_id || branchId !== connection.branch_id) return { skipped: 'other_branch' };
  const mapping = await db.ShopifyProductMapping.findOne({
    where: { connection_id: connection.id, variant_id: variantId },
  });
  if (!mapping || !mapping.inventory_tracked || !mapping.shopify_inventory_item_id) {
    return { skipped: 'not_mapped' };
  }
  const qtyMap = await posQuantities(db, connection.branch_id, [variantId]);
  const quantity = toShopifyQty(qtyMap.get(variantId));
  if (mapping.last_shopify_qty === quantity && mapping.last_synced_at && !mapping.last_error) {
    return { skipped: 'unchanged' };
  }
  const result = await setQuantities(ctx, [{ mapping, quantity }], `push:${jobId}`);
  if (result.errors) throw new ShopifyApiError(result.lastErrors.join('; '), { retryable: true });
  return result;
}

/** Full inventory sync: POS is the stock source of truth for mapped variants. */
async function pushAllInventory(ctx, jobId) {
  const { db, connection } = ctx;
  if (!connection.branch_id) throw new ShopifyApiError('No POS branch linked to Shopify');
  const mappings = await db.ShopifyProductMapping.findAll({
    where: {
      connection_id: connection.id,
      inventory_tracked: true,
      shopify_inventory_item_id: { [Op.ne]: null },
    },
  });
  if (!mappings.length) return { pushed: 0, errors: 0, lastErrors: [] };
  const qtyMap = await posQuantities(db, connection.branch_id, mappings.map((m) => m.variant_id));
  const items = mappings.map((mapping) => ({ mapping, quantity: toShopifyQty(qtyMap.get(mapping.variant_id)) }));
  const keyBase = `full:${jobId || crypto.randomUUID()}`;
  const result = await setQuantities(ctx, items, keyBase);
  return { ...result, lastErrors: result.lastErrors.slice(-10) };
}

module.exports = { pushVariant, pushAllInventory, toShopifyQty };
