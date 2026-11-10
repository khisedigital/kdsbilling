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
  const inUse = await MasterProduct.count({ where: { category_id: id } });
  if (inUse > 0) throw new AppError('Category has master products', 400, 'VALIDATION_ERROR');
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
  const inUse = await MasterProduct.count({ where: { brand_id: id } });
  if (inUse > 0) throw new AppError('Brand has master products', 400, 'VALIDATION_ERROR');
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
    order: [['sort_order', 'ASC'], ['name', 'ASC']],
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

async function resolveBusinessTypeForImport(defaultBusinessTypeId, row) {
  const { BusinessType } = getMasterModels();
  const codeOrName = row.businessTypeCode || row.businessType;
  if (codeOrName) {
    const normalized = String(codeOrName).trim().toLowerCase();
    const bt = await BusinessType.findOne({
      where: {
        [Op.or]: [
          { code: normalized },
          { name: { [Op.like]: codeOrName } },
        ],
      },
    });
    if (!bt) throw new AppError(`Business type not found: ${codeOrName}`, 400, 'VALIDATION_ERROR');
    return bt.id;
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
  if (!created && cleanedMr && !cat.name_mr) {
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
  if (!created && cleanedMr && !brand.name_mr) {
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
        if (nameMr && !existing.name_mr) await existing.update({ name_mr: nameMr });
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
        if (nameMr && !existing.name_mr) await existing.update({ name_mr: nameMr });
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
  const { MasterProduct } = getMasterModels();
  if (!Array.isArray(rows) || !rows.length) {
    throw new AppError('Import rows array is required', 400, 'VALIDATION_ERROR');
  }

  const createCategories = options.createCategories !== false;
  const createBrands = options.createBrands !== false;
  const skipDuplicates = options.skipDuplicates !== false;
  const results = { success: 0, failed: 0, skipped: 0, categoriesCreated: 0, brandsCreated: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      if (!row.name?.trim()) throw new AppError('Product name is required', 400, 'VALIDATION_ERROR');

      const resolvedBusinessTypeId = await resolveBusinessTypeForImport(businessTypeId, row);
      const sellingPriceRaw = row.sellingPrice ?? row.selling_price;
      const sellingPrice =
        sellingPriceRaw === undefined || sellingPriceRaw === null || sellingPriceRaw === ''
          ? 0
          : Number(sellingPriceRaw);

      let categoryId = null;
      if (row.category) {
        const categoryMr = row.categoryNameMr ?? row.category_name_mr ?? row.categoryMr;
        if (!createCategories) {
          const { MasterCategory } = getMasterModels();
          const cat = await MasterCategory.findOne({
            where: { business_type_id: resolvedBusinessTypeId, name: String(row.category).trim() },
          });
          if (!cat) throw new AppError(`Category not found: ${row.category}`, 400, 'VALIDATION_ERROR');
          categoryId = cat.id;
        } else {
          categoryId = await findOrCreateMasterCategory(
            resolvedBusinessTypeId,
            row.category,
            results,
            categoryMr,
          );
        }
      }

      let brandId = null;
      if (row.brand) {
        const brandMr = row.brandNameMr ?? row.brand_name_mr ?? row.brandMr;
        if (!createBrands) {
          const { MasterBrand } = getMasterModels();
          const brand = await MasterBrand.findOne({
            where: { business_type_id: resolvedBusinessTypeId, name: String(row.brand).trim() },
          });
          if (!brand) throw new AppError(`Brand not found: ${row.brand}`, 400, 'VALIDATION_ERROR');
          brandId = brand.id;
        } else {
          brandId = await findOrCreateMasterBrand(resolvedBusinessTypeId, row.brand, results, brandMr);
        }
      }

      const sku = row.sku ? String(row.sku).trim() : null;
      if (sku && skipDuplicates) {
        const existing = await MasterProduct.findOne({
          where: { business_type_id: resolvedBusinessTypeId, sku },
        });
        if (existing) {
          results.skipped += 1;
          continue;
        }
      }

      await createMasterProduct({
        businessTypeId: resolvedBusinessTypeId,
        categoryId,
        brandId,
        name: row.name.trim(),
        nameMr: row.nameMr ?? row.name_mr,
        description: row.description || null,
        uomCode: (row.uomCode || row.uom || 'pcs').trim().toLowerCase(),
        sellingPrice: Number(sellingPrice),
        costPrice: row.costPrice ?? row.cost_price ?? 0,
        mrp: row.mrp ?? null,
        sku,
        barcode: row.barcode || null,
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
  latestSavedMasterBarcodes,
};
