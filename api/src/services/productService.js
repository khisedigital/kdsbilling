const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const AppError = require('../utils/AppError');
const { getPagination, paginatedResponse } = require('../utils/pagination');
const { MOVEMENT_TYPES, toDecimal, getOrCreateBalance, applyStockMovement } = require('./stockEngine');
const {
  randomInStoreEan13,
  pickPlainBarcode,
  classifyBarcodeStatus,
  classifyCode,
} = require('./barcodeValidation');

/** Digits only, 4–18 characters. Defined here so a stale barcode module cannot crash the save. */
function isNumericBarcode(value) {
  return /^\d{4,18}$/.test(String(value || '').trim());
}

function isValidBarcodeValue(value) {
  return isNumericBarcode(value);
}

function cleanNameMr(value) {
  const name = String(value || '').trim();
  if (name.length > 200) {
    throw new AppError('Marathi product name is too long', 400, 'VALIDATION_ERROR');
  }
  return name || null;
}

const productIncludes = (db) => [
  { model: db.Category, as: 'category', attributes: ['id', 'name', 'name_mr'] },
  { model: db.Brand, as: 'brand', attributes: ['id', 'name', 'name_mr'] },
  { model: db.UnitOfMeasure, as: 'uom', attributes: ['id', 'code', 'name', 'type'] },
  { model: db.TaxGroup, as: 'taxGroup', attributes: ['id', 'name', 'total_rate'] },
  {
    model: db.ProductVariant,
    as: 'variants',
    where: { deleted_at: null },
    required: false,
    include: [
      { model: db.UnitOfMeasure, as: 'uom', attributes: ['id', 'code', 'name'] },
      { model: db.TaxGroup, as: 'taxGroup', attributes: ['id', 'name', 'total_rate'] },
      { model: db.Barcode, as: 'barcodes' },
    ],
  },
  { model: db.ProductImage, as: 'images', separate: true, order: [['sort_order', 'ASC']] },
];

/** Lighter includes for list views (skip images). */
const productListIncludes = (db) => [
  { model: db.Category, as: 'category', attributes: ['id', 'name', 'name_mr'] },
  { model: db.Brand, as: 'brand', attributes: ['id', 'name', 'name_mr'] },
  { model: db.UnitOfMeasure, as: 'uom', attributes: ['id', 'code', 'name', 'type'] },
  { model: db.TaxGroup, as: 'taxGroup', attributes: ['id', 'name', 'total_rate'] },
  {
    model: db.ProductVariant,
    as: 'variants',
    where: { deleted_at: null },
    required: false,
    include: [
      { model: db.Barcode, as: 'barcodes', attributes: ['id', 'barcode', 'is_primary', 'quantity'] },
    ],
  },
];

/**
 * Billing / POS catalog download — smallest payload that still supports
 * search, barcodes, prices, favorites, and stock on tiles.
 */
const productPosListIncludes = (db) => [
  { model: db.Category, as: 'category', attributes: ['id', 'name', 'name_mr'] },
  { model: db.UnitOfMeasure, as: 'uom', attributes: ['id', 'code', 'name', 'type'] },
  {
    model: db.ProductVariant,
    as: 'variants',
    // separate:true so LIMIT applies to products, not joined variant rows.
    // product_id required so Sequelize can nest variants under products.
    attributes: [
      'id', 'product_id', 'sku', 'size', 'color',
      'cost_price', 'selling_price', 'mrp', 'status',
    ],
    where: { deleted_at: null },
    required: false,
    separate: true,
    include: [
      {
        model: db.Barcode,
        as: 'barcodes',
        attributes: ['id', 'variant_id', 'barcode', 'is_primary', 'quantity'],
      },
    ],
  },
];

const PRODUCT_POS_ATTRIBUTES = [
  'id', 'name', 'name_mr', 'category_id', 'uom_id',
  'is_weight_based', 'allow_decimal_qty', 'is_favorite', 'status',
];

/** Primary first, then plain barcodes, then quantity barcodes. */
function sortBarcodes(barcodes) {
  const rank = (b) => (b.is_primary ? 0 : b.quantity == null ? 1 : 2);
  return [...(barcodes || [])].sort((a, b) => rank(a) - rank(b));
}

function generateSku(prefix = 'SKU') {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function clipSku(value) {
  const sku = String(value || '').trim();
  if (!sku) return generateSku().slice(0, 50);
  return sku.length > 50 ? sku.slice(0, 50) : sku;
}

function skuWithToken(base) {
  const token = Math.random().toString(36).slice(2, 6).toUpperCase();
  const suffix = `-${token}`;
  return `${clipSku(base).slice(0, 50 - suffix.length)}${suffix}`;
}

/** Size + colour identity. Blank options do not match, so a default variant is never reused by accident. */
function variantOptionKey(size, color) {
  const sizeKey = String(size || '').trim().toLowerCase();
  const colorKey = String(color || '').trim().toLowerCase();
  if (!sizeKey && !colorKey) return '';
  return `${sizeKey}|${colorKey}`;
}

/**
 * Pick a catalog-unique SKU. `product_variants.sku` is unique even for soft-deleted
 * rows, and size helpers often reuse the same name/size code.
 */
async function allocateSku(db, requested, { excludeId, transaction, reserved } = {}) {
  const { ProductVariant } = db;
  const base = clipSku(String(requested || '').trim() || generateSku());

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = attempt === 0 ? base : skuWithToken(base);
    const key = candidate.toLowerCase();
    if (reserved?.has(key)) continue;

    const owner = await ProductVariant.findOne({
      where: { sku: candidate },
      attributes: ['id'],
      transaction,
    });
    if (!owner || (excludeId && owner.id === excludeId)) {
      reserved?.add(key);
      return candidate;
    }
  }

  const fallback = skuWithToken(generateSku());
  reserved?.add(fallback.toLowerCase());
  return fallback;
}

/**
 * Same size/colour already on this product (active, or removed) should be updated
 * instead of inserted. Inserting again hits the old row's unique SKU.
 */
function findReusableVariant(rows, incoming, claimedIds) {
  const key = variantOptionKey(incoming?.size, incoming?.color);
  if (!key) return null;

  const matches = (rows || []).filter((row) => variantOptionKey(row.size, row.color) === key);
  const active = matches.find((row) => !row.deleted_at);
  if (active) {
    if (claimedIds?.has(active.id)) return null;
    return active;
  }

  const deleted = matches.filter((row) => row.deleted_at && !claimedIds?.has(row.id));
  deleted.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  return deleted[0] || null;
}

async function setVariantStockQty(db, {
  branchId,
  variantId,
  targetQty,
  userId,
  productId,
  notes,
}, transaction) {
  const target = toDecimal(targetQty) || 0;
  const balance = await getOrCreateBalance(db, branchId, variantId, transaction);
  const current = toDecimal(balance.quantity) || 0;
  const change = toDecimal(target - current);
  if (change === 0) return;

  if (userId) {
    await applyStockMovement(
      db,
      {
        branchId,
        variantId,
        quantityChange: change,
        movementType: MOVEMENT_TYPES.ADJUSTMENT,
        referenceType: 'product_variant_stock',
        referenceId: productId || null,
        notes: notes || 'Variant stock update',
        userId,
        allowNegative: true,
      },
      transaction
    );
  } else {
    await balance.update({ quantity: target }, { transaction });
  }
}

/**
 * Apply per-variant stock when the client sends explicit stockQty values.
 * Never divides product stock across sizes — each variant keeps its own qty.
 * Removed sizes keep their balance on the soft-deleted variant (not redistributed).
 */
async function redistributeVariantStock(db, {
  product,
  keptVariants,
  incomingVariants,
  branchId,
  userId,
}, transaction) {
  if (!keptVariants.length) return;
  if (!branchId) return;

  const hasExplicit =
    incomingVariants.length === keptVariants.length &&
    incomingVariants.every((v) => v.stockQty !== undefined && v.stockQty !== null);

  if (!hasExplicit) return;

  for (let i = 0; i < keptVariants.length; i++) {
    await setVariantStockQty(
      db,
      {
        branchId,
        variantId: keptVariants[i].id,
        targetQty: toDecimal(incomingVariants[i].stockQty) || 0,
        userId,
        productId: product.id,
        notes: 'Per-variant stock update',
      },
      transaction
    );
  }
}

/** Escape % and _ so user input is treated literally in LIKE. */
function escapeLike(value) {
  return String(value || '').replace(/([\\%_])/g, '\\$1');
}

function searchTokens(search) {
  return String(search || '')
    .trim()
    .split(/[\s,;/|_+-]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 1)
    .slice(0, 8);
}

