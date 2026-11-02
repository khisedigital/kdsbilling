const { Op } = require('sequelize');
const AppError = require('../utils/AppError');

async function listCategories(db, query) {
  const { Category } = db;
  const where = { deleted_at: null };
  if (query.status) where.status = query.status;
  if (query.search) where.name = { [Op.like]: `%${query.search}%` };

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
    parent_id: data.parentId || null,
    description: data.description || null,
    status: data.status || 'active',
  });
}

async function updateCategory(db, id, data) {
  const { Category } = db;
  const category = await Category.findOne({ where: { id, deleted_at: null } });
  if (!category) throw new AppError('Category not found', 404, 'NOT_FOUND');

  await category.update({
    name: data.name?.trim() ?? category.name,
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

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
