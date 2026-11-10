const { Op } = require('sequelize');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const AppError = require('../utils/AppError');
const { getMasterModels } = require('../models/master');
const tenantConnectionManager = require('../config/tenantConnectionManager');
const { provisionTenant } = require('./tenantProvisioner');
const productService = require('./productService');
const categoryService = require('./categoryService');
const brandService = require('./brandService');
const planService = require('./planService');
const unitService = require('./unitService');
const masterPreloadService = require('./masterPreloadService');
const catalogMasterService = require('./catalogMasterService');
const openFoodFactsService = require('./openFoodFactsService');
const { buildTenantSubscriptionFromPlan } = require('../utils/planHelpers');
const { normalizePhone, placeholderEmailForPhone } = require('../utils/phone');

const STATUSES = ['active', 'trial', 'suspended', 'deleted'];

function getTenantInclude() {
  const { SubscriptionPlan, BusinessType } = getMasterModels();
  return [
    { model: SubscriptionPlan, as: 'subscriptionPlan', required: false },
    { model: BusinessType, as: 'businessType', required: false },
  ];
}

function serializeTenant(tenant, shopFields = {}) {
  const row = tenant.toJSON ? tenant.toJSON() : tenant;
  const plan = row.subscriptionPlan;
  const businessType = row.businessType;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    businessTypeId: row.business_type_id,
    businessTypeName: businessType?.name || null,
    businessTypeCode: businessType?.code || null,
    planId: row.plan_id,
    planName: plan?.name || null,
    planCode: plan?.code || null,
    isTrialPlan: plan?.is_trial || false,
    subscriptionYears: row.subscription_years,
    trialEndsAt: row.trial_ends_at,
    subscriptionEndsAt: row.subscription_ends_at,
    billingEmail: row.billing_email,
    ownerMobile: row.owner_mobile,
    notes: row.notes,
    address: shopFields.address ?? null,
    city: shopFields.city ?? null,
    countryCode: row.country_code,
    currencyCode: row.currency_code,
    timezone: row.timezone,
    maxBranches: row.max_branches,
    maxUsers: row.max_users,
    dbName: row.db_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    subscriptionPlan: plan ? {
      id: plan.id,
      name: plan.name,
      code: plan.code,
      isTrial: plan.is_trial,
      trialDays: plan.trial_days,
      maxBranches: plan.max_branches,
      maxUsers: plan.max_users,
    } : null,
  };
}

async function loadShopAddressFields(tenantId) {
  try {
    const { db } = await tenantConnectionManager.getTenantModelsForAdmin(tenantId);
    const branch = await db.Branch.findOne({
      where: { is_default: true, status: 'active' },
      attributes: ['address', 'city'],
    }) || await db.Branch.findOne({
      where: { status: 'active' },
      order: [['created_at', 'ASC']],
      attributes: ['address', 'city'],
    });
    return {
      address: branch?.address || null,
      city: branch?.city || null,
    };
  } catch (err) {
    console.warn(`Could not load shop address for tenant ${tenantId}:`, err.message);
    return { address: null, city: null };
  }
}

async function updateShopAddressFields(tenantId, data = {}) {
  if (data.address === undefined && data.city === undefined) return;
  const { db } = await tenantConnectionManager.getTenantModelsForAdmin(tenantId);
  const branch = await db.Branch.findOne({ where: { is_default: true } })
    || await db.Branch.findOne({ order: [['created_at', 'ASC']] });
  if (!branch) throw new AppError('No branch found for client', 404, 'NO_BRANCH');

  const updates = {};
  if (data.address !== undefined) {
    updates.address = String(data.address || '').trim() || null;
  }
  if (data.city !== undefined) {
    updates.city = String(data.city || '').trim() || null;
  }
  if (Object.keys(updates).length) {
    await branch.update(updates);
  }
}

async function getDashboard() {
  const { Tenant, SubscriptionPlan } = getMasterModels();
  const tenants = await Tenant.findAll({
    attributes: ['status', 'plan_id'],
    include: [{ model: SubscriptionPlan, as: 'subscriptionPlan', attributes: ['name'] }],
  });
  const byStatus = {};
  const byPlan = {};
  for (const t of tenants) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    const planName = t.subscriptionPlan?.name || 'Unassigned';
    byPlan[planName] = (byPlan[planName] || 0) + 1;
  }
  return {
    totalTenants: tenants.length,
    byStatus,
    byPlan,
    statuses: STATUSES,
  };
}

