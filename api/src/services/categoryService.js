const { Op } = require('sequelize');
const AppError = require('../utils/AppError');

function cleanNameMr(value) {
  if (value === undefined) return undefined;
  const name = String(value || '').trim();
  if (name.length > 150) throw new AppError('Marathi name is too long', 400, 'VALIDATION_ERROR');
  return name || null;
}

function requireNameMr(value) {
  const name = cleanNameMr(value === undefined ? '' : value);
  if (!name) throw new AppError('Marathi name is required', 400, 'VALIDATION_ERROR');
  return name;
}

async function listCategories(db, query) {
  const { Category } = db;
  const where = { deleted_at: null };
  if (query.status) where.status = query.status;
  if (query.search) {
    const like = { [Op.like]: `%${query.search}%` };
    where[Op.or] = [{ name: like }, { name_mr: like }];
  }

  const categories = await Category.findAll({
    where,
    include: [{ model: Category, as: 'parent', attributes: ['id', 'name'] }],
    order: [['name', 'ASC']],
  });

  return categories;
}

async function createCategory(db, data) {
  const { Category } = db;
  if (!data.name?.trim()) throw new AppError('Category name is required', 400, 'VALIDATION_ERROR');
  return Category.create({
    name: data.name.trim(),
    name_mr: requireNameMr(data.nameMr),
    parent_id: data.parentId || null,
    description: data.description || null,
    status: data.status || 'active',
  });
}

async function updateCategory(db, id, data) {
  const { Category } = db;
  const category = await Category.findOne({ where: { id, deleted_at: null } });
  if (!category) throw new AppError('Category not found', 404, 'NOT_FOUND');

  const nameMr = data.nameMr !== undefined ? requireNameMr(data.nameMr) : undefined;
  await category.update({
    name: data.name?.trim() ?? category.name,
    ...(nameMr !== undefined ? { name_mr: nameMr } : {}),
    parent_id: data.parentId !== undefined ? data.parentId : category.parent_id,
    description: data.description !== undefined ? data.description : category.description,
    status: data.status ?? category.status,
  });
  return category;
}

async function deleteCategory(db, id) {
  const { Category, Product } = db;
  const category = await Category.findOne({ where: { id, deleted_at: null } });
  if (!category) throw new AppError('Category not found', 404, 'NOT_FOUND');

  const productCount = await Product.count({ where: { category_id: id, deleted_at: null } });
  if (productCount > 0) {
    throw new AppError('Category has products. Reassign them first.', 400, 'CATEGORY_IN_USE');
  }

  await category.update({ deleted_at: new Date(), status: 'inactive' });
  return { deleted: true };
}

/**
 * Bulk create categories from rows [{ name, description? }].
 * Skips names that already exist (case-insensitive).
 */
async function bulkImportCategories(db, rows) {
  if (!Array.isArray(rows) || !rows.length) {
    throw new AppError('Import rows array is required', 400, 'VALIDATION_ERROR');
  }
  if (rows.length > 500) {
    throw new AppError('Import at most 500 categories at a time', 400, 'VALIDATION_ERROR');
  }

  const { Category } = db;
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
      const existing = await Category.findOne({
        where: { deleted_at: null, name: { [Op.like]: name } },
      });
      // MySQL LIKE is case-insensitive with default collation; still guard exact match.
      if (existing && String(existing.name).trim().toLowerCase() === key) {
        results.skipped += 1;
        continue;
      }
      await Category.create({
        name,
        name_mr: cleanNameMr(row.nameMr ?? row.name_mr),
        description: row.description ? String(row.description).trim() : null,
        status: 'active',
      });
      results.success += 1;
    } catch (err) {
      results.failed += 1;
      results.errors.push({ row: i + 1, message: err.message || 'Could not create category' });
    }
  }

  return results;
}

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  bulkImportCategories,
};