/**
 * Match full phrase OR every word in any order (so "Sugar loose" finds "Sugar (Loose)").
 */
function buildProductTextSearchOr(q) {
  const phrase = escapeLike(q);
  const or = [
    { name: { [Op.like]: `%${phrase}%` } },
    { name_mr: { [Op.like]: `%${phrase}%` } },
    { tax_code: { [Op.like]: `%${phrase}%` } },
  ];
  const tokens = searchTokens(q).map(escapeLike).filter(Boolean);
  if (tokens.length > 1) {
    or.push({
      [Op.and]: tokens.map((token) => ({ name: { [Op.like]: `%${token}%` } })),
    });
    or.push({
      [Op.and]: tokens.map((token) => ({ name_mr: { [Op.like]: `%${token}%` } })),
    });
  }
  return or;
}

async function productIdsMatchingBarcodeOrSku(db, search) {
  const q = String(search || '').trim();
  if (!q) return [];
  const { Barcode, ProductVariant } = db;
  const ids = new Set();

  // Exact barcode first (scanner / full EAN paste).
  const exact = await Barcode.findAll({
    where: { barcode: q },
    attributes: ['variant_id'],
    include: [{
      model: ProductVariant,
      as: 'variant',
      attributes: ['product_id'],
      where: { deleted_at: null },
      required: true,
    }],
    limit: 50,
  });
  for (const row of exact) {
    if (row.variant?.product_id) ids.add(row.variant.product_id);
  }

  // Partial barcode when exact miss (typed fragment).
  if (!ids.size) {
    const partial = await Barcode.findAll({
      where: { barcode: { [Op.like]: `%${escapeLike(q)}%` } },
      attributes: ['variant_id'],
      include: [{
        model: ProductVariant,
        as: 'variant',
        attributes: ['product_id'],
        where: { deleted_at: null },
        required: true,
      }],
      limit: 100,
    });
    for (const row of partial) {
      if (row.variant?.product_id) ids.add(row.variant.product_id);
    }
  }

  const skuHits = await ProductVariant.findAll({
    where: {
      deleted_at: null,
      sku: { [Op.like]: `%${escapeLike(q)}%` },
    },
    attributes: ['product_id'],
    limit: 100,
  });
  for (const row of skuHits) {
    if (row.product_id) ids.add(row.product_id);
  }

  return [...ids];
}

/** Category / brand ids whose English or Marathi name matches the search. */
async function categoryAndBrandIdsMatchingSearch(db, search) {
  const q = String(search || '').trim();
  if (!q) return { categoryIds: [], brandIds: [] };
  const like = `%${escapeLike(q)}%`;

  async function findIds(Model) {
    try {
      const rows = await Model.findAll({
        where: {
          deleted_at: null,
          [Op.or]: [
            { name: { [Op.like]: like } },
            { name_mr: { [Op.like]: like } },
          ],
        },
        attributes: ['id'],
        limit: 100,
      });
      return rows.map((row) => row.id);
    } catch {
      // Older tenant DBs may not have name_mr yet.
      const rows = await Model.findAll({
        where: { deleted_at: null, name: { [Op.like]: like } },
        attributes: ['id'],
        limit: 100,
      });
      return rows.map((row) => row.id);
    }
  }

  const [categoryIds, brandIds] = await Promise.all([
    findIds(db.Category),
    findIds(db.Brand),
  ]);
  return { categoryIds, brandIds };
}

async function listProducts(db, query, branchId = null) {
  const { Product } = db;
  const { page, limit, offset } = getPagination(query);
  const where = { deleted_at: null };
  const leanPos = String(query.view || '').toLowerCase() === 'pos'
    || query.lean === '1'
    || query.lean === 'true';

  if (query.status) where.status = query.status;
  if (query.categoryId) where.category_id = query.categoryId;
  if (query.brandId) where.brand_id = query.brandId;
  if (query.search) {
    const q = String(query.search).trim();
    const or = buildProductTextSearchOr(q);
    const [matchedIds, { categoryIds, brandIds }] = await Promise.all([
      productIdsMatchingBarcodeOrSku(db, q),
      categoryAndBrandIdsMatchingSearch(db, q),
    ]);
    if (matchedIds.length) {
      or.push({ id: { [Op.in]: matchedIds } });
    }
    if (categoryIds.length) {
      or.push({ category_id: { [Op.in]: categoryIds } });
    }
    if (brandIds.length) {
      or.push({ brand_id: { [Op.in]: brandIds } });
    }
    where[Op.or] = or;
  }

  const includes = leanPos ? productPosListIncludes(db) : productListIncludes(db);
  const hasFavorite = await productsHaveFavoriteColumn(Product);
  const order = hasFavorite
    ? [['is_favorite', 'DESC'], ['name', 'ASC'], ['created_at', 'DESC']]
    : [['name', 'ASC'], ['created_at', 'DESC']];
  const leanAttributes = leanPos
    ? PRODUCT_POS_ATTRIBUTES.filter((col) => hasFavorite || col !== 'is_favorite')
    : undefined;

  // Count without nested JOINs — findAndCountAll+distinct was a major list bottleneck.
  let rows;
  try {
    rows = await Product.findAll({
      where,
      attributes: leanAttributes,
      include: includes,
      order,
      limit,
      offset,
    });
  } catch (err) {
    // Older production / lean payload mismatch — retry the standard list shape.
    if (!leanPos) throw err;
    rows = await Product.findAll({
      where,
      include: productListIncludes(db),
      order: [['name', 'ASC'], ['created_at', 'DESC']],
      limit,
      offset,
    });
  }
  const count = await Product.count({ where });
  const items = await attachProductStock(db, rows, branchId);
  return paginatedResponse(items, count, { page, limit });
}

/** Cached per process so listProducts does not describeTable on every request. */
const favoriteColumnCache = new WeakMap();
async function productsHaveFavoriteColumn(Product) {
  if (favoriteColumnCache.has(Product)) return favoriteColumnCache.get(Product);
  try {
    const table = await Product.describe();
    const has = !!table.is_favorite;
    favoriteColumnCache.set(Product, has);
    return has;
  } catch {
    favoriteColumnCache.set(Product, false);
    return false;
  }
}
async function attachProductStock(db, products, branchId) {
  if (!products?.length) return products || [];

  const plain = products.map((p) => (typeof p.toJSON === 'function' ? p.toJSON() : { ...p }));
  let targetBranchId = branchId;
  if (!targetBranchId && db.Branch) {
    try {
      const defaultBranch =
        (await db.Branch.findOne({
          where: { is_default: true, status: 'active' },
          attributes: ['id'],
        })) ||
        (await db.Branch.findOne({
          where: { status: 'active' },
          attributes: ['id'],
        }));
      if (defaultBranch) {
        targetBranchId = defaultBranch.id;
      }
    } catch {
      /* ignore */
    }
  }

  const variantIds = plain.flatMap((p) => (p.variants || []).map((v) => v.id)).filter(Boolean);
  if (!variantIds.length) {
    return plain.map((p) => ({
      ...p,
      stockQty: 0,
      variants: (p.variants || []).map((v) => ({ ...v, stockQty: 0 })),
    }));
  }

  const where = { variant_id: { [Op.in]: variantIds } };
  if (targetBranchId) {
    where.branch_id = targetBranchId;
  }

  const balances = await db.StockBalance.findAll({
    where,
    attributes: ['variant_id', 'quantity'],
  });

  const stockByVariant = new Map();
  for (const b of balances) {
    const prev = stockByVariant.get(b.variant_id) || 0;
    stockByVariant.set(b.variant_id, prev + (parseFloat(b.quantity) || 0));
  }

  return plain.map((product) => {
    const variants = (product.variants || []).map((v) => ({
      ...v,
      stockQty: stockByVariant.get(v.id) ?? 0,
    }));
    const stockQty = variants.reduce((sum, v) => sum + (v.stockQty || 0), 0);
    return { ...product, variants, stockQty };
  });
}

async function getProduct(db, id, branchId = null) {
  const { Product } = db;
  const product = await Product.findOne({
    where: { id, deleted_at: null },
    include: productIncludes(db),
  });
  if (!product) throw new AppError('Product not found', 404, 'NOT_FOUND');
  const [withStock] = await attachProductStock(db, [product], branchId);
  return withStock;
}

