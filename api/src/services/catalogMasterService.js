const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const AppError = require('../utils/AppError');
const { getMasterModels } = require('../models/master');

function serializeBusinessType(row, counts = {}) {
  const r = row.toJSON ? row.toJSON() : row;
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    status: r.status,
    sortOrder: r.sort_order,
    categoryCount: counts.categories ?? r.categories?.length ?? 0,
    brandCount: counts.brands ?? r.brands?.length ?? 0,
    productCount: counts.products ?? r.products?.length ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function cleanNameMr(value, max = 150) {
  if (value == null) return null;
  const text = String(value).trim().slice(0, max);
  return text || null;
}

function serializeCategory(row) {
  const r = row.toJSON ? row.toJSON() : row;
  return {
    id: r.id,
    businessTypeId: r.business_type_id,
    name: r.name,
    nameMr: r.name_mr || null,
    description: r.description,
    status: r.status,
    sortOrder: r.sort_order,
    businessType: r.businessType ? { id: r.businessType.id, name: r.businessType.name, code: r.businessType.code } : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function serializeBrand(row) {
  const r = row.toJSON ? row.toJSON() : row;
  return {
    id: r.id,
    businessTypeId: r.business_type_id,
    name: r.name,
    nameMr: r.name_mr || null,
    description: r.description,
    status: r.status,
    sortOrder: r.sort_order,
    businessType: r.businessType ? { id: r.businessType.id, name: r.businessType.name, code: r.businessType.code } : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function serializeMasterProduct(row) {
  const r = row.toJSON ? row.toJSON() : row;
  const variants = (r.variants || []).map((variant) => ({
    id: variant.id,
    size: variant.size || null,
    sellingPrice: Number(variant.selling_price) || 0,
    mrp: variant.mrp != null ? Number(variant.mrp) : null,
    barcodes: (variant.barcodes || []).map((barcode) => barcode.barcode).filter(Boolean),
  }));
  return {
    id: r.id,
    businessTypeId: r.business_type_id,
    categoryId: r.category_id,
    brandId: r.brand_id,
    name: r.name,
    nameMr: r.name_mr || null,
    description: r.description,
    uomCode: r.uom_code,
    sellingPrice: Number(r.selling_price),
    costPrice: r.cost_price != null ? Number(r.cost_price) : 0,
    mrp: r.mrp != null ? Number(r.mrp) : null,
    sku: r.sku,
    barcode: r.barcode,
    isFavorite: !!r.is_favorite,
    status: r.status,
    sortOrder: r.sort_order,
    variants,
    category: r.category ? { id: r.category.id, name: r.category.name } : null,
    brand: r.brand ? { id: r.brand.id, name: r.brand.name } : null,
    businessType: r.businessType ? { id: r.businessType.id, name: r.businessType.name, code: r.businessType.code } : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function masterProductInclude() {
  const { MasterCategory, MasterBrand, BusinessType, MasterProductVariant, MasterVariantBarcode } = getMasterModels();
  return [
    { model: MasterCategory, as: 'category', attributes: ['id', 'name'] },
    { model: MasterBrand, as: 'brand', attributes: ['id', 'name'] },
    { model: BusinessType, as: 'businessType', attributes: ['id', 'name', 'code'] },
    {
      model: MasterProductVariant,
      as: 'variants',
      separate: true,
      order: [['sort_order', 'ASC']],
      include: [{ model: MasterVariantBarcode, as: 'barcodes' }],
    },
  ];
}

function cleanVariantInput(variants) {
  return (variants || [])
    .map((variant) => {
      const barcodes = [...new Set(
        (Array.isArray(variant.barcodes) ? variant.barcodes : [variant.barcode])
          .map((code) => String(code || '').trim())
          .filter(Boolean),
      )];
      if (!barcodes.length) return null;
      const selling = Number(variant.sellingPrice ?? variant.selling_price);
      const mrp = variant.mrp == null || variant.mrp === '' ? null : Number(variant.mrp);
      return {
        size: variant.size ? String(variant.size).trim().slice(0, 30) : null,
        barcodes,
        sellingPrice: Number.isFinite(selling) && selling >= 0 ? selling : 0,
        mrp: Number.isFinite(mrp) && mrp >= 0 ? mrp : null,
      };
    })
    .filter(Boolean);
}

function variantsFromProductInput(data) {
  if (Array.isArray(data.variants) && data.variants.length) return cleanVariantInput(data.variants);
  if (data.barcode) {
    return cleanVariantInput([{
      size: null,
      barcodes: [data.barcode],
      sellingPrice: data.sellingPrice ?? 0,
      mrp: data.mrp ?? null,
    }]);
  }
  return [];
}

async function replaceMasterVariants(product, variants, transaction) {
  const { MasterProductVariant, MasterVariantBarcode, MasterProduct } = getMasterModels();
  const existing = await MasterProductVariant.findAll({
    where: { master_product_id: product.id },
    transaction,
  });
  const existingIds = existing.map((row) => row.id);
  if (existingIds.length) {
    await MasterVariantBarcode.destroy({ where: { variant_id: { [Op.in]: existingIds } }, transaction });
    await MasterProductVariant.destroy({ where: { id: { [Op.in]: existingIds } }, transaction });
  }

  const codes = [...new Set(variants.flatMap((variant) => variant.barcodes))];
  if (codes.length) {
    const clashes = await MasterVariantBarcode.findAll({
      where: { barcode: { [Op.in]: codes } },
      include: [{
        model: MasterProductVariant,
        as: 'variant',
        required: true,
        include: [{
          model: MasterProduct,
          as: 'product',
          required: true,
          where: {
            business_type_id: product.business_type_id,
            id: { [Op.ne]: product.id },
          },
        }],
      }],
      transaction,
    });
    if (clashes.length) {
      await MasterVariantBarcode.destroy({
        where: { id: { [Op.in]: clashes.map((row) => row.id) } },
        transaction,
      });
    }
  }

  let firstBarcode = null;
  let headerPrice = 0;
  let headerMrp = null;
  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index];
    const row = await MasterProductVariant.create({
      master_product_id: product.id,
      size: variant.size,
      selling_price: variant.sellingPrice,
      mrp: variant.mrp,
      sort_order: index,
    }, { transaction });
    if (!firstBarcode) {
      firstBarcode = variant.barcodes[0];
      headerPrice = variant.sellingPrice;
      headerMrp = variant.mrp;
    }
    for (let barcodeIndex = 0; barcodeIndex < variant.barcodes.length; barcodeIndex += 1) {
      await MasterVariantBarcode.create({
        variant_id: row.id,
        barcode: variant.barcodes[barcodeIndex],
        is_primary: barcodeIndex === 0,
      }, { transaction });
    }
  }

  await product.update({
    barcode: firstBarcode,
    selling_price: headerPrice,
    mrp: headerMrp,
  }, { transaction });
}

async function listBusinessTypes(query = {}) {
  const { BusinessType, MasterCategory, MasterBrand, MasterProduct } = getMasterModels();
  const where = {};
  if (query.status) where.status = query.status;

  const types = await BusinessType.findAll({
    where,
    order: [['sort_order', 'ASC'], ['name', 'ASC']],
  });

  const results = [];
  for (const t of types) {
    const [categoryCount, brandCount, productCount] = await Promise.all([
      MasterCategory.count({ where: { business_type_id: t.id, status: 'active' } }),
      MasterBrand.count({ where: { business_type_id: t.id, status: 'active' } }),
      MasterProduct.count({ where: { business_type_id: t.id, status: 'active' } }),
    ]);
    results.push(serializeBusinessType(t, { categories: categoryCount, brands: brandCount, products: productCount }));
  }
  return results;
}

async function getBusinessType(id) {
  const { BusinessType } = getMasterModels();
  const type = await BusinessType.findByPk(id);
  if (!type) throw new AppError('Business type not found', 404, 'NOT_FOUND');
  return serializeBusinessType(type);
}

async function createBusinessType(data) {
  const { BusinessType } = getMasterModels();
  if (!data.code?.trim() || !data.name?.trim()) {
    throw new AppError('Code and name are required', 400, 'VALIDATION_ERROR');
  }
  const code = data.code.trim().toLowerCase();
  if (await BusinessType.findOne({ where: { code } })) {
    throw new AppError('Business type code already exists', 409, 'DUPLICATE_ENTRY');
  }
  const type = await BusinessType.create({
    code,
    name: data.name.trim(),
    description: data.description || null,
    status: data.status || 'active',
    sort_order: Number(data.sortOrder) || 0,
  });
  return getBusinessType(type.id);
}

async function updateBusinessType(id, data) {
  const { BusinessType } = getMasterModels();
  const type = await BusinessType.findByPk(id);
  if (!type) throw new AppError('Business type not found', 404, 'NOT_FOUND');
  const updates = {};
  if (data.code !== undefined) updates.code = data.code.trim().toLowerCase();
  if (data.name !== undefined) updates.name = data.name.trim();
  if (data.description !== undefined) updates.description = data.description || null;
  if (data.status !== undefined) updates.status = data.status;
  if (data.sortOrder !== undefined) updates.sort_order = Number(data.sortOrder);
  await type.update(updates);
  return getBusinessType(id);
}

async function deleteBusinessType(id) {
  const { BusinessType, Tenant } = getMasterModels();
  const type = await BusinessType.findByPk(id);
  if (!type) throw new AppError('Business type not found', 404, 'NOT_FOUND');
  const inUse = await Tenant.count({ where: { business_type_id: id } });
  if (inUse > 0) {
    await type.update({ status: 'inactive' });
    return { deactivated: true, message: 'Business type has tenants — marked inactive' };
  }
  await type.destroy();
  return { deleted: true };
}

async function listCategories(query = {}) {
  const { MasterCategory } = getMasterModels();
  const where = {};
  if (query.businessTypeId) where.business_type_id = query.businessTypeId;
  if (query.status) where.status = query.status;

  const rows = await MasterCategory.findAll({
    where,
    include: [{ model: getMasterModels().BusinessType, as: 'businessType', attributes: ['id', 'name', 'code'] }],
    order: [['sort_order', 'ASC'], ['name', 'ASC']],
  });
  return rows.map(serializeCategory);
}

async function createCategory(data) {
  const { MasterCategory, BusinessType } = getMasterModels();
  if (!data.businessTypeId) throw new AppError('Business type is required', 400, 'VALIDATION_ERROR');
  if (!data.name?.trim()) throw new AppError('Category name is required', 400, 'VALIDATION_ERROR');
  const bt = await BusinessType.findByPk(data.businessTypeId);
  if (!bt) throw new AppError('Business type not found', 404, 'NOT_FOUND');

  const cat = await MasterCategory.create({
    business_type_id: data.businessTypeId,
    name: data.name.trim(),
    name_mr: cleanNameMr(data.nameMr),
    description: data.description || null,
    status: data.status || 'active',
    sort_order: Number(data.sortOrder) || 0,
  });
  const row = await MasterCategory.findByPk(cat.id, {
    include: [{ model: BusinessType, as: 'businessType', attributes: ['id', 'name', 'code'] }],
  });
  return serializeCategory(row);
}

async function updateCategory(id, data) {
  const { MasterCategory, BusinessType } = getMasterModels();
  const cat = await MasterCategory.findByPk(id);
  if (!cat) throw new AppError('Category not found', 404, 'NOT_FOUND');
  const updates = {};
  if (data.name !== undefined) updates.name = data.name.trim();
  if (data.nameMr !== undefined) updates.name_mr = cleanNameMr(data.nameMr);
  if (data.description !== undefined) updates.description = data.description || null;
  if (data.status !== undefined) updates.status = data.status;
  if (data.sortOrder !== undefined) updates.sort_order = Number(data.sortOrder);
  if (data.businessTypeId !== undefined) updates.business_type_id = data.businessTypeId;
  await cat.update(updates);
  const row = await MasterCategory.findByPk(id, {
    include: [{ model: BusinessType, as: 'businessType', attributes: ['id', 'name', 'code'] }],
  });
  return serializeCategory(row);
}

async function deleteCategory(id) {
  const { MasterCategory, MasterProduct } = getMasterModels();
  const cat = await MasterCategory.findByPk(id);
  if (!cat) throw new AppError('Category not found', 404, 'NOT_FOUND');
  // Unlink products so delete always works (category becomes empty on products).
  await MasterProduct.update({ category_id: null }, { where: { category_id: id } });
  await cat.destroy();
  return { deleted: true };
}

async function listBrands(query = {}) {
  const { MasterBrand, BusinessType } = getMasterModels();
  const where = {};
  if (query.businessTypeId) where.business_type_id = query.businessTypeId;
  if (query.status) where.status = query.status;

  const rows = await MasterBrand.findAll({
    where,
    include: [{ model: BusinessType, as: 'businessType', attributes: ['id', 'name', 'code'] }],
    order: [['sort_order', 'ASC'], ['name', 'ASC']],
  });
  return rows.map(serializeBrand);
}

async function createBrand(data) {
  const { MasterBrand, BusinessType } = getMasterModels();
  if (!data.businessTypeId) throw new AppError('Business type is required', 400, 'VALIDATION_ERROR');
  if (!data.name?.trim()) throw new AppError('Brand name is required', 400, 'VALIDATION_ERROR');
  const bt = await BusinessType.findByPk(data.businessTypeId);
  if (!bt) throw new AppError('Business type not found', 404, 'NOT_FOUND');

  const existing = await MasterBrand.findOne({
    where: { business_type_id: data.businessTypeId, name: data.name.trim() },
  });
  if (existing) throw new AppError('Brand already exists for this business type', 409, 'DUPLICATE_ENTRY');

  const brand = await MasterBrand.create({
    business_type_id: data.businessTypeId,
    name: data.name.trim(),
    name_mr: cleanNameMr(data.nameMr),
    description: data.description || null,
    status: data.status || 'active',
    sort_order: Number(data.sortOrder) || 0,
  });
  const row = await MasterBrand.findByPk(brand.id, {
    include: [{ model: BusinessType, as: 'businessType', attributes: ['id', 'name', 'code'] }],
  });
  return serializeBrand(row);
}

async function updateBrand(id, data) {
  const { MasterBrand, BusinessType } = getMasterModels();
  const brand = await MasterBrand.findByPk(id);
  if (!brand) throw new AppError('Brand not found', 404, 'NOT_FOUND');
  const updates = {};
  if (data.name !== undefined) updates.name = data.name.trim();
  if (data.nameMr !== undefined) updates.name_mr = cleanNameMr(data.nameMr);
  if (data.description !== undefined) updates.description = data.description || null;
  if (data.status !== undefined) updates.status = data.status;
  if (data.sortOrder !== undefined) updates.sort_order = Number(data.sortOrder);
  if (data.businessTypeId !== undefined) updates.business_type_id = data.businessTypeId;
  await brand.update(updates);
  const row = await MasterBrand.findByPk(id, {
    include: [{ model: BusinessType, as: 'businessType', attributes: ['id', 'name', 'code'] }],
  });
  return serializeBrand(row);
}

async function deleteBrand(id) {
  const { MasterBrand, MasterProduct } = getMasterModels();
  const brand = await MasterBrand.findByPk(id);
  if (!brand) throw new AppError('Brand not found', 404, 'NOT_FOUND');
  await MasterProduct.update({ brand_id: null }, { where: { brand_id: id } });
  await brand.destroy();
  return { deleted: true };
}

async function listMasterProducts(query = {}) {
  const { MasterProduct } = getMasterModels();
  const where = {};
  if (query.businessTypeId) where.business_type_id = query.businessTypeId;
  if (query.categoryId) where.category_id = query.categoryId;
  if (query.brandId) where.brand_id = query.brandId;
  if (query.status) where.status = query.status;
  if (query.search) {
    const { MasterVariantBarcode, MasterProductVariant } = getMasterModels();
    const barcodeHits = await MasterVariantBarcode.findAll({
      where: { barcode: { [Op.like]: `%${query.search}%` } },
      include: [{ model: MasterProductVariant, as: 'variant', attributes: ['master_product_id'] }],
    });
    const ids = [...new Set(barcodeHits.map((row) => row.variant?.master_product_id).filter(Boolean))];
    where[Op.or] = [
      { name: { [Op.like]: `%${query.search}%` } },
      { name_mr: { [Op.like]: `%${query.search}%` } },
      { sku: { [Op.like]: `%${query.search}%` } },
      { barcode: { [Op.like]: `%${query.search}%` } },
      ...(ids.length ? [{ id: { [Op.in]: ids } }] : []),
    ];
  }

  const rows = await MasterProduct.findAll({
    where,
    include: masterProductInclude(),
    order: [['is_favorite', 'DESC'], ['sort_order', 'ASC'], ['name', 'ASC']],
  });
  return rows.map(serializeMasterProduct);
}

async function createMasterProduct(data) {
  const { MasterProduct, BusinessType, MasterCategory, MasterBrand } = getMasterModels();
  if (!data.businessTypeId) throw new AppError('Business type is required', 400, 'VALIDATION_ERROR');
  if (!data.name?.trim()) throw new AppError('Product name is required', 400, 'VALIDATION_ERROR');

  const bt = await BusinessType.findByPk(data.businessTypeId);
  if (!bt) throw new AppError('Business type not found', 404, 'NOT_FOUND');
  if (data.categoryId) {
    const cat = await MasterCategory.findOne({ where: { id: data.categoryId, business_type_id: data.businessTypeId } });
    if (!cat) throw new AppError('Category not found for this business type', 400, 'VALIDATION_ERROR');
  }
  if (data.brandId) {
    const brand = await MasterBrand.findOne({ where: { id: data.brandId, business_type_id: data.businessTypeId } });
    if (!brand) throw new AppError('Brand not found for this business type', 400, 'VALIDATION_ERROR');
  }

  const product = await MasterProduct.create({
    business_type_id: data.businessTypeId,
    category_id: data.categoryId || null,
    brand_id: data.brandId || null,
    name: data.name.trim(),
    name_mr: data.nameMr ? String(data.nameMr).trim().slice(0, 200) : null,
    description: data.description || null,
    uom_code: (data.uomCode || 'pcs').trim().toLowerCase(),
    selling_price: data.sellingPrice ?? 0,
    cost_price: data.costPrice ?? 0,
    mrp: data.mrp ?? null,
    sku: data.sku || null,
    barcode: data.barcode || null,
    is_favorite: !!(data.isFavorite ?? data.is_favorite),
    status: data.status || 'active',
    sort_order: Number(data.sortOrder) || 0,
  });

  const variants = variantsFromProductInput(data);
  if (variants.length) {
    const transaction = await getMasterModels().sequelize.transaction();
    try {
      await replaceMasterVariants(product, variants, transaction);
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      await product.destroy();
      throw err;
    }
  }

  const row = await MasterProduct.findByPk(product.id, { include: masterProductInclude() });
  return serializeMasterProduct(row);
}

async function updateMasterProduct(id, data) {
  const { MasterProduct, MasterCategory, MasterBrand, BusinessType } = getMasterModels();
  const product = await MasterProduct.findByPk(id);
  if (!product) throw new AppError('Master product not found', 404, 'NOT_FOUND');

  const businessTypeId = data.businessTypeId || product.business_type_id;
  if (data.categoryId) {
    const cat = await MasterCategory.findOne({ where: { id: data.categoryId, business_type_id: businessTypeId } });
    if (!cat) throw new AppError('Category not found for this business type', 400, 'VALIDATION_ERROR');
  }
  if (data.brandId) {
    const brand = await MasterBrand.findOne({ where: { id: data.brandId, business_type_id: businessTypeId } });
    if (!brand) throw new AppError('Brand not found for this business type', 400, 'VALIDATION_ERROR');
  }

  const updates = {};
  if (data.name !== undefined) updates.name = data.name.trim();
  if (data.nameMr !== undefined) updates.name_mr = data.nameMr ? String(data.nameMr).trim().slice(0, 200) : null;
  if (data.description !== undefined) updates.description = data.description || null;
  if (data.uomCode !== undefined) updates.uom_code = data.uomCode.trim().toLowerCase();
  if (data.sellingPrice !== undefined) updates.selling_price = data.sellingPrice;
  if (data.costPrice !== undefined) updates.cost_price = data.costPrice;
  if (data.mrp !== undefined) updates.mrp = data.mrp;
  if (data.sku !== undefined) updates.sku = data.sku || null;
  if (data.barcode !== undefined) updates.barcode = data.barcode || null;
  if (data.isFavorite !== undefined || data.is_favorite !== undefined) {
    updates.is_favorite = !!(data.isFavorite ?? data.is_favorite);
  }
  if (data.status !== undefined) updates.status = data.status;
  if (data.sortOrder !== undefined) updates.sort_order = Number(data.sortOrder);
  if (data.categoryId !== undefined) updates.category_id = data.categoryId || null;
  if (data.brandId !== undefined) updates.brand_id = data.brandId || null;
  if (data.businessTypeId !== undefined) updates.business_type_id = data.businessTypeId;

  await product.update(updates);
  if (Array.isArray(data.variants)) {
    const transaction = await getMasterModels().sequelize.transaction();
    try {
      await replaceMasterVariants(product, cleanVariantInput(data.variants), transaction);
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
  const row = await MasterProduct.findByPk(id, { include: masterProductInclude() });
  return serializeMasterProduct(row);
}

async function deleteMasterProduct(id) {
  const { MasterProduct, MasterProductVariant, MasterVariantBarcode } = getMasterModels();
  const product = await MasterProduct.findByPk(id);
  if (!product) throw new AppError('Master product not found', 404, 'NOT_FOUND');
  const variants = await MasterProductVariant.findAll({ where: { master_product_id: id } });
  const variantIds = variants.map((row) => row.id);
  if (variantIds.length) {
    await MasterVariantBarcode.destroy({ where: { variant_id: { [Op.in]: variantIds } } });
    await MasterProductVariant.destroy({ where: { id: { [Op.in]: variantIds } } });
  }
  await product.destroy();
  return { deleted: true };
}

function keepExistingPrices(incoming, existingVariants) {
  const kept = new Map();
  for (const variant of existingVariants || []) {
    const selling = Number(variant.selling_price) || 0;
    const mrp = variant.mrp != null ? Number(variant.mrp) : null;
    for (const barcode of variant.barcodes || []) {
      if (barcode.barcode) kept.set(barcode.barcode, { selling, mrp });
    }
  }
  return incoming.map((variant) => {
    let sellingPrice = variant.sellingPrice;
    let mrp = variant.mrp;
    for (const code of variant.barcodes) {
      const previous = kept.get(code);
      if (!previous) continue;
      if (!sellingPrice && previous.selling) sellingPrice = previous.selling;
      if (mrp == null && previous.mrp != null) mrp = previous.mrp;
    }
    return { ...variant, sellingPrice: sellingPrice || 0, mrp };
  });
}

/**
 * When a shop creates a product, mirror it into the business-type master catalog
 * if nothing already matches by barcode or English name.
 * Never throws for "already exists" — returns { created:false }.
 */
async function ensureTenantProductInMaster(tenant, product) {
  const businessTypeId = tenant?.business_type_id || null;
  const name = String(product?.name || '').trim();
  if (!businessTypeId || !name) {
    return { created: false, skipped: true, reason: 'missing_business_type_or_name' };
  }

  const { MasterProduct, MasterProductVariant, MasterVariantBarcode } = getMasterModels();
  const variantsRaw = Array.isArray(product.variants) ? product.variants : [];
  const barcodes = [
    ...new Set(
      variantsRaw.flatMap((variant) =>
        (variant.barcodes || [])
          .map((row) => String(row?.barcode || row || '').trim())
          .filter(Boolean),
      ),
    ),
  ];

  let existing = null;
  if (barcodes.length) {
    const barcodeHit = await MasterVariantBarcode.findOne({
      where: { barcode: { [Op.in]: barcodes } },
      include: [{
        model: MasterProductVariant,
        as: 'variant',
        required: true,
        include: [{
          model: MasterProduct,
          as: 'product',
          required: true,
          where: { business_type_id: businessTypeId },
        }],
      }],
    });
    existing = barcodeHit?.variant?.product || null;
    if (!existing) {
      existing = await MasterProduct.findOne({
        where: { business_type_id: businessTypeId, barcode: { [Op.in]: barcodes } },
      });
    }
  }
  if (!existing) {
    existing = await MasterProduct.findOne({
      where: {
        business_type_id: businessTypeId,
        name: { [Op.like]: name },
      },
    });
  }
  if (existing) {
    return { created: false, id: existing.id };
  }

  const categoryName = product.category?.name || product.categoryName || null;
  const brandName = product.brand?.name || product.brandName || null;
  const categoryId = categoryName
    ? await findOrCreateMasterCategory(businessTypeId, categoryName, null, product.category?.name_mr)
    : null;
  const brandId = brandName
    ? await findOrCreateMasterBrand(businessTypeId, brandName, null, product.brand?.name_mr)
    : null;

  const uomCode = String(product.uom?.code || product.uomCode || 'pcs').trim().toLowerCase() || 'pcs';
  const masterVariants = variantsRaw
    .map((variant) => {
      const codes = [...new Set(
        (variant.barcodes || [])
          .map((row) => String(row?.barcode || row || '').trim())
          .filter(Boolean),
      )];
      if (!codes.length && !variant.size) return null;
      return {
        size: variant.size || null,
        barcodes: codes,
        sellingPrice: Number(variant.selling_price ?? variant.sellingPrice) || 0,
        mrp: variant.mrp != null ? Number(variant.mrp) : null,
      };
    })
    .filter(Boolean);

  // cleanVariantInput drops barcode-less rows; keep at least one priced size when possible.
  const variantsWithCodes = masterVariants.filter((row) => (row.barcodes || []).length);
  const primary = variantsRaw[0] || {};
  const sellingPrice = Number(
    primary.selling_price ?? primary.sellingPrice ?? product.selling_price ?? product.sellingPrice,
  ) || 0;
  const costPrice = Number(
    primary.cost_price ?? primary.costPrice ?? product.cost_price ?? product.costPrice,
  ) || 0;
  const mrp = primary.mrp != null
    ? Number(primary.mrp)
    : (product.mrp != null ? Number(product.mrp) : null);
  const primaryBarcode = barcodes[0] || null;

  const created = await createMasterProduct({
    businessTypeId,
    categoryId,
    brandId,
    name,
    nameMr: product.name_mr || product.nameMr || null,
    description: product.description || null,
    uomCode,
    sellingPrice,
    costPrice,
    mrp: Number.isFinite(mrp) ? mrp : null,
    sku: primary.sku || product.sku || null,
    barcode: primaryBarcode,
    isFavorite: !!(product.is_favorite ?? product.isFavorite),
    status: product.status || 'active',
    variants: variantsWithCodes.length ? variantsWithCodes : undefined,
  });

  return { created: true, id: created.id };
}

/**
 * One master product, with one variant per pack size.
 * Match an existing row by barcode in this business type, otherwise by name.
 */
async function upsertImportedMasterProduct({ businessTypeId, categoryId, brandId, item }) {
  const { MasterProduct, MasterProductVariant, MasterVariantBarcode, sequelize } = getMasterModels();
  let variants = item.variants?.length
    ? cleanVariantInput(item.variants)
    : cleanVariantInput([{
      size: null,
      barcodes: item.barcodes || [],
      sellingPrice: item.sellingPrice || 0,
      mrp: item.mrp,
    }]);
  if (!variants.length) {
    throw new AppError('Product has no usable barcode', 400, 'VALIDATION_ERROR');
  }

  const codes = [...new Set(variants.flatMap((variant) => variant.barcodes))];
  const barcodeHit = await MasterVariantBarcode.findOne({
    where: { barcode: { [Op.in]: codes } },
    include: [{
      model: MasterProductVariant,
      as: 'variant',
      required: true,
      include: [{
        model: MasterProduct,
        as: 'product',
        required: true,
        where: { business_type_id: businessTypeId },
      }],
    }],
  });
  let product = barcodeHit?.variant?.product || null;
  if (!product) {
    product = await MasterProduct.findOne({
      where: { business_type_id: businessTypeId, barcode: { [Op.in]: codes } },
    });
  }
  if (!product) {
    product = await MasterProduct.findOne({
      where: { business_type_id: businessTypeId, name: item.name },
    });
  }

  const created = !product;
  if (!product) {
    product = await MasterProduct.create({
      business_type_id: businessTypeId,
      category_id: categoryId,
      brand_id: brandId,
      name: item.name,
      name_mr: item.nameMr || null,
      description: item.description || null,
      uom_code: 'pcs',
      selling_price: 0,
      cost_price: 0,
      status: 'active',
      sort_order: 0,
    });
  } else {
    const current = await MasterProduct.findByPk(product.id, {
      include: [{
        model: MasterProductVariant,
        as: 'variants',
        include: [{ model: MasterVariantBarcode, as: 'barcodes' }],
      }],
    });
    variants = keepExistingPrices(variants, current?.variants || []);
    const sellingNow = Number(product.selling_price) || 0;
    await product.update({
      name: item.name,
      name_mr: item.nameMr || product.name_mr,
      description: item.description || product.description,
      category_id: categoryId || product.category_id,
      brand_id: brandId || product.brand_id,
      uom_code: 'pcs',
      status: 'active',
      selling_price: sellingNow > 0 ? product.selling_price : variants[0].sellingPrice || 0,
    });
  }

  const transaction = await sequelize.transaction();
  try {
    await replaceMasterVariants(product, variants, transaction);
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    if (created) await product.destroy().catch(() => {});
    throw err;
  }

  return { created, id: product.id };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function looksLikeUuid(value) {
  return UUID_RE.test(String(value || '').trim());
}

async function resolveBusinessTypeForImport(defaultBusinessTypeId, row) {
  const { BusinessType } = getMasterModels();
  const codeOrName = row.businessTypeCode || row.businessType || row.businessTypeId;
  if (codeOrName) {
    const raw = String(codeOrName).trim();
    let bt = null;
    if (looksLikeUuid(raw)) {
      bt = await BusinessType.findByPk(raw);
    }
    if (!bt) {
      const normalized = raw.toLowerCase();
      bt = await BusinessType.findOne({
        where: {
          [Op.or]: [
            { code: normalized },
            { name: { [Op.like]: raw } },
          ],
        },
      });
    }
    if (bt) return bt.id;
    // Export CSVs often carry local UUIDs that differ on the server — use selected default BT.
    if (defaultBusinessTypeId) return defaultBusinessTypeId;
    throw new AppError(`Business type not found: ${codeOrName}`, 400, 'VALIDATION_ERROR');
  }
  if (!defaultBusinessTypeId) {
    throw new AppError('Business type is required (select above or add businessTypeCode column)', 400, 'VALIDATION_ERROR');
  }
  return defaultBusinessTypeId;
}

async function findOrCreateMasterCategory(businessTypeId, categoryName, results, nameMr = null) {
  const { MasterCategory } = getMasterModels();
  const name = String(categoryName).trim();
  if (!name) return null;
  const cleanedMr = cleanNameMr(nameMr);
  const [cat, created] = await MasterCategory.findOrCreate({
    where: { business_type_id: businessTypeId, name },
    defaults: {
      id: uuidv4(),
      business_type_id: businessTypeId,
      name,
      name_mr: cleanedMr,
      status: 'active',
      sort_order: 0,
    },
  });
  if (!created && cleanedMr && cat.name_mr !== cleanedMr) {
    await cat.update({ name_mr: cleanedMr });
  }
  if (created && results) results.categoriesCreated += 1;
  return cat.id;
}

async function findOrCreateMasterBrand(businessTypeId, brandName, results, nameMr = null) {
  const { MasterBrand } = getMasterModels();
  const name = String(brandName).trim();
  if (!name) return null;
  const cleanedMr = cleanNameMr(nameMr);
  const [brand, created] = await MasterBrand.findOrCreate({
    where: { business_type_id: businessTypeId, name },
    defaults: {
      id: uuidv4(),
      business_type_id: businessTypeId,
      name,
      name_mr: cleanedMr,
      status: 'active',
      sort_order: 0,
    },
  });
  if (!created && cleanedMr && brand.name_mr !== cleanedMr) {
    await brand.update({ name_mr: cleanedMr });
  }
  if (created && results) results.brandsCreated += 1;
  return brand.id;
}

async function bulkImportMasterCategories({ businessTypeId, rows }) {
  if (!businessTypeId) throw new AppError('Business type is required', 400, 'VALIDATION_ERROR');
  if (!Array.isArray(rows) || !rows.length) {
    throw new AppError('Import rows array is required', 400, 'VALIDATION_ERROR');
  }

  const results = { success: 0, failed: 0, skipped: 0, errors: [] };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const name = String(row.name || '').trim();
      if (!name) throw new AppError('Category name is required', 400, 'VALIDATION_ERROR');
      const { MasterCategory } = getMasterModels();
      const existing = await MasterCategory.findOne({
        where: { business_type_id: businessTypeId, name },
      });
      if (existing) {
        const nameMr = cleanNameMr(row.nameMr ?? row.name_mr);
        if (nameMr && existing.name_mr !== nameMr) {
          await existing.update({ name_mr: nameMr });
          results.success += 1;
          continue;
        }
        results.skipped += 1;
        continue;
      }
      await createCategory({
        businessTypeId,
        name,
        nameMr: row.nameMr ?? row.name_mr,
        description: row.description || null,
        sortOrder: Number(row.sortOrder ?? row.sort_order) || 0,
        status: row.status || 'active',
      });
      results.success += 1;
    } catch (err) {
      results.failed += 1;
      results.errors.push({ row: i + 1, name: row.name || '', message: err.message });
    }
  }
  return results;
}

async function bulkImportMasterBrands({ businessTypeId, rows }) {
  if (!businessTypeId) throw new AppError('Business type is required', 400, 'VALIDATION_ERROR');
  if (!Array.isArray(rows) || !rows.length) {
    throw new AppError('Import rows array is required', 400, 'VALIDATION_ERROR');
  }

  const results = { success: 0, failed: 0, skipped: 0, errors: [] };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const name = String(row.name || '').trim();
      if (!name) throw new AppError('Brand name is required', 400, 'VALIDATION_ERROR');
      const { MasterBrand } = getMasterModels();
      const existing = await MasterBrand.findOne({
        where: { business_type_id: businessTypeId, name },
      });
      if (existing) {
        const nameMr = cleanNameMr(row.nameMr ?? row.name_mr);
        if (nameMr && existing.name_mr !== nameMr) {
          await existing.update({ name_mr: nameMr });
          results.success += 1;
          continue;
        }
        results.skipped += 1;
        continue;
      }
      await createBrand({
        businessTypeId,
        name,
        nameMr: row.nameMr ?? row.name_mr,
        description: row.description || null,
        sortOrder: Number(row.sortOrder ?? row.sort_order) || 0,
        status: row.status || 'active',
      });
      results.success += 1;
    } catch (err) {
      results.failed += 1;
      results.errors.push({ row: i + 1, name: row.name || '', message: err.message });
    }
  }
  return results;
}

async function bulkImportMasterProducts({ businessTypeId, rows, options = {} }) {
  const {
    MasterProduct,
    MasterCategory,
    MasterBrand,
    BusinessType,
    MasterProductVariant,
    MasterVariantBarcode,
    sequelize,
  } = getMasterModels();
  if (!Array.isArray(rows) || !rows.length) {
    throw new AppError('Import rows array is required', 400, 'VALIDATION_ERROR');
  }

  const createCategories = options.createCategories !== false;
  const createBrands = options.createBrands !== false;
  // Default: update matching barcode/SKU. skipDuplicates=true (legacy checkbox) also means upsert.
  const updateExisting = options.updateExisting !== false;
  const results = {
    success: 0,
    created: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
    categoriesCreated: 0,
    brandsCreated: 0,
    errors: [],
  };

  const btCache = new Map();
  const categoryCache = new Map();
  const brandCache = new Map();
  // Per business-type: barcode/sku → product id (built lazily + updated as we go)
  const barcodeMaps = new Map();
  const skuMaps = new Map();

  const resolveBt = async (row) => {
    const codeOrName = row.businessTypeCode || row.businessType;
    const cacheKey = codeOrName ? String(codeOrName).trim().toLowerCase() : `__default__:${businessTypeId || ''}`;
    if (btCache.has(cacheKey)) return btCache.get(cacheKey);
    const id = await resolveBusinessTypeForImport(businessTypeId, row);
    btCache.set(cacheKey, id);
    return id;
  };

  const getSkuMap = (btId) => {
    if (!skuMaps.has(btId)) skuMaps.set(btId, new Map());
    return skuMaps.get(btId);
  };

  const getBarcodeMap = (btId) => {
    if (!barcodeMaps.has(btId)) barcodeMaps.set(btId, new Map());
    return barcodeMaps.get(btId);
  };

  const findMatchingProduct = async (btId, sku, barcode) => {
    // In-run cache first (same CSV / same request chunk)
    if (barcode) {
      const cachedId = getBarcodeMap(btId).get(barcode);
      if (cachedId) {
        const product = await MasterProduct.findByPk(cachedId);
        if (product && product.business_type_id === btId) return product;
      }
      let product = await MasterProduct.findOne({
        where: { business_type_id: btId, barcode },
      });
      if (product) return product;

      const clash = await MasterVariantBarcode.findOne({
        where: { barcode },
        include: [{
          model: MasterProductVariant,
          as: 'variant',
          required: true,
          attributes: ['master_product_id'],
          include: [{
            model: MasterProduct,
            as: 'product',
            required: true,
            attributes: ['id'],
            where: { business_type_id: btId },
          }],
        }],
      });
      if (clash?.variant?.master_product_id) {
        product = await MasterProduct.findByPk(clash.variant.master_product_id);
        if (product) return product;
      }
    }

    if (sku) {
      const cachedId = getSkuMap(btId).get(sku);
      if (cachedId) {
        const product = await MasterProduct.findByPk(cachedId);
        if (product && product.business_type_id === btId) return product;
      }
      const product = await MasterProduct.findOne({
        where: { business_type_id: btId, sku },
      });
      if (product) return product;
    }
    return null;
  };

  const rememberProductKeys = (btId, productId, sku, barcode) => {
    if (sku) getSkuMap(btId).set(sku, productId);
    if (barcode) getBarcodeMap(btId).set(barcode, productId);
  };

  const resolveCategory = async (btId, categoryName, categoryMr) => {
    const name = String(categoryName || '').trim();
    if (!name) return null;
    const key = `${btId}::${name.toLowerCase()}`;
    if (categoryCache.has(key)) return categoryCache.get(key);

    // CSV exports often put category UUID in the category column.
    if (looksLikeUuid(name)) {
      const byId = await MasterCategory.findOne({
        where: { id: name, business_type_id: btId },
        attributes: ['id'],
      });
      if (byId) {
        categoryCache.set(key, byId.id);
        return byId.id;
      }
      // Wrong/stale UUID — ignore instead of creating a category named like a UUID.
      categoryCache.set(key, null);
      return null;
    }

    let id = null;
    if (!createCategories) {
      const cat = await MasterCategory.findOne({
        where: { business_type_id: btId, name },
        attributes: ['id'],
      });
      if (!cat) throw new AppError(`Category not found: ${categoryName}`, 400, 'VALIDATION_ERROR');
      id = cat.id;
    } else {
      id = await findOrCreateMasterCategory(btId, name, results, categoryMr);
    }
    categoryCache.set(key, id);
    return id;
  };

  const resolveBrand = async (btId, brandName, brandMr) => {
    const name = String(brandName || '').trim();
    if (!name) return null;
    const key = `${btId}::${name.toLowerCase()}`;
    if (brandCache.has(key)) return brandCache.get(key);

    if (looksLikeUuid(name)) {
      const byId = await MasterBrand.findOne({
        where: { id: name, business_type_id: btId },
        attributes: ['id'],
      });
      if (byId) {
        brandCache.set(key, byId.id);
        return byId.id;
      }
      brandCache.set(key, null);
      return null;
    }

    let id = null;
    if (!createBrands) {
      const brand = await MasterBrand.findOne({
        where: { business_type_id: btId, name },
        attributes: ['id'],
      });
      if (!brand) throw new AppError(`Brand not found: ${brandName}`, 400, 'VALIDATION_ERROR');
      id = brand.id;
    } else {
      id = await findOrCreateMasterBrand(btId, name, results, brandMr);
    }
    brandCache.set(key, id);
    return id;
  };

  // Validate default business type once when provided.
  if (businessTypeId) {
    const bt = await BusinessType.findByPk(businessTypeId, { attributes: ['id'] });
    if (!bt) throw new AppError('Business type not found', 404, 'NOT_FOUND');
    btCache.set(`__default__:${businessTypeId}`, businessTypeId);
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const name = String(row.name || row.Name || row.product || row.Product || '').trim();
      if (!name) throw new AppError('Product name is required', 400, 'VALIDATION_ERROR');

      const resolvedBusinessTypeId = await resolveBt(row);
      const parseMoney = (value) => {
        if (value === undefined || value === null || value === '') return 0;
        if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
        const cleaned = String(value)
          .replace(/₹/g, '')
          .replace(/rs\.?/gi, '')
          .replace(/,/g, '')
          .trim();
        if (!cleaned) return 0;
        const n = Number(cleaned);
        return Number.isFinite(n) ? n : 0;
      };
      const sellingPrice = parseMoney(row.sellingPrice ?? row.selling_price ?? row.price);
      const costPrice = parseMoney(row.costPrice ?? row.cost_price);
      const mrpRaw = row.mrp ?? row.MRP;
      const mrp = mrpRaw === undefined || mrpRaw === null || mrpRaw === ''
        ? null
        : parseMoney(mrpRaw);

      const categoryId = row.category
        ? await resolveCategory(
          resolvedBusinessTypeId,
          row.category,
          row.categoryNameMr ?? row.category_name_mr ?? row.categoryMr,
        )
        : null;
      const brandId = row.brand
        ? await resolveBrand(
          resolvedBusinessTypeId,
          row.brand,
          row.brandNameMr ?? row.brand_name_mr ?? row.brandMr,
        )
        : null;

      const sku = row.sku ? String(row.sku).trim() : null;
      const barcode = row.barcode ? String(row.barcode).trim() : null;

      let uom = String(row.uomCode || row.uom || 'pcs').trim().toLowerCase() || 'pcs';
      if (uom.length > 10) uom = uom.slice(0, 10);

      const payload = {
        business_type_id: resolvedBusinessTypeId,
        category_id: categoryId,
        brand_id: brandId,
        name: name.slice(0, 200),
        name_mr: cleanNameMr(row.nameMr ?? row.name_mr, 200),
        description: row.description || null,
        uom_code: uom,
        selling_price: sellingPrice,
        cost_price: costPrice,
        mrp,
        sku: sku ? sku.slice(0, 50) : null,
        barcode: barcode ? barcode.slice(0, 50) : null,
        status: row.status || 'active',
        sort_order: Number(row.sortOrder ?? row.sort_order) || 0,
      };

      let product = await findMatchingProduct(resolvedBusinessTypeId, sku, barcode);
      let wasUpdate = false;

      if (product && updateExisting) {
        await product.update(payload);
        wasUpdate = true;
      } else if (product && !updateExisting) {
        results.skipped += 1;
        continue;
      } else {
        product = await MasterProduct.create(payload);
      }

      const variants = variantsFromProductInput({
        barcode,
        sellingPrice,
        mrp,
        variants: row.variants,
      });
      if (variants.length) {
        const transaction = await sequelize.transaction();
        try {
          await replaceMasterVariants(product, variants, transaction);
          await transaction.commit();
        } catch (err) {
          await transaction.rollback();
          // Keep the product even if barcode/variant attach fails (duplicate barcode, etc.)
          if (results.errors.length < 50) {
            results.errors.push({
              row: i + 1,
              name,
              message: `${wasUpdate ? 'Updated' : 'Saved'} without barcode: ${err.message}`,
            });
          }
        }
      }

      rememberProductKeys(resolvedBusinessTypeId, product.id, payload.sku, payload.barcode);
      if (wasUpdate) results.updated += 1;
      else results.created += 1;
      results.success += 1;
    } catch (err) {
      results.failed += 1;
      if (results.errors.length < 50) {
        results.errors.push({ row: i + 1, name: row.name || '', message: err.message });
      }
    }
  }

  return results;
}

/** Newest saved barcodes for this catalog, so an API import can continue after them. */
async function latestSavedMasterBarcodes(businessTypeId, limit = 20) {
  if (!businessTypeId) return [];
  const { MasterProduct, MasterProductVariant, MasterVariantBarcode } = getMasterModels();
  const rows = await MasterProduct.findAll({
    where: { business_type_id: businessTypeId },
    order: [['createdAt', 'DESC']],
    limit: 40,
    attributes: ['id', 'barcode'],
    include: [{
      model: MasterProductVariant,
      as: 'variants',
      required: false,
      attributes: ['id'],
      include: [{
        model: MasterVariantBarcode,
        as: 'barcodes',
        required: false,
        attributes: ['barcode'],
      }],
    }],
  });
  const codes = [];
  for (const row of rows) {
    const fromVariants = (row.variants || []).flatMap((variant) =>
      (variant.barcodes || []).map((item) => String(item.barcode || '').replace(/\D/g, '')),
    );
    const own = String(row.barcode || '').replace(/\D/g, '');
    const code = [own, ...fromVariants].find((item) => /^\d{4,18}$/.test(item));
    if (code && !codes.includes(code)) codes.push(code);
    if (codes.length >= limit) break;
  }
  return codes;
}

module.exports = {
  listBusinessTypes,
  getBusinessType,
  createBusinessType,
  updateBusinessType,
  deleteBusinessType,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listBrands,
  createBrand,
  updateBrand,
  deleteBrand,
  listMasterProducts,
  createMasterProduct,
  updateMasterProduct,
  deleteMasterProduct,
  bulkImportMasterProducts,
  bulkImportMasterCategories,
  bulkImportMasterBrands,
  upsertImportedMasterProduct,
  ensureTenantProductInMaster,
  latestSavedMasterBarcodes,
};