async function listTenants(query = {}) {
  const { Tenant } = getMasterModels();
  const where = {};
  if (query.status) where.status = query.status;
  if (query.planId) where.plan_id = query.planId;
  if (query.search) {
    where[Op.or] = [
      { name: { [Op.like]: `%${query.search}%` } },
      { slug: { [Op.like]: `%${query.search}%` } },
      { billing_email: { [Op.like]: `%${query.search}%` } },
      { owner_mobile: { [Op.like]: `%${query.search}%` } },
    ];
  }

  const tenants = await Tenant.findAll({
    where,
    include: getTenantInclude(),
    order: [['created_at', 'DESC']],
  });

  return tenants.map(serializeTenant);
}

async function getTenant(id) {
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findByPk(id, { include: getTenantInclude() });
  if (!tenant) throw new AppError('Tenant not found', 404, 'NOT_FOUND');
  const shopFields = await loadShopAddressFields(tenant.id);
  return serializeTenant(tenant, shopFields);
}

async function createTenant(data) {
  if (!data.planId) {
    throw new AppError('Plan is required', 400, 'VALIDATION_ERROR');
  }

  const plan = await planService.getPlanModel(data.planId);
  const subscription = buildTenantSubscriptionFromPlan(plan, data.subscriptionYears);

  try {
    const result = await provisionTenant({
      ...data,
      subscription,
    });
    return {
      tenant: await getTenant(result.tenant.id),
      owner: result.owner,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err.message?.includes('already exists') || err.message?.includes('already linked')) {
      throw new AppError(err.message, 409, 'DUPLICATE_ENTRY');
    }
    throw new AppError(err.message || 'Failed to create client', 500, 'INTERNAL_ERROR');
  }
}

async function updateTenant(id, data) {
  const { Tenant, PlatformAuditLog } = getMasterModels();
  const tenant = await Tenant.findByPk(id);
  if (!tenant) throw new AppError('Tenant not found', 404, 'NOT_FOUND');

  const updates = {};
  if (data.name !== undefined) updates.name = data.name.trim();
  if (data.billingEmail !== undefined) updates.billing_email = data.billingEmail || null;
  if (data.ownerMobile !== undefined) {
    const phone = normalizePhone(data.ownerMobile);
    if (data.ownerMobile && !phone) {
      throw new AppError('Invalid owner mobile number (use 10 digits)', 400, 'VALIDATION_ERROR');
    }
    updates.owner_mobile = phone;
  }
  if (data.notes !== undefined) updates.notes = data.notes || null;
  if (data.businessTypeId !== undefined) updates.business_type_id = data.businessTypeId || null;
  if (data.countryCode !== undefined) updates.country_code = data.countryCode;
  if (data.currencyCode !== undefined) updates.currency_code = data.currencyCode;

  if (data.status !== undefined) {
    if (!STATUSES.includes(data.status)) {
      throw new AppError('Invalid status', 400, 'VALIDATION_ERROR');
    }
    updates.status = data.status;
  }

  const planChanging = data.planId !== undefined;
  const yearsChanging = data.subscriptionYears !== undefined;

  if (planChanging || yearsChanging) {
    const planId = data.planId || tenant.plan_id;
    if (!planId) throw new AppError('Plan is required', 400, 'VALIDATION_ERROR');
    const plan = await planService.getPlanModel(planId);
    const subscriptionYears = data.subscriptionYears !== undefined
      ? data.subscriptionYears
      : tenant.subscription_years;
    const subscription = buildTenantSubscriptionFromPlan(plan, subscriptionYears);
    Object.assign(updates, subscription);
  } else {
    if (data.maxBranches !== undefined) updates.max_branches = data.maxBranches;
    if (data.maxUsers !== undefined) updates.max_users = data.maxUsers;
    if (data.trialEndsAt !== undefined) updates.trial_ends_at = data.trialEndsAt || null;
    if (data.subscriptionEndsAt !== undefined) updates.subscription_ends_at = data.subscriptionEndsAt || null;
  }

  await tenant.update(updates);

  if (updates.owner_mobile !== undefined) {
    await tenant.reload();
    await syncOwnerMobileToTenantUser(tenant);
  }

  if (data.address !== undefined || data.city !== undefined) {
    await updateShopAddressFields(tenant.id, {
      address: data.address,
      city: data.city,
    });
  }

  await PlatformAuditLog.create({
    action: 'tenant.updated',
    tenant_id: tenant.id,
    metadata: { fields: [...Object.keys(updates), ...(data.address !== undefined ? ['address'] : []), ...(data.city !== undefined ? ['city'] : [])] },
  });

  return getTenant(id);
}

