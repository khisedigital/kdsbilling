const platformService = require('../services/platformService');
const planService = require('../services/planService');
const config = require('../config');
const AppError = require('../utils/AppError');
const shopifyMonitoring = require('../services/shopify/monitoringService');
const { isValidAdminUsername, isValidAdminPassword } = require('../middleware/platformAuth');

async function login(req, res) {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    throw new AppError('Username and password are required', 400, 'VALIDATION_ERROR');
  }

  if (!isValidAdminUsername(username) || !isValidAdminPassword(password)) {
    throw new AppError(
      'Invalid username or password. Username can be PLATFORM_ADMIN_EMAIL (or the part before @). Password is PLATFORM_ADMIN_PASSWORD from the server api/.env.',
      401,
      'UNAUTHORIZED'
    );
  }

  res.json({
    success: true,
    data: {
      email: config.platform.adminEmail,
      username,
      statuses: platformService.STATUSES,
    },
  });
}

async function verifyAuth(req, res) {
  res.json({
    success: true,
    data: {
      email: config.platform.adminEmail,
      statuses: platformService.STATUSES,
    },
  });
}

async function dashboard(req, res) {
  const data = await platformService.getDashboard();
  res.json({ success: true, data });
}

async function listPlans(req, res) {
  const data = await planService.listPlans(req.query);
  res.json({ success: true, data });
}

async function getPlan(req, res) {
  const data = await planService.getPlan(req.params.id);
  res.json({ success: true, data });
}

async function createPlan(req, res) {
  const data = await planService.createPlan(req.body);
  res.status(201).json({ success: true, data });
}

async function updatePlan(req, res) {
  const data = await planService.updatePlan(req.params.id, req.body);
  res.json({ success: true, data });
}

async function deletePlan(req, res) {
  const data = await planService.deletePlan(req.params.id);
  res.json({ success: true, data });
}

async function listShopifyConnections(req, res) {
  const data = await shopifyMonitoring.listShopifyConnections(req.query);
  res.json({ success: true, data });
}

async function listTenants(req, res) {
  const data = await platformService.listTenants(req.query);
  res.json({ success: true, data });
}

async function getTenant(req, res) {
  const data = await platformService.getTenant(req.params.id);
  res.json({ success: true, data });
}

async function createTenant(req, res) {
  const {
    name,
    slug,
    ownerName,
    ownerMobile,
    ownerEmail,
    ownerPassword,
    countryCode,
    currencyCode,
    planId,
    subscriptionYears,
    businessTypeId,
    billingEmail,
    notes,
    address,
    city,
  } = req.body;

  if (!name || !slug || !ownerName || !ownerPassword || !planId) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Missing required fields (including planId)' },
    });
  }

  if (!ownerMobile && !ownerEmail) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Owner mobile number or email is required' },
    });
  }

  const data = await platformService.createTenant({
    name,
    slug,
    ownerName,
    ownerMobile,
    ownerEmail,
    ownerPassword,
    countryCode,
    currencyCode,
    planId,
    subscriptionYears,
    businessTypeId,
    billingEmail,
    notes,
    address,
    city,
  });

  res.status(201).json({ success: true, data });
}

async function updateTenant(req, res) {
  const data = await platformService.updateTenant(req.params.id, req.body);
  res.json({ success: true, data });
}

async function resetTenantOwnerPassword(req, res) {
  const data = await platformService.resetTenantOwnerPassword(req.params.id);
  res.json({ success: true, data });
}

async function getCatalogMeta(req, res) {
  const data = await platformService.getTenantCatalogMeta(req.params.id);
  res.json({ success: true, data });
}

async function createCategory(req, res) {
  const data = await platformService.createTenantCategory(req.params.id, req.body);
  res.status(201).json({ success: true, data });
}

async function createBrand(req, res) {
  const data = await platformService.createTenantBrand(req.params.id, req.body);
  res.status(201).json({ success: true, data });
}

async function listProducts(req, res) {
  const data = await platformService.listTenantProducts(req.params.id, req.query);
  res.json({ success: true, data });
}

async function createProduct(req, res) {
  const data = await platformService.createTenantProduct(req.params.id, req.body);
  res.status(201).json({ success: true, data });
}

async function importProducts(req, res) {
  const rows = Array.isArray(req.body) ? req.body : req.body?.rows;
  const data = await platformService.importTenantProducts(req.params.id, rows);
  res.json({ success: true, data });
}

async function listTenantMasterCatalog(req, res) {
  const data = await platformService.listTenantMasterCatalog(req.params.id, req.query);
  res.json({ success: true, data });
}

async function listTenantMasterCatalogCategories(req, res) {
  const data = await platformService.listTenantMasterCatalogCategories(req.params.id, req.query);
  res.json({ success: true, data });
}

async function listTenantMasterCatalogBusinessTypes(req, res) {
  const data = await platformService.listTenantMasterCatalogBusinessTypes(req.params.id);
  res.json({ success: true, data });
}

async function importProductsFromMaster(req, res) {
  const data = await platformService.importTenantProductsFromMaster(req.params.id, req.body || {});
  res.status(201).json({ success: true, data });
}

async function updateProduct(req, res) {
  const data = await platformService.updateTenantProduct(req.params.id, req.params.productId, req.body);
  res.json({ success: true, data });
}

async function deleteProduct(req, res) {
  const data = await platformService.deleteTenantProduct(req.params.id, req.params.productId);
  res.json({ success: true, data });
}

async function listUnits(req, res) {
  const data = await platformService.listMasterUnits(req.query);
  res.json({ success: true, data });
}

