const categoryService = require('../services/categoryService');
const brandService = require('../services/brandService');
const productService = require('../services/productService');
const imageService = require('../services/imageService');

// Categories
async function listCategories(req, res) {
  const data = await categoryService.listCategories(req.db, req.query);
  res.json({ success: true, data });
}

async function createCategory(req, res) {
  const data = await categoryService.createCategory(req.db, req.body);
  res.status(201).json({ success: true, data });
}

async function updateCategory(req, res) {
  const data = await categoryService.updateCategory(req.db, req.params.id, req.body);
  res.json({ success: true, data });
}

async function deleteCategory(req, res) {
  const data = await categoryService.deleteCategory(req.db, req.params.id);
  res.json({ success: true, data });
}

// Brands
async function listBrands(req, res) {
  const data = await brandService.listBrands(req.db, req.query);
  res.json({ success: true, data });
}

async function createBrand(req, res) {
  const data = await brandService.createBrand(req.db, req.body);
  res.status(201).json({ success: true, data });
}

async function updateBrand(req, res) {
  const data = await brandService.updateBrand(req.db, req.params.id, req.body);
  res.json({ success: true, data });
}

async function deleteBrand(req, res) {
  const data = await brandService.deleteBrand(req.db, req.params.id);
  res.json({ success: true, data });
}

// Products
async function listProducts(req, res) {
  const branchId = req.auth.branchId;
  const data = await productService.listProducts(req.db, req.query, branchId);
  res.json({ success: true, data });
}

async function getProduct(req, res) {
  const branchId = req.auth.branchId;
  const data = await productService.getProduct(req.db, req.params.id, branchId);
  res.json({ success: true, data });
}

async function createProduct(req, res) {
  const data = await productService.createProduct(req.db, req.body, {
    branchId: req.auth?.branchId,
    userId: req.auth?.sub,
  });
  res.status(201).json({ success: true, data });
}

async function updateProduct(req, res) {
  const data = await productService.updateProduct(req.db, req.params.id, req.body, {
    branchId: req.auth?.branchId,
    userId: req.auth?.sub,
  });
  res.json({ success: true, data });
}

async function deleteProduct(req, res) {
  const data = await productService.deleteProduct(req.db, req.params.id);
  res.json({ success: true, data });
}

async function searchProducts(req, res) {
  const branchId = req.auth.branchId;
  const data = await productService.searchProducts(req.db, req.query, branchId);
  res.json({ success: true, data });
}

async function generateBarcodes(req, res) {
  const data = await productService.generateBarcodes(req.db, req.body?.variantIds);
  res.json({ success: true, data });
}

async function quantityBarcodes(req, res) {
  const data = await productService.ensureQuantityBarcodes(req.db, req.body?.items);
  res.json({ success: true, data });
}

async function bulkImport(req, res) {
  const data = await productService.bulkImport(req.db, req.body.rows);
  res.json({ success: true, data });
}

async function listTaxGroups(req, res) {
  const data = await productService.listTaxGroups(req.db);
  res.json({ success: true, data });
}

async function listUnits(req, res) {
  const data = await productService.listUnits(req.db);
  res.json({ success: true, data });
}

async function uploadImage(req, res) {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Image file is required' },
    });
  }
  const data = await imageService.addProductImage(
    req.db,
    req.tenant,
    req.params.id,
    req.file,
    req.body.variantId || null
  );
  res.status(201).json({ success: true, data });
}

async function deleteImage(req, res) {
  const data = await imageService.deleteProductImage(req.db, req.params.imageId);
  res.json({ success: true, data });
}

async function listMasterCatalog(req, res) {
  const masterCatalogImportService = require('../services/masterCatalogImportService');
  const data = await masterCatalogImportService.listMasterCatalogForTenant(req.tenant, req.query);
  res.json({ success: true, data });
}

async function listMasterCatalogCategories(req, res) {
  const masterCatalogImportService = require('../services/masterCatalogImportService');
  const data = await masterCatalogImportService.listMasterCategoriesForTenant(req.tenant, req.query);
  res.json({ success: true, data });
}

async function listMasterCatalogBusinessTypes(req, res) {
  const masterCatalogImportService = require('../services/masterCatalogImportService');
  const data = await masterCatalogImportService.listImportableBusinessTypes(req.tenant);
  res.json({ success: true, data });
}

async function importFromMasterCatalog(req, res) {
  const masterCatalogImportService = require('../services/masterCatalogImportService');
  const data = await masterCatalogImportService.importMasterProductsToTenant(
    req.db,
    req.tenant,
    {
      masterProductIds: req.body.masterProductIds || req.body.ids || [],
      branchId: req.body.branchId || req.auth?.branchId || null,
    },
    { branchId: req.auth?.branchId, userId: req.auth?.sub },
  );
  res.status(201).json({ success: true, data });
}

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listBrands,
  createBrand,
  updateBrand,
  deleteBrand,
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  searchProducts,
  generateBarcodes,
  quantityBarcodes,
  bulkImport,
  listTaxGroups,
  listUnits,
  uploadImage,
  deleteImage,
  listMasterCatalog,
  listMasterCatalogCategories,
  listMasterCatalogBusinessTypes,
  importFromMasterCatalog,
};
