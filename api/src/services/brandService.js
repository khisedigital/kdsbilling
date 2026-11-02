const { Op } = require('sequelize');
const AppError = require('../utils/AppError');

async function listBrands(db, query) {
  const { Brand } = db;
  const where = { deleted_at: null };
  if (query.status) where.status = query.status;
  if (query.search) where.name = { [Op.like]: `%${query.search}%` };

  return Brand.findAll({ where, order: [['name', 'ASC']] });
}

async function createBrand(db, data) {
  const { Brand } = db;
  if (!data.name?.trim()) throw new AppError('Brand name is required', 400, 'VALIDATION_ERROR');
  return Brand.create({
    name: data.name.trim(),
    description: data.description || null,
    status: data.status || 'active',
  });
}

async function updateBrand(db, id, data) {
  const { Brand } = db;
  const brand = await Brand.findOne({ where: { id, deleted_at: null } });
  if (!brand) throw new AppError('Brand not found', 404, 'NOT_FOUND');

  await brand.update({
    name: data.name?.trim() ?? brand.name,
    description: data.description !== undefined ? data.description : brand.description,
    status: data.status ?? brand.status,
  });
  return brand;
}

async function deleteBrand(db, id) {
  const { Brand, Product } = db;
  const brand = await Brand.findOne({ where: { id, deleted_at: null } });
  if (!brand) throw new AppError('Brand not found', 404, 'NOT_FOUND');

  const productCount = await Product.count({ where: { brand_id: id, deleted_at: null } });
  if (productCount > 0) {
    throw new AppError('Brand has products. Reassign them first.', 400, 'BRAND_IN_USE');
  }

  await brand.update({ deleted_at: new Date(), status: 'inactive' });
  return { deleted: true };
}

module.exports = {
  listBrands,
  createBrand,
  updateBrand,
  deleteBrand,
};
