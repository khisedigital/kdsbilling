const { Op } = require('sequelize');
const AppError = require('../utils/AppError');
const { getMasterModels } = require('../models/master');
const productService = require('./productService');

function serializeMasterForImport(row) {
  const r = row.toJSON ? row.toJSON() : row;
  return {
    id: r.id,
    name: r.name,
    categoryId: r.category_id,
    categoryName: r.category?.name || null,
    businessTypeId: r.business_type_id,
    businessTypeName: r.businessType?.name || null,
    businessTypeCode: r.businessType?.code || null,
    sellingPrice: 0,
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
  const { MasterProduct, MasterCategory, BusinessType } = getMasterModels();
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

  const rows = await MasterProduct.findAll({
    where,
    include: [
      { model: MasterCategory, as: 'category', attributes: ['id', 'name'] },
      { model: BusinessType, as: 'businessType', attributes: ['id', 'name', 'code'] },
    ],
    order: [['sort_order', 'ASC'], ['name', 'ASC']],
    limit: Math.min(Number(query.limit) || 500, 1000),
    offset: Number(query.offset) || 0,
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

async function ensureTenantCategory(db, categoryName) {
  if (!categoryName?.trim()) return null;
  const { Category } = db;
  const name = categoryName.trim();
  const [cat] = await Category.findOrCreate({
    where: { name, deleted_at: null },
    defaults: {
      name,
      status: 'active',
      description: null,
    },
  });
  return cat.id;
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

/**
 * Copy selected master products into the client catalog.
 * Client products get name + category; selling price is always 0.
 * Master catalog is never modified.
 */
async function importMasterProductsToTenant(db, tenant, { masterProductIds, branchId } = {}, options = {}) {
  if (!Array.isArray(masterProductIds) || !masterProductIds.length) {
    throw new AppError('Select at least one master product to import', 400, 'VALIDATION_ERROR');
  }

  const { MasterProduct, MasterCategory } = getMasterModels();
  const masterWhere = {
    id: { [Op.in]: masterProductIds },
    status: 'active',
  };
  if (tenant?.business_type_id) {
    masterWhere.business_type_id = tenant.business_type_id;
  }

  const masters = await MasterProduct.findAll({
    where: masterWhere,
    include: [{ model: MasterCategory, as: 'category', attributes: ['id', 'name'] }],
  });

  if (!masters.length) {
    throw new AppError('No matching master products found for your business type', 404, 'NOT_FOUND');
  }

  const uom = await resolvePcsUom(db);
  const results = {
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    products: [],
  };

  for (const master of masters) {
    const row = master.toJSON ? master.toJSON() : master;
    try {
      const existing = await db.Product.findOne({
        where: {
          name: row.name,
          deleted_at: null,
        },
      });
      if (existing) {
        results.skipped += 1;
        continue;
      }

      const categoryId = await ensureTenantCategory(db, row.category?.name);
      const product = await productService.createProduct(
        db,
        {
          name: row.name,
          description: row.description || null,
          categoryId,
          brandId: null,
          uomId: uom.id,
          sellingPrice: 0,
          costPrice: 0,
          mrp: null,
          sku: undefined,
          barcode: undefined,
        },
        {
          branchId: branchId || options.branchId || null,
          userId: options.userId || null,
        },
      );

      results.imported += 1;
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
