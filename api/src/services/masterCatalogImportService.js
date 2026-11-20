const { Op } = require('sequelize');
const AppError = require('../utils/AppError');
const { getMasterModels } = require('../models/master');
const productService = require('./productService');

function serializeMasterForImport(row) {
  const r = row.toJSON ? row.toJSON() : row;
  const variants = (r.variants || []).map((variant) => ({
    size: variant.size || null,
    barcodes: (variant.barcodes || []).map((barcode) => barcode.barcode).filter(Boolean),
    sellingPrice: Number(variant.selling_price) || 0,
    mrp: variant.mrp != null ? Number(variant.mrp) : null,
  }));
  return {
    id: r.id,
    name: r.name,
    nameMr: r.name_mr || null,
    categoryId: r.category_id,
    categoryName: r.category?.name || null,
    categoryNameMr: r.category?.name_mr || null,
    brandName: r.brand?.name || null,
    brandNameMr: r.brand?.name_mr || null,
    businessTypeId: r.business_type_id,
    businessTypeName: r.businessType?.name || null,
    businessTypeCode: r.businessType?.code || null,
    sellingPrice: variants[0]?.sellingPrice ?? (Number(r.selling_price) || 0),
    mrp: variants[0]?.mrp ?? (r.mrp != null ? Number(r.mrp) : null),
    variants,
  };
}

function resolveTenantBusinessTypeId(tenant, queryBusinessTypeId) {
  const tenantTypeId = tenant?.business_type_id || null;
  // Import catalog is locked to the business type chosen at account creation.
  if (tenantTypeId) return tenantTypeId;
  return queryBusinessTypeId || null;
}

/**
 * Browse admin master products available for client import.
 * Locked to the tenant's business type when set on the account.
 */
async function listMasterCatalogForTenant(tenant, query = {}) {
  const { MasterProduct, MasterCategory, MasterBrand, BusinessType, MasterProductVariant, MasterVariantBarcode } = getMasterModels();
  const where = { status: 'active' };

  const businessTypeId = resolveTenantBusinessTypeId(tenant, query.businessTypeId);
  if (!businessTypeId) {
    return [];
  }
  where.business_type_id = businessTypeId;
  if (query.categoryId) where.category_id = query.categoryId;
  if (query.search) {
    where.name = { [Op.like]: `%${String(query.search).trim()}%` };
  }

  // Browse list stays light (no per-product variant queries). Import reloads full rows by id.
  const pageSize = Math.min(Math.max(Number(query.limit) || 2000, 1), 25000);
  const offset = Math.max(Number(query.offset) || 0, 0);

  const rows = await MasterProduct.findAll({
    where,
    attributes: [
      'id', 'name', 'name_mr', 'category_id', 'brand_id', 'business_type_id',
      'selling_price', 'mrp', 'sort_order',
    ],
    include: [
      { model: MasterCategory, as: 'category', attributes: ['id', 'name', 'name_mr'] },
      { model: MasterBrand, as: 'brand', attributes: ['id', 'name', 'name_mr'] },
      { model: BusinessType, as: 'businessType', attributes: ['id', 'name', 'code'] },
    ],
    order: [['sort_order', 'ASC'], ['name', 'ASC']],
    limit: pageSize,
    offset,
  });

  return rows.map(serializeMasterForImport);
}

async function listMasterCategoriesForTenant(tenant, query = {}) {
  const { MasterCategory, BusinessType } = getMasterModels();
  const where = { status: 'active' };
  const businessTypeId = resolveTenantBusinessTypeId(tenant, query.businessTypeId);
  if (!businessTypeId) {
    return [];
  }
  where.business_type_id = businessTypeId;

  const rows = await MasterCategory.findAll({
    where,
    include: [{ model: BusinessType, as: 'businessType', attributes: ['id', 'name', 'code'] }],
    order: [['sort_order', 'ASC'], ['name', 'ASC']],
  });

  return rows.map((row) => {
    const r = row.toJSON ? row.toJSON() : row;
    return {
      id: r.id,
      name: r.name,
      nameMr: r.name_mr || null,
      businessTypeId: r.business_type_id,
      businessTypeName: r.businessType?.name || null,
    };
  });
}

async function listImportableBusinessTypes(tenant) {
  const { BusinessType, MasterProduct } = getMasterModels();
  const tenantTypeId = tenant?.business_type_id || null;
  if (!tenantTypeId) return [];

  const type = await BusinessType.findOne({
    where: { id: tenantTypeId, status: 'active' },
  });
  if (!type) return [];

  const productCount = await MasterProduct.count({
    where: { business_type_id: type.id, status: 'active' },
  });

  return [
    {
      id: type.id,
      code: type.code,
      name: type.name,
      productCount,
      isTenantDefault: true,
    },
  ];
}