async function createVariantRecords(db, product, variants, transaction, reservedSkus) {
  const { ProductVariant, Barcode } = db;
  const reserved = reservedSkus || new Set();
  const created = [];

  for (const v of variants) {
    let variant = null;
    for (let attempt = 0; attempt < 5 && !variant; attempt += 1) {
      const sku = await allocateSku(db, v.sku, { transaction, reserved });
      try {
        variant = await ProductVariant.create(
          {
            product_id: product.id,
            sku,
            size: v.size || null,
            color: v.color || null,
            cost_price: v.costPrice ?? 0,
            selling_price: v.sellingPrice,
            mrp: v.mrp ?? null,
            wholesale_price: v.wholesalePrice ?? null,
            uom_id: v.uomId || product.uom_id,
            tax_group_id: v.taxGroupId || product.tax_group_id,
            reorder_level: v.reorderLevel ?? 0,
            status: v.status || 'active',
          },
          { transaction }
        );
      } catch (err) {
        if (!isSkuUniqueError(err) || attempt === 4) throw err;
      }
    }

    // Every size/variant needs its own primary barcode (auto-generate if blank).
    let barcodes = v.barcodes?.length
      ? v.barcodes.map((b) => String(b).trim()).filter(Boolean)
      : v.barcode
        ? [String(v.barcode).trim()].filter(Boolean)
        : [];
    if (barcodes.some((code) => !isNumericBarcode(code))) {
      throw new AppError('Barcode must be numbers only', 400, 'VALIDATION_ERROR');
    }
    if (!barcodes.length) {
      barcodes = [await uniqueInStoreBarcode(db, transaction)];
    }
    for (let i = 0; i < barcodes.length; i++) {
      await assertBarcodeFree(db, barcodes[i], null, transaction);
      await Barcode.create(
        {
          variant_id: variant.id,
          barcode: barcodes[i],
          is_primary: i === 0,
        },
        { transaction }
      );
    }

    if (Array.isArray(v.quantityBarcodes)) {
      await syncQuantityBarcodes(db, variant.id, v.quantityBarcodes, transaction);
    }

    created.push(variant);
  }

  return created;
}

async function createProduct(db, data, options = {}) {
  const { Product, UnitOfMeasure } = db;

  if (!data.name?.trim()) throw new AppError('Product name is required', 400, 'VALIDATION_ERROR');
  if (!data.uomId) throw new AppError('Unit of measure is required', 400, 'VALIDATION_ERROR');

  const uom = await UnitOfMeasure.findByPk(data.uomId);
  if (!uom) throw new AppError('Invalid unit of measure', 400, 'VALIDATION_ERROR');

  const variants = data.variants?.length ? data.variants : null;
  if (!variants?.length && data.sellingPrice === undefined) {
    throw new AppError('Selling price is required for single-variant product', 400, 'VALIDATION_ERROR');
  }

  const transaction = await db.sequelize.transaction();
  try {
    const product = await Product.create(
      {
        name: data.name.trim(),
        name_mr: cleanNameMr(data.nameMr),
        description: data.description || null,
        category_id: data.categoryId || null,
        brand_id: data.brandId || null,
        uom_id: data.uomId,
        tax_group_id: data.taxGroupId || null,
        tax_code: data.taxCode || null,
        is_weight_based: data.isWeightBased ?? (uom.type === 'weight' || uom.type === 'volume'),
        allow_decimal_qty: data.allowDecimalQty ?? uom.type !== 'count',
        has_variants: Boolean(variants?.length > 1 || (variants?.length === 1 && (variants[0].size || variants[0].color))),
        ...(data.isFavorite !== undefined ? { is_favorite: !!data.isFavorite } : {}),
        status: data.status || 'active',
      },
      { transaction }
    );

    const variantPayload = variants?.length
      ? variants
      : [
          {
            sku: data.sku,
            barcode: data.barcode,
            barcodes: Array.isArray(data.barcodes)
              ? data.barcodes
              : data.barcode
                ? [data.barcode]
                : undefined,
            costPrice: data.costPrice,
            sellingPrice: data.sellingPrice,
            mrp: data.mrp,
            wholesalePrice: data.wholesalePrice,
            reorderLevel: data.reorderLevel,
            stockQty: data.stockQty,
            quantityBarcodes: data.quantityBarcodes,
          },
        ];

    const createdVariants = await createVariantRecords(db, product, variantPayload, transaction);

    const branchId = options.branchId || data.branchId || null;
    const userId = options.userId || data.userId || null;
    if (branchId) {
      for (let i = 0; i < createdVariants.length; i++) {
        const qty = variantPayload[i]?.stockQty;
        if (qty === undefined || qty === null) continue;
        const target = toDecimal(qty) || 0;
        if (target <= 0) continue;
        await setVariantStockQty(
          db,
          {
            branchId,
            variantId: createdVariants[i].id,
            targetQty: target,
            userId,
            productId: product.id,
            notes: 'Opening stock by size',
          },
          transaction
        );
      }
    }

    await transaction.commit();
    // Bulk master import skips the full hydrate query (N extra round-trips).
    if (options.skipHydrate) {
      return { id: product.id, name: product.name };
    }
    const created = await getProduct(db, product.id, branchId);
    // Shop-created products enrich the shared master catalog when missing.
    if (!options.skipMasterSync && options.tenant?.business_type_id) {
      try {
        const catalogMasterService = require('./catalogMasterService');
        await catalogMasterService.ensureTenantProductInMaster(options.tenant, created);
      } catch (err) {
        // Tenant save already succeeded — master mirror must not fail the request.
        console.warn('[catalog] master mirror failed:', err.message || err);
      }
    }
    return created;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function upsertVariantBarcode(db, variantId, barcodeValue, transaction) {
  const { Barcode } = db;
  const primary = await Barcode.findOne({
    where: { variant_id: variantId, is_primary: true },
    transaction,
  });

  if (barcodeValue) {
    const code = String(barcodeValue).trim();
    // Never silently replace with an empty/invalid/taken value.
    await assertBarcodeFree(db, code, primary?.id || null, transaction);
    if (primary) {
      await primary.update({ barcode: code }, { transaction });
    } else {
      await Barcode.create(
        { variant_id: variantId, barcode: code, is_primary: true },
        { transaction }
      );
    }
    return;
  }

  // Blank barcode: keep a number already stored, otherwise create a 13-digit code.
  if (primary && isNumericBarcode(primary.barcode)) return;
  if (primary) {
    await assignFreshBarcode(db, primary, transaction);
    return;
  }
  await createUniquePrimaryBarcode(db, variantId, transaction);
}

async function assertBarcodeFree(db, barcode, ownId, transaction) {
  const code = String(barcode || '').trim();
  if (!code) throw new AppError('Barcode cannot be empty', 400, 'VALIDATION_ERROR');
  if (!isValidBarcodeValue(code)) {
    throw new AppError(`Invalid barcode format: ${code}`, 400, 'VALIDATION_ERROR');
  }
  const taken = await db.Barcode.findOne({ where: { barcode: code }, transaction });
  if (taken && taken.id !== ownId) {
    throw new AppError(`Barcode ${code} is already used by another product`, 409, 'BARCODE_TAKEN');
  }
}

/** Unique in-store EAN-13 (digits only) that scanners can read. */
async function uniqueInStoreBarcode(db, transaction) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidate = randomInStoreEan13();
    const taken = await db.Barcode.findOne({ where: { barcode: candidate }, transaction });
    if (!taken) return candidate;
  }
  throw new AppError('Could not generate a unique barcode, try again', 500, 'BARCODE_GENERATION_FAILED');
}

/** Replace one stored barcode with a fresh number-only EAN-13. */
async function assignFreshBarcode(db, row, transaction) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = await uniqueInStoreBarcode(db, transaction);
    try {
      await row.update({ barcode: code }, { transaction });
      return code;
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
    }
  }
  throw new AppError('Could not generate a unique barcode, try again', 500, 'BARCODE_GENERATION_FAILED');
}

function isUniqueConstraintError(err) {
  return (
    err?.name === 'SequelizeUniqueConstraintError'
    || err?.original?.code === 'ER_DUP_ENTRY'
    || /unique|duplicate/i.test(String(err?.message || ''))
  );
}

function isSkuUniqueError(err) {
  if (!isUniqueConstraintError(err)) return false;
  const paths = [
    ...(err.errors || []).map((item) => item?.path || ''),
    ...Object.keys(err.fields || {}),
  ].join(' ');
  const message = `${paths} ${err?.original?.sqlMessage || ''} ${err?.parent?.sqlMessage || ''}`;
  if (/barcode/i.test(message)) return false;
  return /sku/i.test(message);
}

/** Create primary barcode; retry on rare concurrent unique collisions. */
async function createUniquePrimaryBarcode(db, variantId, transaction) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = await uniqueInStoreBarcode(db, transaction);
    try {
      await db.Barcode.create(
        { variant_id: variantId, barcode: code, is_primary: true, quantity: null },
        { transaction },
      );
      return code;
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
    }
  }
  throw new AppError('Could not generate a unique barcode, try again', 500, 'BARCODE_GENERATION_FAILED');
}

