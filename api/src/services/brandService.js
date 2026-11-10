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

/**
 * Bulk create brands from rows [{ name, description? }].
 * Skips names that already exist (unique constraint).
 */
async function bulkImportBrands(db, rows) {
  if (!Array.isArray(rows) || !rows.length) {
    throw new AppError('Import rows array is required', 400, 'VALIDATION_ERROR');
  }
  if (rows.length > 500) {
    throw new AppError('Import at most 500 brands at a time', 400, 'VALIDATION_ERROR');
  }

  const { Brand } = db;
  const results = { success: 0, skipped: 0, failed: 0, errors: [] };
  const seen = new Set();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || {};
    const name = String(row.name || '').trim();
    if (!name) {
      results.failed += 1;
      results.errors.push({ row: i + 1, message: 'Name is required' });
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      results.skipped += 1;
      continue;
    }
    seen.add(key);

    try {
      const existing = await Brand.findOne({
        where: { deleted_at: null, name },
      });
      if (existing) {
        results.skipped += 1;
        continue;
      }
      await Brand.create({
        name,
        description: row.description ? String(row.description).trim() : null,
        status: 'active',
      });
      results.success += 1;
    } catch (err) {
      if (err.name === 'SequelizeUniqueConstraintError') {
        results.skipped += 1;
        continue;
      }
      results.failed += 1;
      results.errors.push({ row: i + 1, message: err.message || 'Could not create brand' });
    }
  }

  return results;
}

module.exports = {
  listBrands,
  createBrand,
  updateBrand,
  deleteBrand,
  bulkImportBrands,
};