async function createUnit(req, res) {
  const data = await platformService.createMasterUnit(req.body);
  res.status(201).json({ success: true, data });
}

async function updateUnit(req, res) {
  const data = await platformService.updateMasterUnit(req.params.unitId, req.body);
  res.json({ success: true, data });
}

async function deleteUnit(req, res) {
  const data = await platformService.deleteMasterUnit(req.params.unitId);
  res.json({ success: true, data });
}

async function syncUnitsToTenants(req, res) {
  const data = await platformService.syncMasterUnitsToAllTenants();
  res.json({ success: true, data });
}

async function listBusinessTypes(req, res) {
  const data = await platformService.listBusinessTypes(req.query);
  res.json({ success: true, data });
}

async function createBusinessType(req, res) {
  const data = await platformService.createBusinessType(req.body);
  res.status(201).json({ success: true, data });
}

async function updateBusinessType(req, res) {
  const data = await platformService.updateBusinessType(req.params.id, req.body);
  res.json({ success: true, data });
}

async function deleteBusinessType(req, res) {
  const data = await platformService.deleteBusinessType(req.params.id);
  res.json({ success: true, data });
}

async function listMasterCategories(req, res) {
  const data = await platformService.listMasterCategories(req.query);
  res.json({ success: true, data });
}

async function createMasterCategory(req, res) {
  const data = await platformService.createMasterCategory(req.body);
  res.status(201).json({ success: true, data });
}

async function updateMasterCategory(req, res) {
  const data = await platformService.updateMasterCategory(req.params.id, req.body);
  res.json({ success: true, data });
}

async function deleteMasterCategory(req, res) {
  const data = await platformService.deleteMasterCategory(req.params.id);
  res.json({ success: true, data });
}

async function listMasterBrands(req, res) {
  const data = await platformService.listMasterBrands(req.query);
  res.json({ success: true, data });
}

async function createMasterBrand(req, res) {
  const data = await platformService.createMasterBrand(req.body);
  res.status(201).json({ success: true, data });
}

async function updateMasterBrand(req, res) {
  const data = await platformService.updateMasterBrand(req.params.id, req.body);
  res.json({ success: true, data });
}

async function deleteMasterBrand(req, res) {
  const data = await platformService.deleteMasterBrand(req.params.id);
  res.json({ success: true, data });
}

async function listMasterProducts(req, res) {
  const data = await platformService.listMasterProducts(req.query);
  res.json({ success: true, data });
}

async function latestSavedMasterBarcodes(req, res) {
  const data = await platformService.latestSavedMasterBarcodes(req.query.businessTypeId);
  res.json({ success: true, data });
}

async function createMasterProduct(req, res) {
  const data = await platformService.createMasterProduct(req.body);
  res.status(201).json({ success: true, data });
}

async function updateMasterProduct(req, res) {
  const data = await platformService.updateMasterProduct(req.params.id, req.body);
  res.json({ success: true, data });
}

async function deleteMasterProduct(req, res) {
  const data = await platformService.deleteMasterProduct(req.params.id);
  res.json({ success: true, data });
}

async function importMasterProducts(req, res) {
  const rows = Array.isArray(req.body) ? req.body : req.body?.rows;
  const data = await platformService.importMasterProducts({
    businessTypeId: req.body?.businessTypeId,
    rows,
    options: req.body?.options,
  });
  res.json({ success: true, data });
}

async function importMasterCategories(req, res) {
  const rows = Array.isArray(req.body) ? req.body : req.body?.rows;
  const data = await platformService.importMasterCategories({
    businessTypeId: req.body?.businessTypeId,
    rows,
  });
  res.json({ success: true, data });
}

async function importMasterBrands(req, res) {
  const rows = Array.isArray(req.body) ? req.body : req.body?.rows;
  const data = await platformService.importMasterBrands({
    businessTypeId: req.body?.businessTypeId,
    rows,
  });
  res.json({ success: true, data });
}

async function searchOpenFoodFacts(req, res) {
  const data = await platformService.searchOpenFoodFacts(req.query);
  res.json({ success: true, data });
}

async function importOpenFoodMaster(req, res) {
  const data = await platformService.importOpenFoodToMaster(req.body?.businessTypeId, req.body);
  res.json({ success: true, data });
}

module.exports = {
  login,
  verifyAuth,
  dashboard,
  listPlans,
  getPlan,
  createPlan,
  updatePlan,
  deletePlan,
  listShopifyConnections,
  listTenants,
  getTenant,
  createTenant,
  updateTenant,
  resetTenantOwnerPassword,
  getCatalogMeta,
  createCategory,
  createBrand,
  listProducts,
  createProduct,
  importProducts,
  listTenantMasterCatalog,
  listTenantMasterCatalogCategories,
  listTenantMasterCatalogBusinessTypes,
  importProductsFromMaster,
  updateProduct,
  deleteProduct,
  listUnits,
  createUnit,
  updateUnit,
  deleteUnit,
  syncUnitsToTenants,
  listBusinessTypes,
  createBusinessType,
  updateBusinessType,
  deleteBusinessType,
  listMasterCategories,
  createMasterCategory,
  updateMasterCategory,
  deleteMasterCategory,
  listMasterBrands,
  createMasterBrand,
  updateMasterBrand,
  deleteMasterBrand,
  listMasterProducts,
  latestSavedMasterBarcodes,
  createMasterProduct,
  updateMasterProduct,
  deleteMasterProduct,
  importMasterProducts,
  importMasterCategories,
  importMasterBrands,
  searchOpenFoodFacts,
  importOpenFoodMaster,
};