/**
 * Replaces plain (non-quantity) barcodes for a variant.
 * First entry becomes primary; the rest are alternate scan codes for the same SKU.
 * Empty strings get a generated EAN-13. Pack/quantity barcodes are never touched.
 */
async function syncPlainBarcodes(db, variantId, entries, transaction) {
  const { Barcode } = db;
  const Op = db.Sequelize?.Op || require('sequelize').Op;
  const list = Array.isArray(entries) ? entries : [];
  const wanted = [];
  const seenCode = new Set();

  for (const raw of list) {
    const code = String(typeof raw === 'string' ? raw : raw?.barcode || '').trim();
    if (code) {
      if (!isNumericBarcode(code)) {
        throw new AppError('Barcode must be numbers only', 400, 'VALIDATION_ERROR');
      }
      if (seenCode.has(code)) {
        throw new AppError(`Barcode ${code} is listed twice`, 400, 'VALIDATION_ERROR');
      }
      seenCode.add(code);
    }
    wanted.push(code);
  }

  if (!wanted.length) {
    wanted.push('');
  }

  const existing = await Barcode.findAll({
    where: {
      variant_id: variantId,
      [Op.or]: [{ quantity: null }, { quantity: { [Op.is]: null } }],
    },
    transaction,
  });
  // Only plain rows (quantity null). Some dialects store NULL.
  const plain = existing.filter((row) => row.quantity == null);
  const byCode = new Map(plain.map((row) => [row.barcode, row]));
  const keep = new Set();
  const resolved = [];

  for (let i = 0; i < wanted.length; i += 1) {
    let code = wanted[i];
    if (!code) {
      const reusable = plain.find((row) => !keep.has(row.id) && isNumericBarcode(row.barcode));
      if (reusable) {
        keep.add(reusable.id);
        resolved.push(reusable);
        continue;
      }
      code = await uniqueInStoreBarcode(db, transaction);
    }
    const own = byCode.get(code);
    if (own) {
      keep.add(own.id);
      resolved.push(own);
      continue;
    }
    // Same variant may already own this code as a pack/quantity barcode — reclaim as plain.
    const sameVariant = await Barcode.findOne({
      where: { barcode: code, variant_id: variantId },
      transaction,
    });
    if (sameVariant) {
      await sameVariant.update(
        { quantity: null, is_primary: resolved.length === 0 },
        { transaction },
      );
      keep.add(sameVariant.id);
      resolved.push(sameVariant);
      byCode.set(code, sameVariant);
      continue;
    }
    await assertBarcodeFree(db, code, null, transaction);
    const created = await Barcode.create(
      {
        variant_id: variantId,
        barcode: code,
        is_primary: false,
        quantity: null,
      },
      { transaction },
    );
    keep.add(created.id);
    byCode.set(code, created);
    resolved.push(created);
  }

  for (const row of plain) {
    if (!keep.has(row.id)) await row.destroy({ transaction });
  }

  for (let i = 0; i < resolved.length; i += 1) {
    const shouldPrimary = i === 0;
    if (Boolean(resolved[i].is_primary) !== shouldPrimary) {
      await resolved[i].update({ is_primary: shouldPrimary }, { transaction });
    }
  }
}

/**
 * Replaces the variant's quantity barcodes with `entries` ([{ barcode?, quantity }]).
 * An empty barcode gets a new in-store number-only EAN-13. The primary barcode is never touched.
 */
async function syncQuantityBarcodes(db, variantId, entries, transaction) {
  const { Barcode } = db;
  const wanted = [];
  const seenQty = new Set();
  const seenCode = new Set();
  for (const entry of entries) {
    const quantity = toDecimal(entry?.quantity);
    if (!(quantity > 0)) {
      throw new AppError('Each quantity barcode needs a quantity greater than 0', 400, 'VALIDATION_ERROR');
    }
    const key = quantity.toFixed(4);
    if (seenQty.has(key)) {
      throw new AppError(`Quantity ${quantity} is listed twice`, 400, 'VALIDATION_ERROR');
    }
    seenQty.add(key);
    const barcode = String(entry?.barcode || '').trim();
    if (barcode) {
      if (!isNumericBarcode(barcode)) {
        throw new AppError('Barcode must be numbers only', 400, 'VALIDATION_ERROR');
      }
      if (seenCode.has(barcode)) throw new AppError(`Barcode ${barcode} is listed twice`, 400, 'VALIDATION_ERROR');
      seenCode.add(barcode);
    }
    wanted.push({ barcode, quantity });
  }

  const existing = await Barcode.findAll({
    where: { variant_id: variantId, is_primary: false, quantity: { [Op.ne]: null } },
    transaction,
  });
  const byCode = new Map(existing.map((row) => [row.barcode, row]));
  const keep = new Set();

  for (const item of wanted) {
    const own = item.barcode ? byCode.get(item.barcode) : null;
    if (own) {
      keep.add(own.id);
      await own.update({ quantity: item.quantity }, { transaction });
      continue;
    }
    if (!item.barcode) {
      const sameQty = existing.find(
        (row) => !keep.has(row.id) && toDecimal(row.quantity) === item.quantity && !seenCode.has(row.barcode)
      );
      if (sameQty) {
        if (!isNumericBarcode(sameQty.barcode)) {
          await assignFreshBarcode(db, sameQty, transaction);
        }
        keep.add(sameQty.id);
        continue;
      }
    }
    const barcode = item.barcode || (await uniqueInStoreBarcode(db, transaction));
    if (item.barcode) await assertBarcodeFree(db, barcode, null, transaction);
    const created = await Barcode.create(
      { variant_id: variantId, barcode, is_primary: false, quantity: item.quantity },
      { transaction }
    );
    keep.add(created.id);
  }

  for (const row of existing) {
    if (!keep.has(row.id)) await row.destroy({ transaction });
  }
}

