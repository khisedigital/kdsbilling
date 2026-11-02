const express = require('express');
const platformAuth = require('../middleware/platformAuth');
const asyncHandler = require('../utils/asyncHandler');
const platform = require('../controllers/platformController');

const router = express.Router();

// Public login (body credentials — avoids header encoding issues)
router.post('/auth/login', asyncHandler(platform.login));

router.use(platformAuth);

router.post('/auth/verify', asyncHandler(platform.verifyAuth));
router.get('/dashboard', asyncHandler(platform.dashboard));

router.get('/plans', asyncHandler(platform.listPlans));
router.post('/plans', asyncHandler(platform.createPlan));
router.get('/plans/:id', asyncHandler(platform.getPlan));
router.patch('/plans/:id', asyncHandler(platform.updatePlan));
router.delete('/plans/:id', asyncHandler(platform.deletePlan));

router.get('/units', asyncHandler(platform.listUnits));
router.post('/units', asyncHandler(platform.createUnit));
router.patch('/units/:unitId', asyncHandler(platform.updateUnit));
router.delete('/units/:unitId', asyncHandler(platform.deleteUnit));
router.post('/units/sync-tenants', asyncHandler(platform.syncUnitsToTenants));

router.get('/business-types', asyncHandler(platform.listBusinessTypes));
router.post('/business-types', asyncHandler(platform.createBusinessType));
router.patch('/business-types/:id', asyncHandler(platform.updateBusinessType));
router.delete('/business-types/:id', asyncHandler(platform.deleteBusinessType));

router.get('/master-categories', asyncHandler(platform.listMasterCategories));
router.post('/master-categories', asyncHandler(platform.createMasterCategory));
router.patch('/master-categories/:id', asyncHandler(platform.updateMasterCategory));
router.delete('/master-categories/:id', asyncHandler(platform.deleteMasterCategory));

router.get('/master-brands', asyncHandler(platform.listMasterBrands));
router.post('/master-brands', asyncHandler(platform.createMasterBrand));
router.patch('/master-brands/:id', asyncHandler(platform.updateMasterBrand));
router.delete('/master-brands/:id', asyncHandler(platform.deleteMasterBrand));

router.get('/master-products', asyncHandler(platform.listMasterProducts));
router.post('/master-products', asyncHandler(platform.createMasterProduct));
router.post('/master-products/import', asyncHandler(platform.importMasterProducts));
router.patch('/master-products/:id', asyncHandler(platform.updateMasterProduct));
router.delete('/master-products/:id', asyncHandler(platform.deleteMasterProduct));

router.get('/shopify/connections', asyncHandler(platform.listShopifyConnections));

router.get('/tenants', asyncHandler(platform.listTenants));
router.post('/tenants', asyncHandler(platform.createTenant));
router.get('/tenants/:id', asyncHandler(platform.getTenant));
router.patch('/tenants/:id', asyncHandler(platform.updateTenant));
router.post('/tenants/:id/reset-owner-password', asyncHandler(platform.resetTenantOwnerPassword));
router.get('/tenants/:id/catalog-meta', asyncHandler(platform.getCatalogMeta));
router.post('/tenants/:id/categories', asyncHandler(platform.createCategory));
router.post('/tenants/:id/brands', asyncHandler(platform.createBrand));
router.get('/tenants/:id/products', asyncHandler(platform.listProducts));
router.post('/tenants/:id/products', asyncHandler(platform.createProduct));
router.post('/tenants/:id/products/import', asyncHandler(platform.importProducts));
router.get('/tenants/:id/master-catalog/business-types', asyncHandler(platform.listTenantMasterCatalogBusinessTypes));
router.get('/tenants/:id/master-catalog/categories', asyncHandler(platform.listTenantMasterCatalogCategories));
router.get('/tenants/:id/master-catalog/products', asyncHandler(platform.listTenantMasterCatalog));
router.post('/tenants/:id/products/import-from-master', asyncHandler(platform.importProductsFromMaster));
router.patch('/tenants/:id/products/:productId', asyncHandler(platform.updateProduct));
router.delete('/tenants/:id/products/:productId', asyncHandler(platform.deleteProduct));

module.exports = router;
