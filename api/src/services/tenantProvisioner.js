const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { getMasterSequelize } = require('../config/masterDatabase');
const { getMasterModels, initMasterModels } = require('../models/master');
const tenantConnectionManager = require('../config/tenantConnectionManager');
const masterPreloadService = require('./masterPreloadService');
const { setupTenantDatabase } = require('./tenantDbSetup');
const { normalizePhone, placeholderEmailForPhone } = require('../utils/phone');

function buildTenantDbName(slug) {
  const safe = String(slug || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  const prefix = config.tenantDb.prefix || '';
  // Keep under MySQL's 64-char DB name limit.
  // Shared hosting: khisedigital_t_shopcode
  // Local root: billing_tenant_shopcode
  if (prefix) {
    return `${prefix}t_${safe}`.slice(0, 64);
  }
  return `billing_tenant_${safe}`.slice(0, 64);
}

async function safeAudit(action, tenantId, metadata) {
  try {
    const { PlatformAuditLog } = getMasterModels();
    await PlatformAuditLog.create({
      action,
      tenant_id: tenantId,
      metadata: metadata || null,
    });
  } catch (err) {
    console.error('Platform audit log failed:', err.message);
  }
}

async function rollbackFailedProvision(sequelize, tenant, dbName) {
  try {
    if (tenant?.id) {
      const { TenantUserIndex, Tenant } = getMasterModels();
      await TenantUserIndex.destroy({ where: { tenant_id: tenant.id } });
      await Tenant.destroy({ where: { id: tenant.id } });
    }
  } catch (err) {
    console.error('Failed to remove incomplete tenant row:', err.message);
  }

  try {
    if (dbName) {
      await sequelize.query(`DROP DATABASE IF EXISTS \`${dbName}\`;`);
    }
  } catch (err) {
    console.error('Failed to drop incomplete tenant database:', err.message);
  }

  try {
    if (tenant?.id) {
      await tenantConnectionManager.closeTenant(tenant.id);
    }
  } catch (_) {
    /* ignore */
  }
}

async function provisionTenant({
  name,
  slug,
  ownerName,
  ownerMobile,
  ownerEmail,
  ownerPassword,
  countryCode = 'IN',
  currencyCode = 'INR',
  businessTypeId,
  subscription = {},
  billingEmail,
  notes,
  address,
  city,
}) {
  const phone = normalizePhone(ownerMobile || ownerEmail);
  if (!phone) {
    throw new Error('Valid owner mobile number is required (10 digits)');
  }
  const sequelize = getMasterSequelize();
  initMasterModels(sequelize);
  const { Tenant, TenantUserIndex } = getMasterModels();

  const existing = await Tenant.findOne({ where: { slug } });
  if (existing) {
    throw new Error(
      `Tenant with slug "${slug}" already exists. Use a different shop code, or delete the incomplete client first.`
    );
  }

  const existingPhone = await TenantUserIndex.findOne({ where: { phone, status: 'active' } });
  if (existingPhone) {
    throw new Error(`Owner mobile ${phone} is already linked to another shop`);
  }

  const dbName = buildTenantDbName(slug);
  let tenant = null;

  try {
    try {
      await sequelize.query(
        `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
      );
    } catch (createDbErr) {
      throw new Error(
        `Could not create database "${dbName}": ${createDbErr.message}. ` +
          `On shared hosting set TENANT_DB_PREFIX to your account prefix (e.g. TENANT_DB_PREFIX=khisedigital_) ` +
          `and GRANT ALL on that prefix to user "${config.tenantDb.username}".`
      );
    }

    // Best-effort: some hosts auto-grant only when DB matches user prefix.
    try {
      const user = config.tenantDb.username.replace(/'/g, '');
      await sequelize.query(
        `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${user}'@'localhost'`
      );
      await sequelize.query('FLUSH PRIVILEGES');
    } catch (_) {
      /* ignore — many shared users cannot GRANT */
    }

    const baseFields = {
      name,
      slug,
      status: subscription.status || 'trial',
      db_host: config.tenantDb.host,
      db_port: config.tenantDb.port,
      db_name: dbName,
      db_user: config.tenantDb.username,
      db_password: config.tenantDb.password,
      country_code: countryCode,
      currency_code: currencyCode,
      billing_email: billingEmail || null,
      notes: notes || null,
      ...subscription,
    };

    try {
      tenant = await Tenant.create({
        ...baseFields,
        owner_mobile: phone,
        business_type_id: businessTypeId || null,
      });
    } catch (createErr) {
      if (!/Unknown column|owner_mobile|business_type_id|plan_id|billing_email|notes|subscription_/i.test(createErr.message || '')) {
        throw createErr;
      }
      tenant = await Tenant.create({
        name,
        slug,
        status: subscription.status || 'trial',
        db_host: config.tenantDb.host,
        db_port: config.tenantDb.port,
        db_name: dbName,
        db_user: config.tenantDb.username,
        db_password: config.tenantDb.password,
        country_code: countryCode,
        currency_code: currencyCode,
      });
    }

    try {
      await setupTenantDatabase(dbName);
    } catch (err) {
      throw new Error(`Tenant database setup failed: ${err.message}`);
    }

    const models = await tenantConnectionManager.getTenantModels(tenant);
    await masterPreloadService.syncMasterUnitsToTenantDb(models);
    const catalog = await masterPreloadService.preloadCatalogToTenantDb(models, businessTypeId);

    const { User, Role, Branch, UserBranch, UserPin } = models;
    const ownerRole = await Role.findOne({ where: { name: 'owner' } });
    const defaultBranch = await Branch.findOne({ where: { is_default: true } });
    if (!ownerRole || !defaultBranch) {
      throw new Error('Tenant seed data incomplete (owner role or default branch missing)');
    }

    const branchUpdates = {};
    if (address !== undefined) {
      const addr = String(address || '').trim();
      branchUpdates.address = addr || null;
    }
    if (city !== undefined) {
      const cityVal = String(city || '').trim();
      branchUpdates.city = cityVal || null;
    }
    if (Object.keys(branchUpdates).length) {
      await defaultBranch.update(branchUpdates);
    }

    const passwordHash = await bcrypt.hash(ownerPassword, 12);
    const pinHash = await bcrypt.hash('1234', 12);

    const owner = await User.create({
      id: uuidv4(),
      name: ownerName,
      email: placeholderEmailForPhone(phone),
      phone,
      password_hash: passwordHash,
      role_id: ownerRole.id,
      status: 'active',
    });

    await UserBranch.create({
      user_id: owner.id,
      branch_id: defaultBranch.id,
      is_default: true,
    });

    await UserPin.create({
      user_id: owner.id,
      pin_hash: pinHash,
      failed_attempts: 0,
    });

    await TenantUserIndex.create({
      tenant_id: tenant.id,
      phone,
      email: placeholderEmailForPhone(phone),
      status: 'active',
    });

    // Best-effort fill of newer columns if the first create skipped them
    try {
      await tenant.update({
        ...subscription,
        owner_mobile: phone,
        business_type_id: businessTypeId || null,
        billing_email: billingEmail || null,
        notes: notes || null,
      });
    } catch (updateErr) {
      console.error('Tenant detail update after provision:', updateErr.message);
    }

    await safeAudit('tenant.provisioned', tenant.id, {
      slug,
      ownerMobile: phone,
      businessTypeId: businessTypeId || null,
      catalog,
    });

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        dbName,
        businessTypeId: businessTypeId || null,
        ownerMobile: phone,
        catalog,
      },
      owner: {
        id: owner.id,
        phone: owner.phone,
      },
    };
  } catch (err) {
    await rollbackFailedProvision(sequelize, tenant, dbName);
    throw err;
  }
}

module.exports = { provisionTenant };
