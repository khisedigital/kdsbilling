const { Op } = require('sequelize');
const { getMasterModels } = require('../models/master');
const tenantConnectionManager = require('../config/tenantConnectionManager');
const productService = require('./productService');

async function getActiveMasterUnits() {
  const { MasterUnit } = getMasterModels();
  return MasterUnit.findAll({
    where: { status: 'active' },
    include: [{ model: MasterUnit, as: 'baseUnit', attributes: ['id', 'code'], required: false }],
    order: [['sort_order', 'ASC'], ['type', 'ASC'], ['name', 'ASC']],
  });
}

async function syncMasterUnitsToTenantDb(db) {
  const { UnitOfMeasure } = db;
  const masterUnits = await getActiveMasterUnits();
  const codeToTenantId = {};

  for (const master of masterUnits) {
    const row = master.toJSON ? master.toJSON() : master;
    let tenantUnit = await UnitOfMeasure.findOne({ where: { code: row.code } });

    if (tenantUnit) {
      await tenantUnit.update({
        name: row.name,
        type: row.type,
        conversion_factor: row.conversion_factor,
        base_unit_id: null,
      });
      codeToTenantId[row.code] = tenantUnit.id;
    } else {
      tenantUnit = await UnitOfMeasure.create({
        id: row.id,
        code: row.code,
        name: row.name,
        type: row.type,
        conversion_factor: row.conversion_factor,
        base_unit_id: null,
      });
      codeToTenantId[row.code] = tenantUnit.id;
    }
  }

  for (const master of masterUnits) {
    const row = master.toJSON ? master.toJSON() : master;
    const baseCode = row.baseUnit?.code;
    if (!baseCode) continue;

    const tenantUnit = await UnitOfMeasure.findOne({ where: { code: row.code } });
    const baseTenantId = codeToTenantId[baseCode];
    if (tenantUnit && baseTenantId) {
      await tenantUnit.update({ base_unit_id: baseTenantId });
    }
  }

  return { synced: masterUnits.length };
}

/**
 * Upsert master categories + brands into the tenant DB (by English name).
 * Updates Marathi name / description from master when present.
 * Does not delete tenant-only rows.
 */