async function ensureTenantNamed(Model, name, nameMr = null, cache = null) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const cacheKey = trimmed.toLowerCase();
  if (cache?.has(cacheKey)) return cache.get(cacheKey);

  const cleanedMr = nameMr ? String(nameMr).trim() || null : null;
  const existing = await Model.findOne({
    where: { deleted_at: null, name: { [Op.like]: trimmed } },
  });
  if (existing && String(existing.name).trim().toLowerCase() === trimmed.toLowerCase()) {
    if (cleanedMr && existing.name_mr !== cleanedMr) {
      try {
        await existing.update({ name_mr: cleanedMr });
      } catch {
        // Older tenant DBs may not have name_mr yet.
      }
    }
    cache?.set(cacheKey, existing.id);
    return existing.id;
  }
  try {
    const payload = { name: trimmed, status: 'active' };
    if (cleanedMr) payload.name_mr = cleanedMr;
    const created = await Model.create(payload);
    cache?.set(cacheKey, created.id);
    return created.id;
  } catch (err) {
    if (err.name !== 'SequelizeUniqueConstraintError') throw err;
    const held = await Model.findOne({ where: { name: { [Op.like]: trimmed } } });
    if (!held) throw err;
    const revive = { deleted_at: null, status: 'active' };
    if (cleanedMr) revive.name_mr = cleanedMr;
    if (held.deleted_at || held.status !== 'active' || (cleanedMr && held.name_mr !== cleanedMr)) {
      try {
        await held.update(revive);
      } catch {
        if (held.deleted_at || held.status !== 'active') {
          await held.update({ deleted_at: null, status: 'active' });
        }
      }
    }
    cache?.set(cacheKey, held.id);
    return held.id;
  }
}

async function findTenantProductByBarcode(db, barcodes) {
  const codes = [...new Set((barcodes || []).map((b) => String(b || '').trim()).filter(Boolean))];
  if (!codes.length || !db.Barcode) return null;
  const hit = await db.Barcode.findOne({
    where: { barcode: { [Op.in]: codes } },
    include: [{
      model: db.ProductVariant,
      as: 'variant',
      required: true,
      include: [{
        model: db.Product,
        as: 'product',
        required: true,
        where: { deleted_at: null },
      }],
    }],
  });
  return hit?.variant?.product || null;
}