async function syncProductVariants(db, product, variants, transaction, options = {}) {
  const { ProductVariant, Barcode } = db;
  if (!variants?.length) {
    throw new AppError('At least one size/variant is required', 400, 'VALIDATION_ERROR');
  }

  for (const v of variants) {
    const price = v.sellingPrice !== undefined ? parseFloat(v.sellingPrice) : null;
    if (price == null || Number.isNaN(price) || price < 0) {
      throw new AppError('Each size needs a valid selling price (0 allowed)', 400, 'VALIDATION_ERROR');
    }
  }

  const catalogVariants = await ProductVariant.findAll({
    where: { product_id: product.id },
    transaction,
  });
  const existing = catalogVariants.filter((row) => !row.deleted_at);
  const existingIds = existing.map((row) => row.id);
  const keptVariants = [];
  const reservedSkus = new Set();
  // Ids already named in this save must not be grabbed by a new size row.
  const claimedIds = new Set(variants.map((row) => row.id).filter(Boolean));

  async function assignVariantBarcode(variant, incoming, { keepExisting = false } = {}) {
    const requested = incoming.barcode !== undefined ? String(incoming.barcode || '').trim() : '';
    if (requested && !isNumericBarcode(requested)) {
      throw new AppError('Barcode must be numbers only', 400, 'VALIDATION_ERROR');
    }
    if (keepExisting) {
      const primary = await Barcode.findOne({
        where: { variant_id: variant.id, is_primary: true },
        transaction,
      });
      if (primary && isNumericBarcode(primary.barcode)) return;
    }
    if (requested) {
      await upsertVariantBarcode(db, variant.id, requested, transaction);
      return;
    }
    // Keep a number barcode. Replace a letter barcode so scanners can read it.
    const primary = await Barcode.findOne({
      where: { variant_id: variant.id, is_primary: true },
      transaction,
    });
    if (primary && !isNumericBarcode(primary.barcode)) {
      await assignFreshBarcode(db, primary, transaction);
    } else if (!primary) {
      await createUniquePrimaryBarcode(db, variant.id, transaction);
    }
  }

  for (const v of variants) {
    let variant = null;
    let restored = false;

    if (v.id) {
      variant = existing.find((row) => row.id === v.id);
      if (!variant) throw new AppError('Variant not found', 404, 'NOT_FOUND');
    } else {
      variant = findReusableVariant(catalogVariants, v, claimedIds);
      restored = Boolean(variant?.deleted_at);
      if (variant) claimedIds.add(variant.id);
    }

    if (variant) {
      const sku = await allocateSku(db, v.sku?.trim() || variant.sku, {
        excludeId: variant.id,
        transaction,
        reserved: reservedSkus,
      });
      await variant.update(
        {
          sku,
          size: v.size !== undefined ? v.size?.trim() || null : variant.size,
          color: v.color !== undefined ? v.color?.trim() || null : variant.color,
          cost_price: v.costPrice !== undefined ? v.costPrice : variant.cost_price,
          selling_price: v.sellingPrice,
          mrp: v.mrp !== undefined ? v.mrp : variant.mrp,
          wholesale_price: v.wholesalePrice !== undefined ? v.wholesalePrice : variant.wholesale_price,
          uom_id: v.uomId || product.uom_id,
          // Only change tax when the payload explicitly sends taxGroupId.
          // Otherwise keep each size's own tax (purchase append must not wipe it).
          tax_group_id:
            v.taxGroupId !== undefined ? v.taxGroupId || null : variant.tax_group_id,
          reorder_level: v.reorderLevel !== undefined ? v.reorderLevel : variant.reorder_level,
          ...(restored ? { deleted_at: null, status: 'active' } : {}),
        },
        { transaction }
      );

      // A new row that matches a size already on this product must not replace
      // that size's barcode with a freshly generated number.
      if (Array.isArray(v.barcodes)) {
        await syncPlainBarcodes(db, variant.id, v.barcodes, transaction);
      } else {
        await assignVariantBarcode(variant, v, { keepExisting: !v.id });
      }
      if (Array.isArray(v.quantityBarcodes)) {
        await syncQuantityBarcodes(db, variant.id, v.quantityBarcodes, transaction);
      }
      keptVariants.push(variant);
    } else {
      const [created] = await createVariantRecords(db, product, [v], transaction, reservedSkus);
      claimedIds.add(created.id);
      catalogVariants.push(created);
      keptVariants.push(created);
    }
  }

  await redistributeVariantStock(
    db,
    {
      product,
      existingVariantIds: existingIds,
      keptVariants,
      incomingVariants: variants,
      branchId: options.branchId || null,
      userId: options.userId || null,
    },
    transaction
  );

  // Default sync replaces the size set. Append mode only creates/updates listed sizes
  // and never soft-deletes others (used when purchase adds a missing size).
  if (options.mode !== 'append') {
    const keepIds = new Set(keptVariants.map((v) => v.id));
    const now = new Date();
    for (const old of existing) {
      if (!keepIds.has(old.id)) {
        await old.update({ deleted_at: now, status: 'inactive' }, { transaction });
      }
    }
  }

  const activeCount =
    options.mode === 'append'
      ? (await ProductVariant.count({
          where: { product_id: product.id, deleted_at: null },
          transaction,
        }))
      : keptVariants.length;

  await product.update(
    {
      has_variants: Boolean(
        activeCount > 1
          || (keptVariants.length === 1 && (keptVariants[0].size || keptVariants[0].color))
          || variants.some((v) => v.size || v.color)
      ),
    },
    { transaction }
  );

  return keptVariants;
}