async function tableHasColumn(sequelize, tableName, columnName) {
  try {
    const [rows] = await sequelize.query(`SHOW COLUMNS FROM \`${tableName}\` LIKE :column`, {
      replacements: { column: columnName },
    });
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

async function syncMasterCategoriesAndBrandsToTenantDb(db, businessTypeId, options = {}) {
  const relinkProducts = options.relinkProducts === true;
  if (!businessTypeId) {
    return {
      categories: 0,
      brands: 0,
      categoriesCreated: 0,
      brandsCreated: 0,
      categoriesUpdated: 0,
      brandsUpdated: 0,
      productsRelinked: 0,
      nameMrSupported: false,
    };
  }

  const { MasterCategory, MasterBrand } = getMasterModels();
  const { Category, Brand } = db;
  const categoryNameMrSupported = await tableHasColumn(db.sequelize, 'categories', 'name_mr');
  const brandNameMrSupported = await tableHasColumn(db.sequelize, 'brands', 'name_mr');
  const nameMrSupported = categoryNameMrSupported || brandNameMrSupported;

  const categories = await MasterCategory.findAll({
    where: { business_type_id: businessTypeId, status: 'active' },
    order: [['sort_order', 'ASC'], ['name', 'ASC']],
  });
  const brands = await MasterBrand.findAll({
    where: { business_type_id: businessTypeId, status: 'active' },
    order: [['sort_order', 'ASC'], ['name', 'ASC']],
  });

  let categoriesCreated = 0;
  let categoriesUpdated = 0;
  let brandsCreated = 0;
  let brandsUpdated = 0;
  const categoryByMasterId = {};
  const brandByMasterId = {};

  for (const mc of categories) {
    const row = mc.toJSON ? mc.toJSON() : mc;
    const name = String(row.name || '').trim();
    if (!name) continue;

    // utf8mb4_*_ci collations make equality case-insensitive
    let tenantCat = await Category.findOne({
      where: { deleted_at: null, name },
    });

    const nameMr = categoryNameMrSupported && row.name_mr
      ? String(row.name_mr).trim() || null
      : null;
    if (!tenantCat) {
      const payload = {
        name,
        description: row.description || null,
        status: 'active',
      };
      if (categoryNameMrSupported) payload.name_mr = nameMr;
      tenantCat = await Category.create(payload);
      categoriesCreated += 1;
    } else {
      const updates = {};
      if (categoryNameMrSupported && nameMr && tenantCat.name_mr !== nameMr) updates.name_mr = nameMr;
      if (row.description != null && tenantCat.description !== row.description) {
        updates.description = row.description;
      }
      if (tenantCat.status !== 'active') updates.status = 'active';
      if (Object.keys(updates).length) {
        await tenantCat.update(updates);
        categoriesUpdated += 1;
      }
    }
    categoryByMasterId[row.id] = tenantCat.id;
  }

  for (const mb of brands) {
    const row = mb.toJSON ? mb.toJSON() : mb;
    const name = String(row.name || '').trim();
    if (!name) continue;

    let tenantBrand = await Brand.findOne({
      where: { deleted_at: null, name },
    });
    const nameMr = brandNameMrSupported && row.name_mr
      ? String(row.name_mr).trim() || null
      : null;
    if (!tenantBrand) {
      const payload = {
        name,
        description: row.description || null,
        status: 'active',
      };
      if (brandNameMrSupported) payload.name_mr = nameMr;
      tenantBrand = await Brand.create(payload);
      brandsCreated += 1;
    } else {
      const updates = {};
      if (brandNameMrSupported && nameMr && tenantBrand.name_mr !== nameMr) updates.name_mr = nameMr;
      if (row.description != null && tenantBrand.description !== row.description) {
        updates.description = row.description;
      }
      if (tenantBrand.status !== 'active') updates.status = 'active';
      if (Object.keys(updates).length) {
        await tenantBrand.update(updates);
        brandsUpdated += 1;
      }
    }
    brandByMasterId[row.id] = tenantBrand.id;
  }

  // Always fill missing Marathi names (cheap missing-only updates). Full category/brand
  // relink stays opt-in — it was too heavy for every screen open.
  const productsRelinked = await relinkTenantProductsFromMaster(
    db,
    businessTypeId,
    categoryByMasterId,
    brandByMasterId,
    { categoriesAndBrands: relinkProducts, nameMr: true },
  );

  return {
    categories: categories.length,
    brands: brands.length,
    categoriesCreated,
    brandsCreated,
    categoriesUpdated,
    brandsUpdated,
    productsRelinked,
    nameMrSupported,
    categoryByMasterId,
    brandByMasterId,
  };
}

/**
 * Match tenant products to master by English name and set category_id / brand_id / name_mr.
 */
async function relinkTenantProductsFromMaster(
  db,
  businessTypeId,
  categoryByMasterId,
  brandByMasterId,
  options = {},
) {
  const fillCategoriesAndBrands = options.categoriesAndBrands === true;
  const fillNameMr = options.nameMr !== false;
  if (!fillCategoriesAndBrands && !fillNameMr) return 0;

  const { MasterProduct } = getMasterModels();
  const masters = await MasterProduct.findAll({
    where: { business_type_id: businessTypeId, status: 'active' },
    attributes: ['id', 'name', 'name_mr', 'category_id', 'brand_id'],
  });
  if (!masters.length) return 0;

  const tenantProducts = await db.Product.findAll({
    where: { deleted_at: null },
    attributes: ['id', 'name', 'name_mr', 'category_id', 'brand_id'],
  });
  if (!tenantProducts.length) return 0;

  const byName = new Map();
  for (const product of tenantProducts) {
    const key = String(product.name || '').trim().toLowerCase();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(product);
  }

  let relinked = 0;
  const pending = [];

  for (const master of masters) {
    const row = master.toJSON ? master.toJSON() : master;
    const key = String(row.name || '').trim().toLowerCase();
    if (!key) continue;
    const matches = byName.get(key);
    if (!matches?.length) continue;

    const nextCategoryId = row.category_id ? categoryByMasterId[row.category_id] || null : null;
    const nextBrandId = row.brand_id ? brandByMasterId[row.brand_id] || null : null;
    const nextNameMr = row.name_mr ? String(row.name_mr).trim() || null : null;
    if (!nextCategoryId && !nextBrandId && !nextNameMr) continue;

    for (const product of matches) {
      const updates = {};
      // Only fill missing links / Marathi — avoid rewriting the whole catalog every sync.
      if (fillCategoriesAndBrands && nextCategoryId && !product.category_id) {
        updates.category_id = nextCategoryId;
      }
      if (fillCategoriesAndBrands && nextBrandId && !product.brand_id) {
        updates.brand_id = nextBrandId;
      }
      if (fillNameMr && nextNameMr && !product.name_mr) {
        updates.name_mr = nextNameMr;
      }
      if (!Object.keys(updates).length) continue;
      pending.push(product.update(updates).catch(() => null));
      relinked += 1;
      if (pending.length >= 100) {
        await Promise.all(pending.splice(0, pending.length));
      }
    }
  }

  if (pending.length) await Promise.all(pending);
  return relinked;
}

async function preloadCatalogToTenantDb(db, businessTypeId) {
  if (!businessTypeId) return { categories: 0, brands: 0, products: 0 };

  const { MasterProduct } = getMasterModels();
  const products = await MasterProduct.findAll({
    where: { business_type_id: businessTypeId, status: 'active' },
    order: [['sort_order', 'ASC']],
  });

  const { UnitOfMeasure } = db;
  const sync = await syncMasterCategoriesAndBrandsToTenantDb(db, businessTypeId);
  const categoryByMasterId = sync.categoryByMasterId || {};
  const brandByMasterId = sync.brandByMasterId || {};

  let productCount = 0;
  for (const mp of products) {
    const row = mp.toJSON ? mp.toJSON() : mp;
    const uom = await UnitOfMeasure.findOne({ where: { code: row.uom_code } });
    if (!uom) continue;

    const existing = row.sku
      ? await db.ProductVariant.findOne({ where: { sku: row.sku, deleted_at: null } })
      : null;
    if (existing) continue;

    await productService.createProduct(db, {
      name: row.name,
      description: row.description,
      categoryId: row.category_id ? categoryByMasterId[row.category_id] : null,
      brandId: row.brand_id ? brandByMasterId[row.brand_id] : null,
      uomId: uom.id,
      sellingPrice: Number(row.selling_price),
      costPrice: Number(row.cost_price),
      mrp: row.mrp != null ? Number(row.mrp) : undefined,
      sku: row.sku || undefined,
      barcode: row.barcode || undefined,
    });
    productCount += 1;
  }

  return {
    categories: sync.categories,
    brands: sync.brands,
    products: productCount,
  };
}

async function preloadCatalogToTenant(tenantId, businessTypeId) {
  const { db } = await tenantConnectionManager.getTenantModelsForAdmin(tenantId);
  return preloadCatalogToTenantDb(db, businessTypeId);
}

async function syncMasterUnitsToTenant(tenantId) {
  const { db } = await tenantConnectionManager.getTenantModelsForAdmin(tenantId);
  return syncMasterUnitsToTenantDb(db);
}

async function syncMasterUnitsToAllTenants() {
  const { Tenant } = getMasterModels();
  const tenants = await Tenant.findAll({
    where: { status: { [Op.ne]: 'deleted' } },
    attributes: ['id', 'name', 'slug'],
  });

  const results = { tenants: 0, synced: 0, errors: [] };
  for (const tenant of tenants) {
    try {
      const result = await syncMasterUnitsToTenant(tenant.id);
      results.tenants += 1;
      results.synced += result.synced;
    } catch (err) {
      results.errors.push({ tenantId: tenant.id, slug: tenant.slug, message: err.message });
    }
  }
  return results;
}

module.exports = {
  syncMasterUnitsToTenantDb,
  syncMasterUnitsToTenant,
  syncMasterUnitsToAllTenants,
  syncMasterCategoriesAndBrandsToTenantDb,
  preloadCatalogToTenantDb,
  preloadCatalogToTenant,
};