async function resolveOwnerMobile(tenant) {
  const { TenantUserIndex } = getMasterModels();
  if (tenant.owner_mobile) return normalizePhone(tenant.owner_mobile);
  const index = await TenantUserIndex.findOne({
    where: { tenant_id: tenant.id, status: 'active' },
    order: [['created_at', 'ASC']],
  });
  if (index?.phone) return normalizePhone(index.phone);
  return null;
}

async function syncOwnerMobileToTenantUser(tenant) {
  const phone = normalizePhone(tenant.owner_mobile);
  if (!phone) return;

  const { TenantUserIndex } = getMasterModels();
  const { db } = await tenantConnectionManager.getTenantModelsForAdmin(tenant.id);
  const { User, Role } = db;

  const ownerRole = await Role.findOne({ where: { name: 'owner' } });
  if (!ownerRole) return;

  const owner = await User.findOne({
    where: { role_id: ownerRole.id },
    order: [['created_at', 'ASC']],
  });
  if (!owner) return;

  await owner.update({
    phone,
    email: owner.email || placeholderEmailForPhone(phone),
  });

  await TenantUserIndex.destroy({ where: { tenant_id: tenant.id } });
  await TenantUserIndex.create({
    tenant_id: tenant.id,
    phone,
    email: placeholderEmailForPhone(phone),
    status: 'active',
  });
}

async function ensureTenantOwnerUser(tenant, db, defaultPassword) {
  const { User, Role, Branch, UserBranch, UserPin } = db;
  const { TenantUserIndex } = getMasterModels();

  const ownerRole = await Role.findOne({ where: { name: 'owner' } });
  if (!ownerRole) {
    throw new AppError('Owner role not found in tenant database', 500, 'INTERNAL_ERROR');
  }

  let owner = await User.findOne({
    where: { role_id: ownerRole.id },
    order: [['created_at', 'ASC']],
  });
  let created = false;

  if (!owner) {
    const phone = await resolveOwnerMobile(tenant);
    if (!phone) {
      throw new AppError(
        'No owner user found. Set owner mobile on this tenant (Edit → Owner mobile), then reset password again.',
        400,
        'VALIDATION_ERROR'
      );
    }

    owner = await User.findOne({ where: { phone } });
    if (owner) {
      await owner.update({ role_id: ownerRole.id, status: 'active', phone });
    } else {
      const defaultBranch = await Branch.findOne({ where: { is_default: true } });
      if (!defaultBranch) {
        throw new AppError('No default branch in tenant database. Re-run tenant setup.', 500, 'INTERNAL_ERROR');
      }

      const passwordHash = await bcrypt.hash(defaultPassword, 12);
      const pinHash = await bcrypt.hash('1234', 12);

      owner = await User.create({
        id: uuidv4(),
        name: `${tenant.name} Owner`,
        email: placeholderEmailForPhone(phone),
        phone,
        password_hash: passwordHash,
        role_id: ownerRole.id,
        status: 'active',
      });

      await UserBranch.findOrCreate({
        where: { user_id: owner.id, branch_id: defaultBranch.id },
        defaults: { id: uuidv4(), is_default: true },
      });

      await UserPin.findOrCreate({
        where: { user_id: owner.id },
        defaults: { id: uuidv4(), pin_hash: pinHash, failed_attempts: 0 },
      });

      created = true;
    }
  } else if (!owner.phone && tenant.owner_mobile) {
    await owner.update({ phone: normalizePhone(tenant.owner_mobile) });
  }

  const ownerPhone = owner.phone || normalizePhone(tenant.owner_mobile);
  const [indexRow] = await TenantUserIndex.findOrCreate({
    where: ownerPhone
      ? { tenant_id: tenant.id, phone: ownerPhone }
      : { tenant_id: tenant.id, email: owner.email },
    defaults: {
      status: 'active',
      phone: ownerPhone,
      email: owner.email || (ownerPhone ? placeholderEmailForPhone(ownerPhone) : null),
    },
  });
  if (indexRow.status !== 'active') {
    await indexRow.update({ status: 'active' });
  }
  if (ownerPhone && !indexRow.phone) {
    await indexRow.update({ phone: ownerPhone });
  }

  const defaultBranch = await Branch.findOne({ where: { is_default: true } });
  if (defaultBranch) {
    await UserBranch.findOrCreate({
      where: { user_id: owner.id, branch_id: defaultBranch.id },
      defaults: { id: uuidv4(), is_default: true },
    });
  }

  const pinHash = await bcrypt.hash('1234', 12);
  const [pinRow] = await UserPin.findOrCreate({
    where: { user_id: owner.id },
    defaults: { id: uuidv4(), pin_hash: pinHash, failed_attempts: 0 },
  });
  if (pinRow.failed_attempts > 0 || pinRow.locked_until) {
    await pinRow.update({ failed_attempts: 0, locked_until: null, pin_hash: pinHash });
  }

  return { owner, created };
}

