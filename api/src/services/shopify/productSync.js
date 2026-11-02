const productService = require('../productService');
const { applyStockMovement, MOVEMENT_TYPES, toDecimal } = require('../stockEngine');
const { paginate } = require('./shopifyClient');
const { truncate, errorMessage } = require('./shopifyUtils');

const VARIANT_FIELDS = `
  id title sku barcode price compareAtPrice
  selectedOptions { name value }
  inventoryItem { id tracked }
`;

// Page sizes keep each query well under Shopify's 1,000-point single-query cost limit.
const PRODUCTS_QUERY = `
  query Products($cursor: String) {
    products(first: 10, after: $cursor, sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title status
        variants(first: 30) {
          pageInfo { hasNextPage endCursor }
          nodes { ${VARIANT_FIELDS} }
        }
      }
    }
  }
`;

const PRODUCT_QUERY = `
  query Product($id: ID!) {
    product(id: $id) {
      id title status
      variants(first: 30) {
        pageInfo { hasNextPage endCursor }
        nodes { ${VARIANT_FIELDS} }
      }
    }
  }
`;

const PRODUCT_VARIANTS_QUERY = `
  query ProductVariants($id: ID!, $cursor: String) {
    product(id: $id) {
      variants(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { ${VARIANT_FIELDS} }
      }
    }
  }
`;

const ITEM_LEVELS_QUERY = `
  query ItemLevels($ids: [ID!]!, $locationId: ID!) {
    nodes(ids: $ids) {
      ... on InventoryItem {
        id
        inventoryLevel(locationId: $locationId) {
          quantities(names: ["available"]) { name quantity }
        }
      }
    }
  }
`;

async function loadAllVariants(client, product) {
  const variants = [...(product.variants?.nodes || [])];
  if (!product.variants?.pageInfo?.hasNextPage) return variants;
  let cursor = product.variants.pageInfo.endCursor;
  while (cursor) {
    const data = await client.query(PRODUCT_VARIANTS_QUERY, { id: product.id, cursor });
    const conn = data.product?.variants;
    variants.push(...(conn?.nodes || []));
    cursor = conn?.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
  }
  return variants;
}

async function fetchAvailable(client, locationId, inventoryItemIds) {
  const result = new Map();
  if (!locationId) return result;
  const ids = inventoryItemIds.filter(Boolean);
  for (let i = 0; i < ids.length; i += 50) {
    const data = await client.query(ITEM_LEVELS_QUERY, { ids: ids.slice(i, i + 50), locationId });
    for (const node of data.nodes || []) {
      if (!node?.id) continue;
      const qty = node.inventoryLevel?.quantities?.find((q) => q.name === 'available')?.quantity;
      result.set(node.id, typeof qty === 'number' ? qty : 0);
    }
  }
  return result;
}

function optionsFor(variant) {
  let size = null;
  let color = null;
  for (const opt of variant.selectedOptions || []) {
    if (/size/i.test(opt.name) && !size) size = opt.value;
    else if (/colou?r/i.test(opt.name) && !color) color = opt.value;
  }
  if (!size && !color && variant.title && variant.title !== 'Default Title') size = variant.title;
  return { size: truncate(size, 30), color: truncate(color, 50) };
}