async function updateProduct(db, id, data, options = {}) {
  const { Product, ProductVariant } = db;
  const product = await Product.findOne({ where: { id, deleted_at: null } });
  if (!product) throw new AppError('Product not found', 404, 'NOT_FOUND');

  const transaction = await db.sequelize.transaction();
  try {
    const nextTaxGroupId = data.taxGroupId !== undefined ? data.taxGroupId || null : product.tax_group_id;

    const nextIsWeightBased = data.isWeightBased ?? product.is_weight_based;
    // Keep decimal flag aligned with weight switch / explicit payload so pcs packs
    // do not keep asking for qty after an earlier weight/gram setup.
    const nextAllowDecimal =
      data.allowDecimalQty !== undefined
        ? !!data.allowDecimalQty
        : data.isWeightBased !== undefined
          ? !!data.isWeightBased
          : product.allow_decimal_qty;

    await product.update({
      name: data.name?.trim() ?? product.name,
      ...(data.nameMr !== undefined ? { name_mr: cleanNameMr(data.nameMr) } : {}),
      description: data.description !== undefined ? data.description : product.description,
      category_id: data.categoryId !== undefined ? data.categoryId || null : product.category_id,
      brand_id: data.brandId !== undefined ? data.brandId || null : product.brand_id,
      uom_id: data.uomId ?? product.uom_id,
      tax_group_id: nextTaxGroupId,
      tax_code: data.taxCode !== undefined ? data.taxCode : product.tax_code,
      is_weight_based: nextIsWeightBased,
      allow_decimal_qty: nextAllowDecimal,
      ...(data.isFavorite !== undefined ? { is_favorite: !!data.isFavorite } : {}),
      status: data.status ?? product.status,
    }, { transaction });

    if (Array.isArray(data.variants)) {
      await syncProductVariants(db, product, data.variants, transaction, {
        branchId: options.branchId || data.branchId || null,
        userId: options.userId || data.userId || null,
        mode: data.variantSyncMode === 'append' ? 'append' : 'replace',
      });
    } else {
      // Keep every variant's tax in sync when the product tax group changes.
      if (data.taxGroupId !== undefined) {
        await ProductVariant.update(
          { tax_group_id: nextTaxGroupId },
          { where: { product_id: id, deleted_at: null }, transaction }
        );
      }

      const variantFields = [
        'variantId', 'sku', 'sellingPrice', 'costPrice', 'mrp', 'wholesalePrice', 'reorderLevel', 'barcode',
        'barcodes', 'quantityBarcodes', 'size', 'color',
      ];
      const hasVariantUpdate = variantFields.some((f) => data[f] !== undefined);

      if (hasVariantUpdate) {
        let variant = null;
        if (data.variantId) {
          variant = await ProductVariant.findOne({
            where: { id: data.variantId, product_id: id, deleted_at: null },
            transaction,
          });
        } else {
          variant = await ProductVariant.findOne({
            where: { product_id: id, deleted_at: null },
            order: [['created_at', 'ASC']],
            transaction,
          });
        }

        if (variant) {
          const variantUpdates = {};
          if (data.sku !== undefined) variantUpdates.sku = data.sku?.trim() || variant.sku;
          if (data.sellingPrice !== undefined) variantUpdates.selling_price = data.sellingPrice;
          if (data.costPrice !== undefined) variantUpdates.cost_price = data.costPrice;
          if (data.mrp !== undefined) variantUpdates.mrp = data.mrp;
          if (data.wholesalePrice !== undefined) variantUpdates.wholesale_price = data.wholesalePrice;
          if (data.reorderLevel !== undefined) variantUpdates.reorder_level = data.reorderLevel;
          if (data.uomId !== undefined) variantUpdates.uom_id = data.uomId;
          if (data.size !== undefined) variantUpdates.size = data.size?.trim() || null;
          if (data.color !== undefined) variantUpdates.color = data.color?.trim() || null;

          if (Object.keys(variantUpdates).length) {
            await variant.update(variantUpdates, { transaction });
          }

          if (Array.isArray(data.barcodes)) {
            await syncPlainBarcodes(db, variant.id, data.barcodes, transaction);
          } else if (data.barcode !== undefined) {
            await upsertVariantBarcode(db, variant.id, data.barcode?.trim() || null, transaction);
          }
          if (Array.isArray(data.quantityBarcodes)) {
            await syncQuantityBarcodes(db, variant.id, data.quantityBarcodes, transaction);
          }
        }
      }
    }

    await transaction.commit();
    return getProduct(db, id, options.branchId || null);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function deleteProduct(db, id) {
  const { Product, ProductVariant } = db;
  const product = await Product.findOne({ where: { id, deleted_at: null } });
  if (!product) throw new AppError('Product not found', 404, 'NOT_FOUND');

  const now = new Date();
  await product.update({ deleted_at: now, status: 'inactive' });
  await ProductVariant.update({ deleted_at: now, status: 'inactive' }, { where: { product_id: id } });
  return { deleted: true };
}

/** Soft-delete every product in this shop and free their barcodes for a fresh import. */
async function deleteAllProducts(db) {
  const total = await db.Product.count({ where: { deleted_at: null } });
  if (!total) return { deleted: 0 };

  const now = new Date();
  const transaction = await db.sequelize.transaction();
  try {
    await db.sequelize.query(
      `DELETE b FROM barcodes b
       INNER JOIN product_variants v ON v.id = b.variant_id
       INNER JOIN products p ON p.id = v.product_id
       WHERE p.deleted_at IS NULL`,
      { transaction },
    );
    await db.sequelize.query(
      `UPDATE product_variants v
       INNER JOIN products p ON p.id = v.product_id
       SET v.deleted_at = :now, v.status = 'inactive', v.updated_at = :now
       WHERE p.deleted_at IS NULL AND v.deleted_at IS NULL`,
      { replacements: { now }, transaction },
    );
    await db.sequelize.query(
      `UPDATE products
       SET deleted_at = :now, status = 'inactive', updated_at = :now
       WHERE deleted_at IS NULL`,
      { replacements: { now }, transaction },
    );
    await transaction.commit();
    return { deleted: total };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function searchProducts(db, query, branchId = null) {
  const { Product, ProductVariant, Barcode } = db;
  const q = query.q?.trim();
  if (!q) throw new AppError('Search query is required', 400, 'VALIDATION_ERROR');

  const limit = parseInt(query.limit, 10) || 20;
  const productWhere = { deleted_at: null, status: 'active' };
  if (query.categoryId) productWhere.category_id = query.categoryId;
  const variantBase = { deleted_at: null, status: 'active' };

  const barcodeExact = await Barcode.findOne({
    where: { barcode: q },
    include: [
      {
        model: ProductVariant,
        as: 'variant',
        where: variantBase,
        include: [
          {
            model: Product,
            as: 'product',
            where: productWhere,
            include: [
              { model: db.UnitOfMeasure, as: 'uom', attributes: ['id', 'code', 'name', 'type'] },
            ],
          },
          { model: Barcode, as: 'barcodes' },
          { model: db.UnitOfMeasure, as: 'uom', attributes: ['id', 'code', 'name', 'type'] },
        ],
      },
    ],
  });

  if (barcodeExact?.variant) {
    const result = await formatSearchResult(db, barcodeExact.variant);
    // Quantity barcodes only — plain pack barcodes must add as 1 (not open How much?).
    if (barcodeExact.quantity != null && toDecimal(barcodeExact.quantity) > 0) {
      result.scannedQuantity = toDecimal(barcodeExact.quantity);
    }
    return attachStockQty(db, [result], branchId);
  }

  const barcodeMatches = await Barcode.findAll({
    where: { barcode: { [Op.like]: `%${q}%` } },
    include: [
      {
        model: ProductVariant,
        as: 'variant',
        where: variantBase,
        include: [
          {
            model: Product,
            as: 'product',
            where: productWhere,
          },
          { model: Barcode, as: 'barcodes' },
          { model: db.TaxGroup, as: 'taxGroup', attributes: ['id', 'name', 'total_rate'] },
          { model: db.UnitOfMeasure, as: 'uom', attributes: ['id', 'code', 'name', 'type'] },
        ],
      },
    ],
    limit,
  });

  if (barcodeMatches.length) {
    const seen = new Set();
    const results = [];
    for (const row of barcodeMatches) {
      if (!row.variant || seen.has(row.variant.id)) continue;
      seen.add(row.variant.id);
      results.push(await formatSearchResult(db, row.variant));
    }
    if (results.length) return attachStockQty(db, results, branchId);
  }

  const phrase = escapeLike(q);
  const tokens = searchTokens(q).map(escapeLike).filter(Boolean);
  const textOr = [
    { sku: { [Op.like]: `%${phrase}%` } },
    { size: { [Op.like]: `%${phrase}%` } },
    { color: { [Op.like]: `%${phrase}%` } },
    { '$product.name$': { [Op.like]: `%${phrase}%` } },
    { '$product.name_mr$': { [Op.like]: `%${phrase}%` } },
  ];
  if (tokens.length > 1) {
    textOr.push({
      [Op.and]: tokens.map((token) => ({ '$product.name$': { [Op.like]: `%${token}%` } })),
    });
    textOr.push({
      [Op.and]: tokens.map((token) => ({ '$product.name_mr$': { [Op.like]: `%${token}%` } })),
    });
  }

  const { categoryIds, brandIds } = await categoryAndBrandIdsMatchingSearch(db, q);
  if (categoryIds.length) {
    textOr.push({ '$product.category_id$': { [Op.in]: categoryIds } });
  }
  if (brandIds.length) {
    textOr.push({ '$product.brand_id$': { [Op.in]: brandIds } });
  }

  const variants = await ProductVariant.findAll({
    where: {
      ...variantBase,
      [Op.or]: textOr,
    },
    include: [
      {
        model: Product,
        as: 'product',
        where: productWhere,
        required: true,
      },
      { model: Barcode, as: 'barcodes' },
      { model: db.TaxGroup, as: 'taxGroup', attributes: ['id', 'name', 'total_rate'] },
      { model: db.UnitOfMeasure, as: 'uom', attributes: ['id', 'code', 'name', 'type'] },
    ],
    limit,
  });

  if (variants.length) {
    const results = await Promise.all(variants.map((v) => formatSearchResult(db, v)));
    return attachStockQty(db, results, branchId);
  }

  return [];
}

async function formatSearchResult(db, variant, productOverride = null) {
  let product = productOverride || variant.product || null;
  if (!product) {
    product = await db.Product.findByPk(variant.product_id, {
      include: [
        { model: db.UnitOfMeasure, as: 'uom', attributes: ['id', 'code', 'name', 'type'] },
        { model: db.Category, as: 'category', attributes: ['id', 'name', 'name_mr'] },
      ],
    });
  } else {
    if (!product.uom && product.uom_id) {
      product.uom = await db.UnitOfMeasure.findByPk(product.uom_id, {
        attributes: ['id', 'code', 'name', 'type'],
      });
    }
    if (!product.category && product.category_id && db.Category) {
      product.category = await db.Category.findByPk(product.category_id, {
        attributes: ['id', 'name', 'name_mr'],
      });
    }
  }

  const uom = variant.uom || product?.uom || null;
  const category = product.category || null;

  return {
    variantId: variant.id,
    productId: product.id,
    productName: product.name,
    productNameMr: product.name_mr || null,
    isFavorite: !!product.is_favorite,
    sku: variant.sku,
    size: variant.size,
    color: variant.color,
    sellingPrice: parseFloat(variant.selling_price),
    costPrice: parseFloat(variant.cost_price),
    mrp: variant.mrp ? parseFloat(variant.mrp) : null,
    barcodes: sortBarcodes(variant.barcodes)
      .filter((b) => b.quantity == null)
      .map((b) => b.barcode),
    quantityBarcodes: (variant.barcodes || [])
      .filter((b) => b.quantity != null)
      .map((b) => ({ barcode: b.barcode, quantity: toDecimal(b.quantity) }))
      .sort((a, b) => a.quantity - b.quantity),
    taxGroup: variant.taxGroup || null,
    uom,
    isWeightBased: product.is_weight_based,
    allowDecimalQty: product.allow_decimal_qty,
    stockQty: 0,
    categoryId: category?.id || product.category_id || null,
    categoryName: category?.name || null,
    categoryNameMr: category?.name_mr || null,
  };
}

async function attachStockQty(db, results, branchId) {
  if (!results.length) return results;
  if (!branchId) return results;

  const balances = await db.StockBalance.findAll({
    where: {
      branch_id: branchId,
      variant_id: { [Op.in]: results.map((r) => r.variantId) },
    },
    attributes: ['variant_id', 'quantity'],
  });
  const byVariant = new Map(
    balances.map((b) => [b.variant_id, parseFloat(b.quantity) || 0])
  );

  return results.map((r) => ({
    ...r,
    stockQty: byVariant.has(r.variantId) ? byVariant.get(r.variantId) : 0,
  }));
}

async function bulkImport(db, rows, options = {}) {
  if (!Array.isArray(rows) || !rows.length) {
    throw new AppError('Import rows array is required', 400, 'VALIDATION_ERROR');
  }

  const results = { success: 0, failed: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const { Category, Brand, UnitOfMeasure } = db;

      let categoryId = null;
      if (row.category) {
        const [cat] = await Category.findOrCreate({
          where: { name: row.category, deleted_at: null },
          defaults: { id: uuidv4(), name: row.category, status: 'active' },
        });
        categoryId = cat.id;
      }

      let brandId = null;
      if (row.brand) {
        const [brand] = await Brand.findOrCreate({
          where: { name: row.brand, deleted_at: null },
          defaults: { id: uuidv4(), name: row.brand, status: 'active' },
        });
        brandId = brand.id;
      }

      const uomCode = row.uom || 'pcs';
      const uom = await UnitOfMeasure.findOne({ where: { code: uomCode } });
      if (!uom) throw new AppError(`Invalid UOM: ${uomCode}`, 400, 'VALIDATION_ERROR');

      await createProduct(db, {
        name: row.name,
        description: row.description,
        categoryId,
        brandId,
        uomId: uom.id,
        taxCode: row.taxCode,
        isWeightBased: row.isWeightBased,
        allowDecimalQty: row.allowDecimalQty,
        sku: row.sku,
        barcode: row.barcode,
        costPrice: row.costPrice,
        sellingPrice: row.sellingPrice,
        mrp: row.mrp,
        variants: row.variants,
      }, {
        tenant: options.tenant || null,
        skipMasterSync: !!options.skipMasterSync,
      });

      results.success += 1;
    } catch (err) {
      results.failed += 1;
      results.errors.push({ row: i + 1, message: err.message });
    }
  }

  return results;
}

async function listTaxGroups(db) {
  const { TaxGroup, TaxGroupComponent, TaxType } = db;
  return TaxGroup.findAll({
    where: { status: 'active' },
    include: [
      {
        model: TaxGroupComponent,
        as: 'components',
        include: [{ model: TaxType, as: 'taxType', attributes: ['id', 'code', 'name'] }],
      },
    ],
    order: [['total_rate', 'ASC'], ['name', 'ASC']],
  });
}

async function listUnits(db) {
  const { UnitOfMeasure } = db;
  return UnitOfMeasure.findAll({ order: [['type', 'ASC'], ['name', 'ASC']] });
}

/**
 * Gives every listed variant that has no plain barcode a unique number-only EAN-13.
 * Letter barcodes (KDSPOZ…) are replaced so scanners can read them.
 * Manufacturer barcodes are never overwritten.
 * Concurrent requests lock variant rows so two generators cannot create two primaries.
 * Returns { variantId, barcode, generated } per variant.
 */
async function generateBarcodes(db, variantIds) {
  const ids = [...new Set((Array.isArray(variantIds) ? variantIds : []).filter((id) => typeof id === 'string'))];
  if (!ids.length) throw new AppError('Select at least one product', 400, 'VALIDATION_ERROR');
  if (ids.length > 500) throw new AppError('Too many products in one request (max 500)', 400, 'VALIDATION_ERROR');

  const { ProductVariant, Barcode } = db;
  const results = [];
  const transaction = await db.sequelize.transaction();
  try {
    // Lock variants so concurrent "Generate Missing" requests serialize.
    const variants = await ProductVariant.findAll({
      where: { id: { [Op.in]: ids }, deleted_at: null },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (variants.length !== ids.length) {
      throw new AppError('Some products were not found', 404, 'NOT_FOUND');
    }

    for (const variant of variants) {
      const rows = await Barcode.findAll({
        where: { variant_id: variant.id },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const existingPrimary = rows.find((b) => b.is_primary);
      const existing = pickPlainBarcode(rows) || (existingPrimary?.barcode ? String(existingPrimary.barcode).trim() : '');
      if (existing && !isNumericBarcode(existing)) {
        const row = rows.find(
          (b) => String(b.barcode || '').trim().toUpperCase() === existing.toUpperCase(),
        );
        const code = row
          ? await assignFreshBarcode(db, row, transaction)
          : await createUniquePrimaryBarcode(db, variant.id, transaction);
        results.push({ variantId: variant.id, barcode: code, generated: true });
        continue;
      }
      if (existing) {
        results.push({ variantId: variant.id, barcode: existing, generated: false });
        continue;
      }
      const code = await createUniquePrimaryBarcode(db, variant.id, transaction);
      results.push({ variantId: variant.id, barcode: code, generated: true });
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
  return results;
}

/**
 * Active variants for a product with barcode status for label printing.
 * status: available | missing | duplicate
 * Does not generate barcodes.
 */
async function getProductBarcodeStatus(db, productId) {
  const { Product, ProductVariant, Barcode } = db;
  if (!productId) throw new AppError('Product id is required', 400, 'VALIDATION_ERROR');

  const product = await Product.findOne({
    where: { id: productId, deleted_at: null },
    attributes: ['id', 'name', 'has_variants'],
    include: [{ model: db.UnitOfMeasure, as: 'uom', attributes: ['code', 'name', 'type'], required: false }],
  });
  if (!product) throw new AppError('Product not found', 404, 'NOT_FOUND');

  const variants = await ProductVariant.findAll({
    where: { product_id: productId, deleted_at: null, status: 'active' },
    include: [{ model: Barcode, as: 'barcodes' }],
    order: [['sku', 'ASC']],
  });

  const plainCodes = [];
  for (const variant of variants) {
    for (const barcode of variant.barcodes || []) {
      const code = String(barcode.barcode || '').trim();
      if (code) plainCodes.push(code);
    }
  }

  const occupancyByCode = {};
  if (plainCodes.length) {
    const rows = await Barcode.findAll({
      where: { barcode: { [Op.in]: [...new Set(plainCodes)] } },
      attributes: ['barcode', 'variant_id'],
    });
    const byCode = new Map();
    for (const row of rows) {
      const code = String(row.barcode).trim();
      if (!byCode.has(code)) byCode.set(code, new Set());
      byCode.get(code).add(row.variant_id);
    }
    for (const [code, set] of byCode.entries()) {
      occupancyByCode[code] = set.size;
    }
  }

  // Also flag same barcode reused across this product's variants (defensive).
  const seenInProduct = new Map();
  for (const v of variants) {
    const code = pickPlainBarcode(v.barcodes);
    if (!code) continue;
    seenInProduct.set(code, (seenInProduct.get(code) || 0) + 1);
  }
  for (const [code, count] of seenInProduct.entries()) {
    if (count > 1) occupancyByCode[code] = Math.max(occupancyByCode[code] || 0, count);
  }

  const hasVariants = Boolean(
    product.has_variants
      || variants.length > 1
      || variants.some((v) => Boolean(v.size || v.color)),
  );

  return {
    productId: product.id,
    productName: product.name,
    hasVariants,
    uom: product.uom
      ? { code: product.uom.code, name: product.uom.name, type: product.uom.type }
      : null,
    variants: variants.map((v) => {
      const classified = classifyBarcodeStatus(v.barcodes, occupancyByCode);
      const primaryCode = classified.barcode || null;
      const plainSorted = sortBarcodes(v.barcodes).filter((barcode) => barcode.quantity == null);
      const alternateBarcodes = plainSorted
        .map((barcode) => classifyCode(barcode.barcode, occupancyByCode))
        .filter((row) => row.barcode && row.barcode !== primaryCode);
      const quantityBarcodes = (v.barcodes || [])
        .filter((barcode) => barcode.quantity != null && Number(barcode.quantity) > 0)
        .map((barcode) => {
          const pack = classifyCode(barcode.barcode, occupancyByCode);
          return {
            quantity: parseFloat(String(barcode.quantity)),
            barcode: pack.barcode || null,
            barcodeType: pack.barcodeType,
            status: pack.status,
          };
        })
        .sort((a, b) => a.quantity - b.quantity);
      return {
        variantId: v.id,
        sku: v.sku,
        size: v.size,
        color: v.color,
        mrp: v.mrp != null ? parseFloat(String(v.mrp)) : null,
        sellingPrice: parseFloat(String(v.selling_price)) || 0,
        costPrice: parseFloat(String(v.cost_price)) || 0,
        barcode: primaryCode,
        barcodeType: classified.barcodeType,
        status: classified.status,
        stockQty: v.stockQty ?? null,
        alternateBarcodes,
        quantityBarcodes,
      };
    }),
  };
}

/**
 * Returns the barcode for each { variantId, quantity }, reusing the variant's quantity barcode for that
 * quantity or creating one. Returns { variantId, quantity, barcode, generated } per item.
 */
async function ensureQuantityBarcodes(db, items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) throw new AppError('Select at least one product', 400, 'VALIDATION_ERROR');
  if (list.length > 500) throw new AppError('Too many labels in one request (max 500)', 400, 'VALIDATION_ERROR');
  const wanted = list.map((item) => ({ variantId: item?.variantId, quantity: toDecimal(item?.quantity) }));
  if (wanted.some((w) => typeof w.variantId !== 'string' || !(w.quantity > 0))) {
    throw new AppError('Each label needs a product and a quantity greater than 0', 400, 'VALIDATION_ERROR');
  }

  const { ProductVariant, Barcode } = db;
  const ids = [...new Set(wanted.map((w) => w.variantId))];
  const results = [];
  const transaction = await db.sequelize.transaction();
  try {
    const variants = await ProductVariant.findAll({
      where: { id: { [Op.in]: ids }, deleted_at: null },
      attributes: ['id'],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (variants.length !== ids.length) throw new AppError('Some products were not found', 404, 'NOT_FOUND');

    for (const w of wanted) {
      const rows = await Barcode.findAll({
        where: { variant_id: w.variantId, quantity: { [Op.ne]: null } },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const existing = rows.find((row) => toDecimal(row.quantity) === w.quantity);
      if (existing && !isNumericBarcode(existing.barcode)) {
        const code = await assignFreshBarcode(db, existing, transaction);
        results.push({ ...w, barcode: code, generated: true });
        continue;
      }
      if (existing) {
        results.push({ ...w, barcode: existing.barcode, generated: false });
        continue;
      }
      let barcode = null;
      for (let attempt = 0; attempt < 8 && !barcode; attempt += 1) {
        const candidate = await uniqueInStoreBarcode(db, transaction);
        try {
          await Barcode.create(
            { variant_id: w.variantId, barcode: candidate, is_primary: false, quantity: w.quantity },
            { transaction }
          );
          barcode = candidate;
        } catch (err) {
          if (!isUniqueConstraintError(err)) throw err;
        }
      }
      if (!barcode) {
        throw new AppError('Could not generate a unique barcode, try again', 500, 'BARCODE_GENERATION_FAILED');
      }
      results.push({ ...w, barcode, generated: true });
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
  return results;
}

/**
 * Bulk edit from Price Management: update name / prices / barcode / absolute stock.
 * `items`: [{ productId?, variantId, name?, nameMr?, sellingPrice?, costPrice?, mrp?, barcode?, stockQty? }]
 */
async function bulkUpdateVariantPricing(db, branchId, userId, items) {
  if (!Array.isArray(items) || !items.length) {
    throw new AppError('No price rows to update', 400, 'VALIDATION_ERROR');
  }
  if (items.length > 500) {
    throw new AppError('Update at most 500 rows at a time', 400, 'VALIDATION_ERROR');
  }
  if (!branchId) throw new AppError('Branch required', 400, 'VALIDATION_ERROR');

  const { Product, ProductVariant, UnitOfMeasure } = db;
  const { applyStockMovement, MOVEMENT_TYPES } = require('./stockEngine');
  const results = [];

  for (const raw of items) {
    const variantId = raw.variantId || raw.variant_id;
    if (!variantId) {
      results.push({ variantId: null, ok: false, error: 'variantId required' });
      continue;
    }

    const applyRow = async (includeBarcodes) => {
      const transaction = await db.sequelize.transaction();
      try {
        const variant = await ProductVariant.findOne({
          where: { id: variantId, deleted_at: null },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!variant) {
          await transaction.rollback();
          return { variantId, ok: false, error: 'not_found' };
        }

        const product = await Product.findOne({
          where: { id: variant.product_id, deleted_at: null },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!product) {
          await transaction.rollback();
          return { variantId, ok: false, error: 'product_not_found' };
        }

        if (raw.name !== undefined) {
          const nextName = String(raw.name || '').trim();
          if (!nextName) throw new AppError('Product name cannot be empty', 400, 'VALIDATION_ERROR');
          if (nextName !== product.name) {
            await product.update({ name: nextName }, { transaction });
          }
        }

        if (raw.nameMr !== undefined) {
          const nextMr = cleanNameMr(raw.nameMr);
          if ((nextMr || null) !== (product.name_mr || null)) {
            await product.update({ name_mr: nextMr }, { transaction });
          }
        }

        const nextUomId = raw.uomId || raw.uom_id;
        if (nextUomId) {
          const uom = await UnitOfMeasure.findByPk(nextUomId, { transaction });
          if (!uom) throw new AppError('Invalid unit of measure', 400, 'VALIDATION_ERROR');
          if (uom.id !== product.uom_id) {
            const isMeasure = uom.type === 'weight' || uom.type === 'volume';
            await product.update({
              uom_id: uom.id,
              is_weight_based: isMeasure,
              allow_decimal_qty: isMeasure || uom.type === 'length',
            }, { transaction });
            await ProductVariant.update(
              { uom_id: uom.id },
              { where: { product_id: product.id, deleted_at: null }, transaction },
            );
          }
        }

        const variantUpdates = {};
        if (raw.sellingPrice !== undefined && raw.sellingPrice !== null && raw.sellingPrice !== '') {
          const price = parseFloat(raw.sellingPrice);
          if (!(price > 0)) throw new AppError(`Invalid selling price for ${product.name}`, 400, 'VALIDATION_ERROR');
          variantUpdates.selling_price = price;
        }
        if (raw.costPrice !== undefined && raw.costPrice !== null && raw.costPrice !== '') {
          variantUpdates.cost_price = parseFloat(raw.costPrice) || 0;
        }
        if (raw.mrp !== undefined) {
          if (raw.mrp === null || raw.mrp === '') variantUpdates.mrp = null;
          else variantUpdates.mrp = parseFloat(raw.mrp) || 0;
        }
        if (Object.keys(variantUpdates).length) {
          await variant.update(variantUpdates, { transaction });
        }

        if (includeBarcodes) {
          if (Array.isArray(raw.barcodes)) {
            await syncPlainBarcodes(db, variant.id, raw.barcodes, transaction);
          } else if (raw.barcode !== undefined) {
            const code = String(raw.barcode || '').trim();
            if (code) await upsertVariantBarcode(db, variant.id, code, transaction);
          }
        }

        if (raw.stockQty !== undefined && raw.stockQty !== null && raw.stockQty !== '') {
          const target = parseFloat(raw.stockQty);
          if (Number.isNaN(target) || target < 0) {
            throw new AppError(`Invalid stock for ${product.name}`, 400, 'VALIDATION_ERROR');
          }
          const balance = await db.StockBalance.findOne({
            where: { branch_id: branchId, variant_id: variant.id },
            transaction,
            lock: transaction.LOCK.UPDATE,
          });
          const current = parseFloat(balance?.quantity) || 0;
          const delta = Math.round((target - current) * 1000) / 1000;
          if (delta !== 0) {
            await applyStockMovement(db, {
              branchId,
              variantId: variant.id,
              quantityChange: delta,
              movementType: MOVEMENT_TYPES.ADJUSTMENT,
              referenceType: 'price_management',
              referenceId: product.id,
              notes: 'Price management stock edit',
              userId,
              allowNegative: true,
            }, transaction);
          }
        }

        await transaction.commit();
        return { variantId: variant.id, productId: product.id, ok: true };
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    };

    try {
      results.push(await applyRow(true));
    } catch (err) {
      const code = err?.code || err?.error?.code || '';
      const message = String(err?.message || '');
      const barcodeConflict =
        code === 'BARCODE_TAKEN'
        || /barcode .* already used/i.test(message)
        || /listed twice/i.test(message)
        || /duplicate/i.test(message);
      if (barcodeConflict) {
        // Save prices/stock even when a barcode conflicts with another product/pack.
        try {
          results.push({ ...(await applyRow(false)), barcodeSkipped: true });
          continue;
        } catch (err2) {
          results.push({
            variantId,
            ok: false,
            error: err2?.message || message || 'update_failed',
          });
          continue;
        }
      }
      results.push({
        variantId,
        ok: false,
        error: message || 'update_failed',
      });
    }
  }

  const updated = results.filter((r) => r.ok).length;
  if (!updated && results.length) {
    const first = results.find((r) => r.error && r.error !== 'not_found');
    if (first?.error && first.error !== 'not_found' && first.error !== 'product_not_found') {
      throw new AppError(first.error, 400, 'VALIDATION_ERROR');
    }
  }
  return { updated, items: results };
}

async function setProductFavorite(db, id, isFavorite) {
  const { Product } = db;
  const product = await Product.findOne({ where: { id, deleted_at: null } });
  if (!product) throw new AppError('Product not found', 404, 'NOT_FOUND');
  await product.update({ is_favorite: !!isFavorite });
  return {
    id: product.id,
    is_favorite: !!product.is_favorite,
    isFavorite: !!product.is_favorite,
  };
}

/**
 * Mark every matching product as favorite (or not). Requires a category filter
 * so shops cannot accidentally star the whole catalog.
 */
async function setProductsFavoriteBulk(db, { categoryId, brandId, isFavorite } = {}) {
  if (!categoryId) {
    throw new AppError('Category is required to favorite products in bulk', 400, 'VALIDATION_ERROR');
  }
  const { Product } = db;
  const where = {
    deleted_at: null,
    category_id: categoryId,
  };
  if (brandId) where.brand_id = brandId;

  const [updated] = await Product.update(
    { is_favorite: !!isFavorite },
    { where },
  );

  return {
    updated: updated || 0,
    categoryId,
    brandId: brandId || null,
    isFavorite: !!isFavorite,
  };
}

module.exports = {
  generateBarcodes,
  ensureQuantityBarcodes,
  getProductBarcodeStatus,
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  setProductFavorite,
  setProductsFavoriteBulk,
  deleteProduct,
  deleteAllProducts,
  searchProducts,
  bulkImport,
  bulkUpdateVariantPricing,
  listTaxGroups,
  listUnits,
  generateSku,
};