async function resetTenantOwnerPassword(tenantId) {
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new AppError('Tenant not found', 404, 'NOT_FOUND');

  const { db } = await tenantConnectionManager.getTenantModelsForAdmin(tenantId);
  const { RefreshToken } = db;
  const defaultPassword = config.platform.defaultTenantPassword;

  let owner;
  let created;
  try {
    ({ owner, created } = await ensureTenantOwnerUser(tenant, db, defaultPassword));
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(err.message || 'Failed to reset owner password', 500, 'INTERNAL_ERROR');
  }

  if (!created) {
    const passwordHash = await bcrypt.hash(defaultPassword, 12);
    await owner.update({ password_hash: passwordHash, status: 'active' });
  }

  if (RefreshToken) {
    await RefreshToken.destroy({ where: { user_id: owner.id } });
  }

  try {
    const { PlatformAuditLog } = getMasterModels();
    await PlatformAuditLog.create({
      action: created ? 'tenant.owner_created' : 'tenant.owner_password_reset',
      tenant_id: tenant.id,
      metadata: { ownerMobile: owner.phone, resetBy: 'platform_admin', created },
    });
  } catch (auditErr) {
    console.error('Platform audit log failed:', auditErr.message);
  }

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    ownerMobile: owner.phone,
    ownerName: owner.name,
    defaultPassword,
    created,
    pin: '1234',
    message: created
      ? `Owner account created for ${owner.phone} with default password`
      : `Owner password reset to default for ${owner.phone}`,
  };
}

async function getTenantCatalogMeta(tenantId) {
  const { db } = await tenantConnectionManager.getTenantModelsForAdmin(tenantId);
  const settled = await Promise.allSettled([
    productService.listUnits(db),
    categoryService.listCategories(db, {}),
    brandService.listBrands(db, {}),
    db.TaxGroup.findAll({ where: { status: 'active' }, order: [['name', 'ASC']] }),
  ]);

  const value = (result, fallback = []) =>
    (result.status === 'fulfilled' ? result.value : fallback) || fallback;

  const units = value(settled[0]);
  const categories = value(settled[1]);
  const brands = value(settled[2]);
  const taxGroups = value(settled[3]);

  return {
    units: units.map((u) => ({ id: u.id, code: u.code, name: u.name, type: u.type })),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    brands: brands.map((b) => ({ id: b.id, name: b.name })),
    taxGroups: taxGroups.map((t) => ({
      id: t.id,
      name: t.name,
      totalRate: t.total_rate ?? t.totalRate ?? 0,
    })),
  };
}

async function createTenantCategory(tenantId, data) {
  const { db } = await tenantConnectionManager.getTenantModelsForAdmin(tenantId);
  const category = await categoryService.createCategory(db, data);
  return { id: category.id, name: category.name };
}

async function createTenantBrand(tenantId, data) {
  const { db } = await tenantConnectionManager.getTenantModelsForAdmin(tenantId);
  const brand = await brandService.createBrand(db, data);
  return { id: brand.id, name: brand.name };
}

async function listTenantProducts(tenantId, query) {
  const { db } = await tenantConnectionManager.getTenantModelsForAdmin(tenantId);
  return productService.listProducts(db, query);
}

async function createTenantProduct(tenantId, data) {
  const { db } = await tenantConnectionManager.getTenantModelsForAdmin(tenantId);
  return productService.createProduct(db, data);
}

async function importTenantProducts(tenantId, rows) {
  const { db } = await tenantConnectionManager.getTenantModelsForAdmin(tenantId);
  return productService.bulkImport(db, rows);
}

async function importTenantProductsFromMaster(tenantId, payload = {}) {
  const masterCatalogImportService = require('./masterCatalogImportService');
  const { tenant, db } = await tenantConnectionManager.getTenantModelsForAdmin(tenantId);
  return masterCatalogImportService.importMasterProductsToTenant(db, tenant, {
    masterProductIds: payload.masterProductIds || payload.ids || [],
    branchId: payload.branchId || null,
  });
}

async function listTenantMasterCatalog(tenantId, query = {}) {
  const masterCatalogImportService = require('./masterCatalogImportService');
  const { tenant } = await tenantConnectionManager.getTenantModelsForAdmin(tenantId);
  return masterCatalogImportService.listMasterCatalogForTenant(tenant, query);
}

