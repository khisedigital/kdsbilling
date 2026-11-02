const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const AppError = require('../utils/AppError');
const config = require('../config');

function ensureUploadDir(tenantSlug) {
  const dir = path.join(config.uploadPath, tenantSlug, 'products');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function addProductImage(db, tenant, productId, file, variantId = null) {
  const { Product, ProductImage } = db;
  const product = await Product.findOne({ where: { id: productId, deleted_at: null } });
  if (!product) throw new AppError('Product not found', 404, 'NOT_FOUND');

  const dir = ensureUploadDir(tenant.slug);
  const ext = path.extname(file.originalname) || '.jpg';
  const fileName = `${uuidv4()}${ext}`;
  const destPath = path.join(dir, fileName);

  fs.writeFileSync(destPath, file.buffer);

  const relativePath = path.join(tenant.slug, 'products', fileName);
  const image = await ProductImage.create({
    product_id: productId,
    variant_id: variantId,
    file_name: file.originalname,
    file_path: relativePath,
    mime_type: file.mimetype,
    is_primary: false,
    sort_order: 0,
  });

  return {
    ...image.toJSON(),
    url: `/uploads/${relativePath.replace(/\\/g, '/')}`,
  };
}

async function deleteProductImage(db, imageId) {
  const { ProductImage } = db;
  const image = await ProductImage.findByPk(imageId);
  if (!image) throw new AppError('Image not found', 404, 'NOT_FOUND');

  const fullPath = path.join(config.uploadPath, image.file_path);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

  await image.destroy();
  return { deleted: true };
}

module.exports = { addProductImage, deleteProductImage };
