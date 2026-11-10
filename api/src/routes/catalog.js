const express = require('express');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../constants/permissions');
const asyncHandler = require('../utils/asyncHandler');
const upload = require('../middleware/upload');
const catalog = require('../controllers/catalogController');

const router = express.Router();

router.use(authMiddleware);

// Lookups
router.get('/units', asyncHandler(catalog.listUnits));
router.get('/tax-groups', asyncHandler(catalog.listTaxGroups));

// Categories
router.get('/categories', requirePermission(PERMISSIONS.PRODUCT_VIEW), asyncHandler(catalog.listCategories));
router.post('/categories/bulk-import', requirePermission(PERMISSIONS.PRODUCT_CREATE), asyncHandler(catalog.bulkImportCategories));
router.post('/categories', requirePermission(PERMISSIONS.PRODUCT_CREATE), asyncHandler(catalog.createCategory));
router.put('/categories/:id', requirePermission(PERMISSIONS.PRODUCT_EDIT), asyncHandler(catalog.updateCategory));
router.delete('/categories/:id', requirePermission(PERMISSIONS.PRODUCT_DELETE), asyncHandler(catalog.deleteCategory));

// Brands
router.get('/brands', requirePermission(PERMISSIONS.PRODUCT_VIEW), asyncHandler(catalog.listBrands));
router.post('/brands/bulk-import', requirePermission(PERMISSIONS.PRODUCT_CREATE), asyncHandler(catalog.bulkImportBrands));
router.post('/brands', requirePermission(PERMISSIONS.PRODUCT_CREATE), asyncHandler(catalog.createBrand));
router.put('/brands/:id', requirePermission(PERMISSIONS.PRODUCT_EDIT), asyncHandler(catalog.updateBrand));
router.delete('/brands/:id', requirePermission(PERMISSIONS.PRODUCT_DELETE), asyncHandler(catalog.deleteBrand));

// Products
router.get('/products/search', requirePermission(PERMISSIONS.PRODUCT_VIEW), asyncHandler(catalog.searchProducts));
router.post('/products/barcodes/generate', requirePermission(PERMISSIONS.PRODUCT_EDIT), asyncHandler(catalog.generateBarcodes));
router.post('/products/barcodes/quantity', requirePermission(PERMISSIONS.PRODUCT_EDIT), asyncHandler(catalog.quantityBarcodes));
router.post('/products/bulk-import', requirePermission(PERMISSIONS.PRODUCT_CREATE), asyncHandler(catalog.bulkImport));
router.get('/master-catalog/business-types', requirePermission(PERMISSIONS.PRODUCT_VIEW), asyncHandler(catalog.listMasterCatalogBusinessTypes));
router.get('/master-catalog/categories', requirePermission(PERMISSIONS.PRODUCT_VIEW), asyncHandler(catalog.listMasterCatalogCategories));
router.get('/master-catalog/products', requirePermission(PERMISSIONS.PRODUCT_VIEW), asyncHandler(catalog.listMasterCatalog));
router.post('/products/import-from-master', requirePermission(PERMISSIONS.PRODUCT_CREATE), asyncHandler(catalog.importFromMasterCatalog));
router.get('/products/open-food-facts', requirePermission(PERMISSIONS.PRODUCT_VIEW), asyncHandler(catalog.searchOpenFoodFacts));
router.post('/products/import-from-open-food', requirePermission(PERMISSIONS.PRODUCT_CREATE), asyncHandler(catalog.importOpenFoodFacts));
router.get('/products', requirePermission(PERMISSIONS.PRODUCT_VIEW), asyncHandler(catalog.listProducts));
// Must stay above any `/products/:id` route so "price-bulk" is never treated as an id.
router.post('/products/price-bulk', requirePermission(PERMISSIONS.PRODUCT_EDIT), asyncHandler(catalog.bulkUpdateVariantPricing));
router.post('/products/delete-all', requirePermission(PERMISSIONS.PRODUCT_DELETE), asyncHandler(catalog.deleteAllProducts));
router.post('/products', requirePermission(PERMISSIONS.PRODUCT_CREATE), asyncHandler(catalog.createProduct));
router.get('/products/:id/barcode-status', requirePermission(PERMISSIONS.PRODUCT_VIEW), asyncHandler(catalog.productBarcodeStatus));
router.get('/products/:id', requirePermission(PERMISSIONS.PRODUCT_VIEW), asyncHandler(catalog.getProduct));
router.put('/products/:id', requirePermission(PERMISSIONS.PRODUCT_EDIT), asyncHandler(catalog.updateProduct));
router.delete('/products/:id', requirePermission(PERMISSIONS.PRODUCT_DELETE), asyncHandler(catalog.deleteProduct));

// Images
router.post(
  '/products/:id/images',
  requirePermission(PERMISSIONS.PRODUCT_EDIT),
  upload.single('image'),
  asyncHandler(catalog.uploadImage)
);
router.delete(
  '/products/:id/images/:imageId',
  requirePermission(PERMISSIONS.PRODUCT_DELETE),
  asyncHandler(catalog.deleteImage)
);

module.exports = router;