async function listTenantMasterCatalogCategories(tenantId, query = {}) {
  const masterCatalogImportService = require('./masterCatalogImportService');
  const { tenant } = await tenantConnectionManager.getTenantModelsForAdmin(tenantId);
  return masterCatalogImportService.listMasterCategoriesForTenant(tenant, query);
}

async function listTenantMasterCatalogBusinessTypes(tenantId) {
  const masterCatalogImportService = require('./masterCatalogImportService');
  const { tenant } = await tenantConnectionManager.getTenantModelsForAdmin(tenantId);
  return masterCatalogImportService.listImportableBusinessTypes(tenant);
}

async function updateTenantProduct(tenantId, productId, data) {
  const { db } = await tenantConnectionManager.getTenantModelsForAdmin(tenantId);
  return productService.updateProduct(db, productId, data);
}

async function deleteTenantProduct(tenantId, productId) {
  const { db } = await tenantConnectionManager.getTenantModelsForAdmin(tenantId);
  return productService.deleteProduct(db, productId);
}

async function listMasterUnits(query) {
  return unitService.listUnits(query);
}

async function createMasterUnit(data) {
  return unitService.createUnit(data);
}

async function updateMasterUnit(unitId, data) {
  return unitService.updateUnit(unitId, data);
}

async function deleteMasterUnit(unitId) {
  return unitService.deleteUnit(unitId);
}

async function syncMasterUnitsToAllTenants() {
  return masterPreloadService.syncMasterUnitsToAllTenants();
}

async function listBusinessTypes(query) {
  return catalogMasterService.listBusinessTypes(query);
}

async function createBusinessType(data) {
  return catalogMasterService.createBusinessType(data);
}

async function updateBusinessType(id, data) {
  return catalogMasterService.updateBusinessType(id, data);
}

async function deleteBusinessType(id) {
  return catalogMasterService.deleteBusinessType(id);
}

async function listMasterCategories(query) {
  return catalogMasterService.listCategories(query);
}

async function createMasterCategory(data) {
  return catalogMasterService.createCategory(data);
}

async function updateMasterCategory(id, data) {
  return catalogMasterService.updateCategory(id, data);
}

async function deleteMasterCategory(id) {
  return catalogMasterService.deleteCategory(id);
}

async function listMasterBrands(query) {
  return catalogMasterService.listBrands(query);
}

async function createMasterBrand(data) {
  return catalogMasterService.createBrand(data);
}

async function updateMasterBrand(id, data) {
  return catalogMasterService.updateBrand(id, data);
}

async function deleteMasterBrand(id) {
  return catalogMasterService.deleteBrand(id);
}

async function listMasterProducts(query) {
  return catalogMasterService.listMasterProducts(query);
}

async function latestSavedMasterBarcodes(businessTypeId) {
  const barcodes = await catalogMasterService.latestSavedMasterBarcodes(businessTypeId);
  return { barcodes };
}

async function createMasterProduct(data) {
  return catalogMasterService.createMasterProduct(data);
}

async function updateMasterProduct(id, data) {
  return catalogMasterService.updateMasterProduct(id, data);
}

async function deleteMasterProduct(id) {
  return catalogMasterService.deleteMasterProduct(id);
}

async function importMasterProducts(data) {
  return catalogMasterService.bulkImportMasterProducts(data);
}

async function importMasterCategories(data) {
  return catalogMasterService.bulkImportMasterCategories(data);
}

async function importMasterBrands(data) {
  return catalogMasterService.bulkImportMasterBrands(data);
}

async function searchOpenFoodFacts(query) {
  return openFoodFactsService.searchOpenFoodFacts(query);
}

async function importOpenFoodToMaster(businessTypeId, body) {
  return openFoodFactsService.importOpenFoodToMaster(businessTypeId, body);
}

module.exports = {
  getDashboard,
  listTenants,
  getTenant,
  createTenant,
  updateTenant,
  resetTenantOwnerPassword,
  getTenantCatalogMeta,
  createTenantCategory,
  createTenantBrand,
  listTenantProducts,
  createTenantProduct,
  importTenantProducts,
  importTenantProductsFromMaster,
  listTenantMasterCatalog,
  listTenantMasterCatalogCategories,
  listTenantMasterCatalogBusinessTypes,
  updateTenantProduct,
  deleteTenantProduct,
  listMasterUnits,
  createMasterUnit,
  updateMasterUnit,
  deleteMasterUnit,
  syncMasterUnitsToAllTenants,
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
  importOpenFoodToMaster,
  STATUSES,
};