function cleanMr(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function sameText(a, b) {
  return String(a || '').trim() === String(b || '').trim();
}

/**
 * Refresh shop product fields from master. Returns true when anything changed.
 * Uses Model.update so name / name_mr always persist even if the instance was loaded lean.
 */
async function syncExistingProductFromMaster(db, existing, row, categoryCache, brandCache) {
  const categoryId = await ensureTenantNamed(
    db.Category, row.category?.name, row.category?.name_mr, categoryCache,
  );
  const brandId = await ensureTenantNamed(
    db.Brand, row.brand?.name, row.brand?.name_mr, brandCache,
  );

  const masterName = String(row.name || '').trim();
  const masterNameMr = cleanMr(row.name_mr);
  const patch = {};

  if (masterName && !sameText(existing.name, masterName)) {
    patch.name = masterName;
  }
  if (!sameText(existing.name_mr, masterNameMr)) {
    patch.name_mr = masterNameMr;
  }
  if (row.is_favorite && !existing.is_favorite) {
    patch.is_favorite = true;
  }
  if (categoryId && existing.category_id !== categoryId) {
    patch.category_id = categoryId;
  }
  if (brandId && existing.brand_id !== brandId) {
    patch.brand_id = brandId;
  }

  if (!Object.keys(patch).length) return false;

  try {
    await db.Product.update(patch, { where: { id: existing.id } });
    if (patch.name != null) existing.name = patch.name;
    if (Object.prototype.hasOwnProperty.call(patch, 'name_mr')) existing.name_mr = patch.name_mr;
    if (patch.is_favorite != null) existing.is_favorite = patch.is_favorite;
    if (patch.category_id != null) existing.category_id = patch.category_id;
    if (patch.brand_id != null) existing.brand_id = patch.brand_id;
    return true;
  } catch (err) {
    // Name unique clash — still apply Marathi / other safe fields.
    const { name: _ignored, ...withoutName } = patch;
    if (!Object.keys(withoutName).length) throw err;
    try {
      await db.Product.update(withoutName, { where: { id: existing.id } });
      if (Object.prototype.hasOwnProperty.call(withoutName, 'name_mr')) {
        existing.name_mr = withoutName.name_mr;
      }
      return true;
    } catch {
      // Older tenant DBs may lack name_mr / is_favorite — try names alone via raw SQL.
      if (!masterName && masterNameMr == null) return false;
      try {
        await db.sequelize.query(
          'UPDATE products SET name = COALESCE(?, name), name_mr = ? WHERE id = ? AND deleted_at IS NULL',
          { replacements: [masterName || null, masterNameMr, existing.id] },
        );
        if (masterName) existing.name = masterName;
        existing.name_mr = masterNameMr;
        return true;
      } catch {
        return false;
      }
    }
  }
}

async function preloadProductsByBarcode(db, codes) {
  const unique = [...new Set((codes || []).map((c) => String(c || '').trim()).filter(Boolean))];
  const byBarcode = new Map();
  if (!unique.length || !db.Barcode) return byBarcode;

  const hits = await db.Barcode.findAll({
    where: { barcode: { [Op.in]: unique } },
    attributes: ['barcode'],
    include: [{
      model: db.ProductVariant,
      as: 'variant',
      required: true,
      attributes: ['id', 'product_id'],
      include: [{
        model: db.Product,
        as: 'product',
        required: true,
        where: { deleted_at: null },
        attributes: ['id', 'name', 'name_mr', 'is_favorite', 'category_id', 'brand_id'],
      }],
    }],
  });

  for (const hit of hits) {
    const code = String(hit.barcode || '').trim();
    const product = hit.variant?.product;
    if (code && product && !byBarcode.has(code)) byBarcode.set(code, product);
  }
  return byBarcode;
}

function stripTakenBarcodes(variants, takenCodes) {
  const taken = new Set((takenCodes || []).map((c) => String(c).trim()).filter(Boolean));
  return (variants || []).map((variant) => ({
    ...variant,
    barcodes: (variant.barcodes || []).filter((code) => !taken.has(String(code).trim())),
  }));
}

async function resolvePcsUom(db) {
  const { UnitOfMeasure } = db;
  const uom =
    (await UnitOfMeasure.findOne({ where: { code: 'pcs' } })) ||
    (await UnitOfMeasure.findOne({ where: { code: 'pc' } })) ||
    (await UnitOfMeasure.findOne({ where: { code: 'nos' } }));
  if (!uom) {
    throw new AppError('Unit of measure "pcs" is missing in this shop', 400, 'VALIDATION_ERROR');
  }
  return uom;
}

function shopVariantsFromMaster(row) {
  const fromRows = (row.variants || [])
    .map((variant) => ({
      size: variant.size || undefined,
      barcodes: (variant.barcodes || []).map((barcode) => barcode.barcode || barcode).filter(Boolean),
      sellingPrice: Number(variant.selling_price) || 0,
      mrp: variant.mrp != null ? Number(variant.mrp) : null,
    }))
    .filter((variant) => variant.barcodes.length);
  if (fromRows.length) return fromRows;
  if (row.barcode) {
    return [{
      barcodes: [row.barcode],
      sellingPrice: Number(row.selling_price) || 0,
      mrp: row.mrp != null ? Number(row.mrp) : null,
    }];
  }
  return [];
}

/**
 * Copy selected master products into the client catalog, including pack sizes and barcodes.
 * Master catalog is never modified.
 */
async function importMasterProductsToTenant(db, tenant, { masterProductIds, branchId } = {}, options = {}) {
  if (!Array.isArray(masterProductIds) || !masterProductIds.length) {
    throw new AppError('Select at least one master product to import', 400, 'VALIDATION_ERROR');
  }

  const { MasterProduct, MasterCategory, MasterBrand, MasterProductVariant, MasterVariantBarcode } = getMasterModels();
  const masterWhere = {
    id: { [Op.in]: masterProductIds },
    status: 'active',
  };
  if (tenant?.business_type_id) {
    masterWhere.business_type_id = tenant.business_type_id;
  }

  const masters = await MasterProduct.findAll({
    where: masterWhere,
    include: [
      { model: MasterCategory, as: 'category', attributes: ['id', 'name', 'name_mr'] },
      { model: MasterBrand, as: 'brand', attributes: ['id', 'name', 'name_mr'] },
      {
        model: MasterProductVariant,
        as: 'variants',
        separate: true,
        include: [{ model: MasterVariantBarcode, as: 'barcodes' }],
      },
    ],
  });

  if (!masters.length) {
    throw new AppError('No matching master products found for your business type', 404, 'NOT_FOUND');
  }

  const uom = await resolvePcsUom(db);
  const categoryCache = new Map();
  const brandCache = new Map();

  const masterRows = masters.map((master) => {
    const row = master.toJSON ? master.toJSON() : master;
    return {
      row,
      variants: shopVariantsFromMaster(row),
    };
  });

  // Prefetch shop matches by barcode first (allows English name updates), then by name.
  const batchBarcodes = masterRows.flatMap(({ variants }) => (
    variants.flatMap((variant) => variant.barcodes || [])
  ));
  const existingByBarcode = await preloadProductsByBarcode(db, batchBarcodes);

  const batchNames = [...new Set(
    masterRows.map(({ row }) => String(row.name || '').trim()).filter(Boolean),
  )];
  const existingByName = new Map();
  if (batchNames.length) {
    const existingRows = await db.Product.findAll({
      where: { deleted_at: null, name: { [Op.in]: batchNames } },
      attributes: ['id', 'name', 'name_mr', 'is_favorite', 'category_id', 'brand_id'],
    });
    for (const product of existingRows) {
      const key = String(product.name || '').trim().toLowerCase();
      if (key && !existingByName.has(key)) existingByName.set(key, product);
    }
  }

  const results = {
    imported: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    products: [],
  };

  for (const { row, variants } of masterRows) {
    try {
      const allBarcodes = variants.flatMap((v) => v.barcodes || []);
      const nameKey = String(row.name || '').trim().toLowerCase();

      let existing = null;
      for (const code of allBarcodes) {
        const hit = existingByBarcode.get(String(code).trim());
        if (hit) {
          existing = hit;
          break;
        }
      }
      if (!existing && nameKey) {
        existing = existingByName.get(nameKey) || null;
      }
      if (!existing && allBarcodes.length) {
        // Fallback for barcodes added mid-batch / missed by prefetch.
        existing = await findTenantProductByBarcode(db, allBarcodes);
      }

      if (existing) {
        const oldNameKey = String(existing.name || '').trim().toLowerCase();
        const changed = await syncExistingProductFromMaster(
          db, existing, row, categoryCache, brandCache,
        );
        if (changed) {
          results.updated += 1;
          const newKey = String(existing.name || '').trim().toLowerCase();
          if (oldNameKey && oldNameKey !== newKey && existingByName.get(oldNameKey) === existing) {
            existingByName.delete(oldNameKey);
          }
          if (newKey) existingByName.set(newKey, existing);
        } else {
          results.skipped += 1;
        }
        continue;
      }

      const categoryId = await ensureTenantNamed(
        db.Category, row.category?.name, row.category?.name_mr, categoryCache,
      );
      const brandId = await ensureTenantNamed(
        db.Brand, row.brand?.name, row.brand?.name_mr, brandCache,
      );

      const createPayload = (variantList) => ({
        name: row.name,
        nameMr: row.name_mr || null,
        description: row.description || null,
        categoryId,
        brandId,
        uomId: uom.id,
        isFavorite: !!row.is_favorite,
        sellingPrice: variantList[0]?.sellingPrice ?? 0,
        costPrice: 0,
        mrp: variantList[0]?.mrp ?? null,
        sku: undefined,
        barcode: variantList.length === 1 ? variantList[0].barcodes?.[0] : undefined,
        barcodes: variantList.length === 1 ? variantList[0].barcodes : undefined,
        variants: variantList.length > 1 || variantList[0]?.size ? variantList : undefined,
      });

      const opts = {
        branchId: branchId || options.branchId || null,
        userId: options.userId || null,
        skipHydrate: true,
      };

      let product;
      try {
        product = await productService.createProduct(db, createPayload(variants), opts);
      } catch (err) {
        const barcodeTaken = err.code === 'BARCODE_TAKEN'
          || /Barcode .+ is already used/i.test(err.message || '');
        if (!barcodeTaken) throw err;

        // Barcode belongs to another product name — import without conflicting codes.
        const match = String(err.message || '').match(/Barcode\s+(\S+)\s+is already used/i);
        const taken = match?.[1] ? [match[1]] : allBarcodes;
        const cleaned = stripTakenBarcodes(variants, taken);
        const hasAnyBarcode = cleaned.some((v) => (v.barcodes || []).length);
        product = await productService.createProduct(
          db,
          createPayload(hasAnyBarcode ? cleaned : cleaned.map((v) => ({ ...v, barcodes: [] }))),
          opts,
        );
      }

      results.imported += 1;
      if (nameKey) {
        existingByName.set(nameKey, { id: product.id, name: product.name });
      }
      results.products.push({
        id: product.id,
        name: product.name,
        masterProductId: row.id,
      });
    } catch (err) {
      results.failed += 1;
      results.errors.push({
        masterProductId: row.id,
        name: row.name,
        message: err.message || 'Import failed',
      });
    }
  }

  return results;
}

module.exports = {
  listMasterCatalogForTenant,
  listMasterCategoriesForTenant,
  listImportableBusinessTypes,
  importMasterProductsToTenant,
};
