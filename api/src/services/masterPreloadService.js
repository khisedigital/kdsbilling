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

async function preloadCatalogToTenantDb(db, businessTypeId) {
  if (!businessTypeId) return { categories: 0, brands: 0, products: 0 };

  const { MasterCategory, MasterBrand, MasterProduct } = getMasterModels();
  const categories = await MasterCategory.findAll({
    where: { business_type_id: businessTypeId, status: 'active' },
    order: [['sort_order', 'ASC']],
  });
  const brands = await MasterBrand.findAll({
    where: { business_type_id: businessTypeId, status: 'active' },
    order: [['sort_order', 'ASC']],
  });
  const products = await MasterProduct.findAll({
    where: { business_type_id: businessTypeId, status: 'active' },
    order: [['sort_order', 'ASC']],
  });

  const { Category, Brand, UnitOfMeasure } = db;
  const categoryByMasterId = {};
  const brandByMasterId = {};

  for (const mc of categories) {
    const row = mc.toJSON ? mc.toJSON() : mc;
    let tenantCat = await Category.findOne({ where: { name: row.name, deleted_at: null } });
    if (!tenantCat) {
      tenantCat = await Category.create({
        name: row.name,
        description: row.description,
        status: 'active',
      });
    }
    categoryByMasterId[row.id] = tenantCat.id;
  }

  for (const mb of brands) {
    const row = mb.toJSON ? mb.toJSON() : mb;
    let tenantBrand = await Brand.findOne({ where: { name: row.name, deleted_at: null } });
    if (!tenantBrand) {
      tenantBrand = await Brand.create({
        name: row.name,
        description: row.description,
        status: 'active',
      });
    }
    brandByMasterId[row.id] = tenantBrand.id;
  }

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

  return { categories: categories.length, brands: brands.length, products: productCount };
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
  preloadCatalogToTenantDb,
  preloadCatalogToTenant,
};
