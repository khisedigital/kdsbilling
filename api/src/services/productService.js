const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const AppError = require('../utils/AppError');
const { getPagination, paginatedResponse } = require('../utils/pagination');
const { MOVEMENT_TYPES, toDecimal, getOrCreateBalance, applyStockMovement } = require('./stockEngine');
const {
  isValidBarcodeValue,
  randomInternalCode128,
  pickPlainBarcode,
  classifyBarcodeStatus,
} = require('./barcodeValidation');

const productIncludes = (db) => [
  { model: db.Category, as: 'category', attributes: ['id', 'name'] },
  { model: db.Brand, as: 'brand', attributes: ['id', 'name'] },
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
  { model: db.Category, as: 'category', attributes: ['id', 'name'] },
  { model: db.Brand, as: 'brand', attributes: ['id', 'name'] },
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

/** Primary first, then plain barcodes, then quantity barcodes. */
function sortBarcodes(barcodes) {
  const rank = (b) => (b.is_primary ? 0 : b.quantity == null ? 1 : 2);
  return [...(barcodes || [])].sort((a, b) => rank(a) - rank(b));
}

function generateSku(prefix = 'SKU') {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

/** Split total qty across N sizes. Remainder goes to the first sizes (pcs-friendly). */
function splitStockQuantity(total, count, allowDecimal = false) {
  const n = Math.max(0, count);
  if (n === 0) return [];
  const qty = toDecimal(total) || 0;
  if (qty <= 0) return Array.from({ length: n }, () => 0);

  if (!allowDecimal) {
    const whole = Math.round(qty);
    const base = Math.floor(whole / n);
    let rem = whole - base * n;
    return Array.from({ length: n }, () => {
      const share = base + (rem > 0 ? 1 : 0);
      if (rem > 0) rem -= 1;
      return share;
    });
  }

  const base = Math.floor((qty / n) * 1000) / 1000;
  const shares = Array.from({ length: n }, () => base);
  shares[0] = toDecimal(qty - base * (n - 1));
  return shares;
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
        referenceType: 'product_size_split',
        referenceId: productId || null,
        notes: notes || 'Stock split across sizes',
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
 * After size variants change, divide each branch's existing product stock
 * evenly across the kept sizes (or apply explicit stockQty for one branch).
 */
async function redistributeVariantStock(db, {
  product,
  existingVariantIds,
  keptVariants,
  incomingVariants,
  branchId,
  userId,
}, transaction) {
  const { StockBalance } = db;
  if (!keptVariants.length) return;

  const allowDecimal = !!(product.allow_decimal_qty || product.is_weight_based);
  const oldIds = existingVariantIds.filter(Boolean);
  if (!oldIds.length && !incomingVariants.some((v) => v.stockQty !== undefined)) return;

  const balances = oldIds.length
    ? await StockBalance.findAll({
        where: { variant_id: { [Op.in]: oldIds } },
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
    : [];

  const branchTotals = new Map();
  for (const row of balances) {
    const qty = toDecimal(row.quantity) || 0;
    if (!qty) continue;
    branchTotals.set(row.branch_id, toDecimal((branchTotals.get(row.branch_id) || 0) + qty));
  }

  const hasExplicit =
    !!branchId &&
    incomingVariants.length === keptVariants.length &&
    incomingVariants.every((v) => v.stockQty !== undefined && v.stockQty !== null);

  const sizeSetChanged =
    oldIds.length !== keptVariants.length ||
    keptVariants.some((v) => !oldIds.includes(v.id)) ||
    oldIds.some((id) => !keptVariants.some((v) => v.id === id));

  // Nothing to do if sizes unchanged and no explicit stock payload
  if (!sizeSetChanged && !hasExplicit) return;

  // Ensure every branch that had stock (or the current branch for explicit qty) is covered
  if (hasExplicit && !branchTotals.has(branchId)) {
    branchTotals.set(branchId, 0);
  }

  if (!branchTotals.size && !hasExplicit) return;

  const branchIds = new Set([...branchTotals.keys()]);
  if (hasExplicit) branchIds.add(branchId);

  for (const bId of branchIds) {
    let targets;
    if (hasExplicit && bId === branchId) {
      targets = incomingVariants.map((v) => toDecimal(v.stockQty) || 0);
    } else {
      const total = branchTotals.get(bId) || 0;
      if (!sizeSetChanged || total <= 0) continue;
      targets = splitStockQuantity(total, keptVariants.length, allowDecimal);
    }

    // Zero stock on variants that will be removed (still active until soft-delete)
    for (const oldId of oldIds) {
      if (keptVariants.some((v) => v.id === oldId)) continue;
      await setVariantStockQty(
        db,
        {
          branchId: bId,
          variantId: oldId,
          targetQty: 0,
          userId,
          productId: product.id,
          notes: 'Stock moved while splitting sizes',
        },
        transaction
      );
    }

    for (let i = 0; i < keptVariants.length; i++) {
      await setVariantStockQty(
        db,
        {
          branchId: bId,
          variantId: keptVariants[i].id,
          targetQty: targets[i] ?? 0,
          userId,
          productId: product.id,
          notes: 'Stock split across sizes',
        },
        transaction
      );
    }
  }
}

async function listProducts(db, query, branchId = null) {
  const { Product } = db;
  const { page, limit, offset } = getPagination(query);
  const where = { deleted_at: null };

  if (query.status) where.status = query.status;
  if (query.categoryId) where.category_id = query.categoryId;
  if (query.brandId) where.brand_id = query.brandId;
  if (query.search) {
    where[Op.or] = [
      { name: { [Op.like]: `%${query.search}%` } },
      { tax_code: { [Op.like]: `%${query.search}%` } },
    ];
  }

  const { rows, count } = await Product.findAndCountAll({
    where,
    include: productListIncludes(db),
    order: [['created_at', 'DESC']],
    limit,
    offset,
    distinct: true,
  });

  const items = await attachProductStock(db, rows, branchId);
  return paginatedResponse(items, count, { page, limit });
}

async function attachProductStock(db, products, branchId) {
  if (!products?.length) return products || [];

  const plain = products.map((p) => (typeof p.toJSON === 'function' ? p.toJSON() : { ...p }));
  if (!branchId) {
    return plain.map((p) => ({
      ...p,
      stockQty: 0,
      variants: (p.variants || []).map((v) => ({ ...v, stockQty: 0 })),
    }));
  }

  const variantIds = plain.flatMap((p) => (p.variants || []).map((v) => v.id)).filter(Boolean);
  const balances = variantIds.length
    ? await db.StockBalance.findAll({
        where: {
          branch_id: branchId,
          variant_id: { [Op.in]: variantIds },
        },
        attributes: ['variant_id', 'quantity'],
      })
    : [];

  const stockByVariant = new Map(
    balances.map((b) => [b.variant_id, parseFloat(b.quantity) || 0])
  );

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

async function createVariantRecords(db, product, variants, transaction) {
  const { ProductVariant, Barcode } = db;
  const created = [];

  for (const v of variants) {
    const sku = v.sku?.trim() || generateSku();
    const variant = await ProductVariant.create(
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

    // Every size/variant needs its own primary barcode (auto-generate if blank).
    let barcodes = v.barcodes?.length
      ? v.barcodes.map((b) => String(b).trim()).filter(Boolean)
      : v.barcode
        ? [String(v.barcode).trim()].filter(Boolean)
        : [];
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
        description: data.description || null,
        category_id: data.categoryId || null,
        brand_id: data.brandId || null,
        uom_id: data.uomId,
        tax_group_id: data.taxGroupId || null,
        tax_code: data.taxCode || null,
        is_weight_based: data.isWeightBased ?? (uom.type === 'weight' || uom.type === 'volume'),
        allow_decimal_qty: data.allowDecimalQty ?? uom.type !== 'count',
        has_variants: Boolean(variants?.length > 1 || (variants?.length === 1 && (variants[0].size || variants[0].color))),
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
    return getProduct(db, product.id, branchId);
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
      // Keep manufacturer barcodes unless the caller explicitly supplies a new value.
      await primary.update({ barcode: code }, { transaction });
    } else {
      await Barcode.create(
        { variant_id: variantId, barcode: code, is_primary: true },
        { transaction }
      );
    }
  } else if (primary) {
    await primary.destroy({ transaction });
  }
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

/** Unique internal Code 128 value in the reserved KDSPOZ namespace. */
async function uniqueInStoreBarcode(db, transaction) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidate = randomInternalCode128();
    const taken = await db.Barcode.findOne({ where: { barcode: candidate }, transaction });
    if (!taken) return candidate;
  }
  throw new AppError('Could not generate a unique barcode, try again', 500, 'BARCODE_GENERATION_FAILED');
}

/**
 * Replaces the variant's quantity barcodes with `entries` ([{ barcode?, quantity }]).
 * An empty barcode gets a new in-store EAN-13. The primary barcode is never touched.
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
      if (barcode.length > 50) throw new AppError('Barcode is too long (max 50 characters)', 400, 'VALIDATION_ERROR');
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

  const existing = await ProductVariant.findAll({
    where: { product_id: product.id, deleted_at: null },
    transaction,
  });
  const existingIds = existing.map((row) => row.id);
  const keptVariants = [];

  for (const v of variants) {
    if (v.id) {
      const variant = existing.find((row) => row.id === v.id);
      if (!variant) throw new AppError('Variant not found', 404, 'NOT_FOUND');

      await variant.update(
        {
          sku: v.sku?.trim() || variant.sku,
          size: v.size !== undefined ? v.size?.trim() || null : variant.size,
          color: v.color !== undefined ? v.color?.trim() || null : variant.color,
          cost_price: v.costPrice !== undefined ? v.costPrice : variant.cost_price,
          selling_price: v.sellingPrice,
          mrp: v.mrp !== undefined ? v.mrp : variant.mrp,
          wholesale_price: v.wholesalePrice !== undefined ? v.wholesalePrice : variant.wholesale_price,
          uom_id: v.uomId || product.uom_id,
          // Follow product tax when the payload does not override per variant,
          // so a new product tax rate applies on the next bill.
          tax_group_id:
            v.taxGroupId !== undefined ? v.taxGroupId || null : product.tax_group_id,
          reorder_level: v.reorderLevel !== undefined ? v.reorderLevel : variant.reorder_level,
        },
        { transaction }
      );

      if (v.barcode !== undefined && String(v.barcode || '').trim()) {
        await upsertVariantBarcode(db, variant.id, String(v.barcode).trim(), transaction);
      } else {
        // Keep existing barcode, or assign one so every size is scannable.
        const primary = await Barcode.findOne({
          where: { variant_id: variant.id, is_primary: true },
          transaction,
        });
        if (!primary) {
          const code = await uniqueInStoreBarcode(db, transaction);
          await Barcode.create(
            { variant_id: variant.id, barcode: code, is_primary: true },
            { transaction },
          );
        }
      }
      if (Array.isArray(v.quantityBarcodes)) {
        await syncQuantityBarcodes(db, variant.id, v.quantityBarcodes, transaction);
      }
      keptVariants.push(variant);
    } else {
      const [created] = await createVariantRecords(db, product, [v], transaction);
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

  const keepIds = new Set(keptVariants.map((v) => v.id));
  const now = new Date();
  for (const old of existing) {
    if (!keepIds.has(old.id)) {
      await old.update({ deleted_at: now, status: 'inactive' }, { transaction });
    }
  }

  await product.update(
    {
      has_variants: Boolean(
        variants.length > 1 || (variants.length === 1 && (variants[0].size || variants[0].color))
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
      description: data.description !== undefined ? data.description : product.description,
      category_id: data.categoryId !== undefined ? data.categoryId || null : product.category_id,
      brand_id: data.brandId !== undefined ? data.brandId || null : product.brand_id,
      uom_id: data.uomId ?? product.uom_id,
      tax_group_id: nextTaxGroupId,
      tax_code: data.taxCode !== undefined ? data.taxCode : product.tax_code,
      is_weight_based: nextIsWeightBased,
      allow_decimal_qty: nextAllowDecimal,
      status: data.status ?? product.status,
    }, { transaction });

    if (Array.isArray(data.variants)) {
      await syncProductVariants(db, product, data.variants, transaction, {
        branchId: options.branchId || data.branchId || null,
        userId: options.userId || data.userId || null,
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
        'size', 'color',
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

          if (data.barcode !== undefined) {
            await upsertVariantBarcode(db, variant.id, data.barcode?.trim() || null, transaction);
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

async function searchProducts(db, query, branchId = null) {
  const { Product, ProductVariant, Barcode } = db;
  const q = query.q?.trim();
  if (!q) throw new AppError('Search query is required', 400, 'VALIDATION_ERROR');

  const limit = parseInt(query.limit, 10) || 20;
  const productWhere = { deleted_at: null, status: 'active' };
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

  const variants = await ProductVariant.findAll({
    where: {
      ...variantBase,
      [Op.or]: [
        { sku: { [Op.like]: `%${q}%` } },
        { size: { [Op.like]: `%${q}%` } },
        { color: { [Op.like]: `%${q}%` } },
        { '$product.name$': { [Op.like]: `%${q}%` } },
      ],
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
      include: [{ model: db.UnitOfMeasure, as: 'uom', attributes: ['id', 'code', 'name', 'type'] }],
    });
  } else if (!product.uom && product.uom_id) {
    product.uom = await db.UnitOfMeasure.findByPk(product.uom_id, {
      attributes: ['id', 'code', 'name', 'type'],
    });
  }

  const uom = variant.uom || product?.uom || null;

  return {
    variantId: variant.id,
    productId: product.id,
    productName: product.name,
    sku: variant.sku,
    size: variant.size,
    color: variant.color,
    sellingPrice: parseFloat(variant.selling_price),
    costPrice: parseFloat(variant.cost_price),
    mrp: variant.mrp ? parseFloat(variant.mrp) : null,
    barcodes: sortBarcodes(variant.barcodes).map((b) => b.barcode),
    quantityBarcodes: (variant.barcodes || [])
      .filter((b) => b.quantity != null)
      .map((b) => ({ barcode: b.barcode, quantity: toDecimal(b.quantity) }))
      .sort((a, b) => a.quantity - b.quantity),
    taxGroup: variant.taxGroup || null,
    uom,
    isWeightBased: product.is_weight_based,
    allowDecimalQty: product.allow_decimal_qty,
    stockQty: 0,
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

async function bulkImport(db, rows) {
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
 * Gives every listed variant that has no plain barcode a unique internal Code 128 (KDSPOZ…).
 * Existing manufacturer / primary barcodes are never overwritten.
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
      const existing = pickPlainBarcode(rows);
      if (existing) {
        results.push({ variantId: variant.id, barcode: existing, generated: false });
        continue;
      }
      const code = await uniqueInStoreBarcode(db, transaction);
      await Barcode.create(
        { variant_id: variant.id, barcode: code, is_primary: true, quantity: null },
        { transaction }
      );
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
  });
  if (!product) throw new AppError('Product not found', 404, 'NOT_FOUND');

  const variants = await ProductVariant.findAll({
    where: { product_id: productId, deleted_at: null, status: 'active' },
    include: [{ model: Barcode, as: 'barcodes' }],
    order: [['sku', 'ASC']],
  });

  const plainCodes = variants
    .map((v) => pickPlainBarcode(v.barcodes))
    .filter(Boolean);

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
    variants: variants.map((v) => {
      const classified = classifyBarcodeStatus(v.barcodes, occupancyByCode);
      return {
        variantId: v.id,
        sku: v.sku,
        size: v.size,
        color: v.color,
        mrp: v.mrp != null ? parseFloat(String(v.mrp)) : null,
        sellingPrice: parseFloat(String(v.selling_price)) || 0,
        costPrice: parseFloat(String(v.cost_price)) || 0,
        barcode: classified.barcode || null,
        barcodeType: classified.barcodeType,
        status: classified.status,
        stockQty: v.stockQty ?? null,
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
  const variants = await ProductVariant.findAll({ where: { id: { [Op.in]: ids }, deleted_at: null }, attributes: ['id'] });
  if (variants.length !== ids.length) throw new AppError('Some products were not found', 404, 'NOT_FOUND');

  const results = [];
  const transaction = await db.sequelize.transaction();
  try {
    for (const w of wanted) {
      const rows = await Barcode.findAll({
        where: { variant_id: w.variantId, quantity: { [Op.ne]: null } },
        transaction,
      });
      const existing = rows.find((row) => toDecimal(row.quantity) === w.quantity);
      if (existing) {
        results.push({ ...w, barcode: existing.barcode, generated: false });
        continue;
      }
      const barcode = await uniqueInStoreBarcode(db, transaction);
      await Barcode.create(
        { variant_id: w.variantId, barcode, is_primary: false, quantity: w.quantity },
        { transaction }
      );
      results.push({ ...w, barcode, generated: true });
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
  return results;
}

module.exports = {
  generateBarcodes,
  ensureQuantityBarcodes,
  getProductBarcodeStatus,
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  searchProducts,
  bulkImport,
  listTaxGroups,
  listUnits,
  generateSku,
};