function toPrice(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function mrpFor(variant) {
  const price = toPrice(variant.price);
  const compare = toPrice(variant.compareAtPrice);
  return compare > price ? compare : null;
}

async function getSystemUserId(db, connection) {
  if (connection.connected_by) {
    const user = await db.User.findByPk(connection.connected_by, { attributes: ['id'] });
    if (user) return user.id;
  }
  const fallback = await db.User.findOne({ where: { status: 'active' }, order: [['created_at', 'ASC']], attributes: ['id'] });
  return fallback?.id || null;
}

async function findPosVariantBySku(db, sku) {
  if (!sku) return null;
  return db.ProductVariant.findOne({ where: { sku, deleted_at: null } });
}

async function findPosVariantByBarcode(db, barcode) {
  if (!barcode) return null;
  const row = await db.Barcode.findOne({ where: { barcode } });
  if (!row) return null;
  return db.ProductVariant.findOne({ where: { id: row.variant_id, deleted_at: null } });
}

async function isVariantMapped(db, connectionId, variantId) {
  return Boolean(
    await db.ShopifyProductMapping.findOne({ where: { connection_id: connectionId, variant_id: variantId }, attributes: ['id'] })
  );
}

/** Applies Shopify price/compare-at to the POS variant; adds the Shopify barcode only if the POS variant has none. */
async function applyShopifyFieldsToVariant(db, posVariant, variant) {
  const updates = {};
  const price = toPrice(variant.price);
  if (price > 0 && Math.abs(toPrice(posVariant.selling_price) - price) > 0.0001) updates.selling_price = price;
  const mrp = mrpFor(variant);
  if (mrp && Math.abs(toPrice(posVariant.mrp) - mrp) > 0.0001) updates.mrp = mrp;
  if (Object.keys(updates).length) await posVariant.update(updates);

  const barcode = variant.barcode?.trim();
  if (barcode && barcode.length <= 50) {
    const hasAny = await db.Barcode.findOne({ where: { variant_id: posVariant.id }, attributes: ['id'] });
    const taken = await db.Barcode.findOne({ where: { barcode }, attributes: ['id'] });
    if (!hasAny && !taken) {
      await db.Barcode.create({ variant_id: posVariant.id, barcode, is_primary: true });
    }
  }
}

function mappingFields(product, variant) {
  return {
    shopify_product_id: product.id,
    shopify_inventory_item_id: variant.inventoryItem?.id || null,
    inventory_tracked: variant.inventoryItem?.tracked !== false,
    sku: truncate(variant.sku, 100),
    barcode: truncate(variant.barcode, 100),
    last_error: null,
  };
}

async function uniqueSku(db, variant, used) {
  const raw = variant.sku?.trim();
  if (raw && raw.length <= 50 && !used.has(raw.toLowerCase()) && !(await findPosVariantBySku(db, raw))) {
    return raw;
  }
  const tail = String(variant.id).split('/').pop();
  let candidate = `SHP-${tail}`.slice(0, 50);
  while (used.has(candidate.toLowerCase()) || (await db.ProductVariant.findOne({ where: { sku: candidate }, attributes: ['id'] }))) {
    candidate = `SHP-${tail}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`.slice(0, 50);
  }
  return candidate;
}

async function uniqueBarcode(db, variant, used) {
  const raw = variant.barcode?.trim();
  if (!raw || raw.length > 50 || used.has(raw)) return null;
  const taken = await db.Barcode.findOne({ where: { barcode: raw }, attributes: ['id'] });
  return taken ? null : raw;
}

async function getDefaultUomId(db) {
  const uom =
    (await db.UnitOfMeasure.findOne({ where: { code: 'pcs' } })) ||
    (await db.UnitOfMeasure.findOne({ where: { type: 'count' }, order: [['created_at', 'ASC']] })) ||
    (await db.UnitOfMeasure.findOne({ order: [['created_at', 'ASC']] }));
  return uom?.id || null;
}

async function createPosProduct(ctx, product, variants, summary) {
  const { db, connection, client } = ctx;
  const uomId = ctx.defaultUomId || (ctx.defaultUomId = await getDefaultUomId(db));
  if (!uomId) throw new Error('No unit of measure configured in POS');

  const usedSkus = new Set();
  const usedBarcodes = new Set();
  const payload = [];
  for (const v of variants) {
    const sku = await uniqueSku(db, v, usedSkus);
    usedSkus.add(sku.toLowerCase());
    const barcode = await uniqueBarcode(db, v, usedBarcodes);
    if (barcode) usedBarcodes.add(barcode);
    payload.push({
      shopify: v,
      data: {
        sku,
        barcode: barcode || undefined,
        sellingPrice: toPrice(v.price),
        mrp: mrpFor(v),
        costPrice: 0,
        ...optionsFor(v),
      },
    });
  }

  // No branch/stock here: opening stock is applied below with a shopify_* reference so it is not echoed back.
  const created = await productService.createProduct(db, {
    name: truncate(product.title || 'Shopify product', 200),
    uomId,
    variants: payload.map((p) => p.data),
  });

  const available = await fetchAvailable(
    client,
    connection.shopify_location_id,
    variants.filter((v) => v.inventoryItem?.tracked !== false).map((v) => v.inventoryItem?.id)
  );
  const userId = await getSystemUserId(db, connection);

  for (const entry of payload) {
    const posVariant = await db.ProductVariant.findOne({ where: { sku: entry.data.sku, product_id: created.id } });
    if (!posVariant) continue;
    const mapping = await db.ShopifyProductMapping.create({
      connection_id: connection.id,
      ...mappingFields(product, entry.shopify),
      product_id: created.id,
      variant_id: posVariant.id,
      shopify_variant_id: entry.shopify.id,
      match_type: 'created',
      last_synced_at: new Date(),
    });
    const qty = available.get(entry.shopify.inventoryItem?.id);
    if (qty && qty > 0 && connection.branch_id && userId) {
      await db.sequelize.transaction(async (transaction) => {
        await applyStockMovement(
          db,
          {
            branchId: connection.branch_id,
            variantId: posVariant.id,
            quantityChange: toDecimal(qty),
            movementType: MOVEMENT_TYPES.OPENING,
            referenceType: 'shopify_import',
            referenceId: mapping.id,
            notes: 'Opening stock imported from Shopify',
            userId,
            allowNegative: true,
          },
          transaction
        );
      });
      await mapping.update({ last_shopify_qty: qty });
    }
    summary.created += 1;
  }
}

/** Maps/updates/creates POS products for one Shopify product. Per-variant errors are collected, not thrown. */
async function syncShopifyProduct(ctx, product, summary) {
  const { db, client, connection } = ctx;
  const { ShopifyProductMapping } = db;
  const variants = await loadAllVariants(client, product);
  const unmatched = [];

  for (const variant of variants) {
    try {
      const existing = await ShopifyProductMapping.findOne({
        where: { connection_id: connection.id, shopify_variant_id: variant.id },
      });
      if (existing) {
        const posVariant = await db.ProductVariant.findOne({ where: { id: existing.variant_id, deleted_at: null } });
        if (!posVariant) {
          await existing.destroy();
        } else {
          await applyShopifyFieldsToVariant(db, posVariant, variant);
          await existing.update({ ...mappingFields(product, variant), last_synced_at: new Date() });
          summary.updated += 1;
          continue;
        }
      }

      const sku = variant.sku?.trim() || null;
      const barcode = variant.barcode?.trim() || null;
      let posVariant = await findPosVariantBySku(db, sku);
      let matchType = 'sku';
      if (!posVariant || (await isVariantMapped(db, connection.id, posVariant.id))) {
        posVariant = await findPosVariantByBarcode(db, barcode);
        matchType = 'barcode';
      }
      if (posVariant && !(await isVariantMapped(db, connection.id, posVariant.id))) {
        await applyShopifyFieldsToVariant(db, posVariant, variant);
        await ShopifyProductMapping.create({
          connection_id: connection.id,
          ...mappingFields(product, variant),
          product_id: posVariant.product_id,
          variant_id: posVariant.id,
          shopify_variant_id: variant.id,
          match_type: matchType,
          last_synced_at: new Date(),
        });
        summary.matched += 1;
        continue;
      }
      unmatched.push(variant);
    } catch (err) {
      summary.errors += 1;
      summary.lastErrors.push(`${product.title} / ${variant.sku || variant.title}: ${errorMessage(err)}`);
    }
  }

  if (!unmatched.length) return;
  if (product.status === 'ARCHIVED') {
    summary.skipped += unmatched.length;
    return;
  }
  try {
    await createPosProduct(ctx, product, unmatched, summary);
  } catch (err) {
    summary.errors += unmatched.length;
    summary.lastErrors.push(`${product.title}: ${errorMessage(err)}`);
  }
}

function newSummary() {
  return { total: 0, matched: 0, created: 0, updated: 0, skipped: 0, errors: 0, lastErrors: [] };
}

function finalizeSummary(summary) {
  return { ...summary, lastErrors: summary.lastErrors.slice(-10), finishedAt: new Date().toISOString() };
}

async function syncAllProducts(ctx) {
  const summary = newSummary();
  await paginate(ctx.client, PRODUCTS_QUERY, {}, (data) => data.products, async (nodes) => {
    for (const product of nodes) {
      summary.total += 1;
      await syncShopifyProduct(ctx, product, summary);
    }
    if (ctx.heartbeat) await ctx.heartbeat();
  });
  return finalizeSummary(summary);
}

async function syncProductById(ctx, productGid) {
  const data = await ctx.client.query(PRODUCT_QUERY, { id: productGid });
  if (!data.product) return null;
  const summary = newSummary();
  summary.total = 1;
  await syncShopifyProduct(ctx, data.product, summary);
  return finalizeSummary(summary);
}

/** Shopify product deleted: drop mappings only; the POS product and its sales history stay. */
async function removeProductMappings(ctx, productGid) {
  return ctx.db.ShopifyProductMapping.destroy({
    where: { connection_id: ctx.connection.id, shopify_product_id: productGid },
  });
}

module.exports = {
  syncAllProducts,
  syncProductById,
  removeProductMappings,
  getSystemUserId,
};
