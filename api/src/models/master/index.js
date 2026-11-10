const { DataTypes } = require('sequelize');
const { jsonColumn } = require('../../utils/jsonColumn');

function defineSubscriptionPlan(sequelize) {
  return sequelize.define(
    'SubscriptionPlan',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      code: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      description: DataTypes.TEXT,
      max_branches: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      max_users: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 5,
      },
      is_trial: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      trial_days: DataTypes.INTEGER,
      allowed_subscription_years: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      price_monthly: DataTypes.DECIMAL(12, 2),
      price_yearly: DataTypes.DECIMAL(12, 2),
      status: {
        type: DataTypes.ENUM('active', 'inactive'),
        defaultValue: 'active',
      },
      sort_order: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
    },
    {
      tableName: 'subscription_plans',
    }
  );
}

function defineTenant(sequelize) {
  return sequelize.define(
    'Tenant',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      slug: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      status: {
        type: DataTypes.ENUM('active', 'trial', 'suspended', 'deleted'),
        defaultValue: 'trial',
      },
      business_type_id: DataTypes.UUID,
      plan_id: DataTypes.UUID,
      subscription_years: DataTypes.INTEGER,
      trial_ends_at: DataTypes.DATE,
      subscription_ends_at: DataTypes.DATE,
      billing_email: DataTypes.STRING(150),
      owner_mobile: DataTypes.STRING(20),
      notes: DataTypes.TEXT,
      db_host: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      db_port: {
        type: DataTypes.INTEGER,
        defaultValue: 3306,
      },
      db_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      db_user: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      db_password: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      country_code: {
        type: DataTypes.STRING(2),
        defaultValue: 'IN',
      },
      timezone: {
        type: DataTypes.STRING(50),
        defaultValue: 'Asia/Kolkata',
      },
      currency_code: {
        type: DataTypes.STRING(3),
        defaultValue: 'INR',
      },
      max_branches: {
        type: DataTypes.INTEGER,
        defaultValue: 5,
      },
      max_users: {
        type: DataTypes.INTEGER,
        defaultValue: 20,
      },
    },
    {
      tableName: 'tenants',
    }
  );
}

function defineTenantUserIndex(sequelize) {
  return sequelize.define(
    'TenantUserIndex',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenant_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      phone: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('active', 'inactive'),
        defaultValue: 'active',
      },
    },
    {
      tableName: 'tenant_user_index',
      indexes: [
        { fields: ['tenant_id', 'email'] },
        { fields: ['tenant_id', 'phone'] },
      ],
    }
  );
}

function defineBusinessType(sequelize) {
  return sequelize.define(
    'BusinessType',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      code: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      description: DataTypes.TEXT,
      status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
      sort_order: { type: DataTypes.INTEGER, defaultValue: 0 },
    },
    { tableName: 'business_types' }
  );
}

function defineMasterCategory(sequelize) {
  return sequelize.define(
    'MasterCategory',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      business_type_id: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(150), allowNull: false },
      name_mr: DataTypes.STRING(150),
      description: DataTypes.TEXT,
      status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
      sort_order: { type: DataTypes.INTEGER, defaultValue: 0 },
    },
    { tableName: 'master_categories' }
  );
}

function defineMasterBrand(sequelize) {
  return sequelize.define(
    'MasterBrand',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      business_type_id: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(150), allowNull: false },
      name_mr: DataTypes.STRING(150),
      description: DataTypes.TEXT,
      status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
      sort_order: { type: DataTypes.INTEGER, defaultValue: 0 },
    },
    { tableName: 'master_brands' }
  );
}

function defineMasterProduct(sequelize) {
  return sequelize.define(
    'MasterProduct',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      business_type_id: { type: DataTypes.UUID, allowNull: false },
      category_id: DataTypes.UUID,
      brand_id: DataTypes.UUID,
      name: { type: DataTypes.STRING(200), allowNull: false },
      name_mr: DataTypes.STRING(200),
      description: DataTypes.TEXT,
      uom_code: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'pcs' },
      selling_price: { type: DataTypes.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
      cost_price: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
      mrp: DataTypes.DECIMAL(15, 4),
      sku: DataTypes.STRING(50),
      barcode: DataTypes.STRING(50),
      status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
      sort_order: { type: DataTypes.INTEGER, defaultValue: 0 },
    },
    { tableName: 'master_products' }
  );
}

function defineMasterProductVariant(sequelize) {
  return sequelize.define(
    'MasterProductVariant',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      master_product_id: { type: DataTypes.UUID, allowNull: false },
      size: DataTypes.STRING(30),
      selling_price: { type: DataTypes.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
      mrp: DataTypes.DECIMAL(15, 4),
      sort_order: { type: DataTypes.INTEGER, defaultValue: 0 },
    },
    { tableName: 'master_product_variants' }
  );
}

function defineMasterVariantBarcode(sequelize) {
  return sequelize.define(
    'MasterVariantBarcode',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      variant_id: { type: DataTypes.UUID, allowNull: false },
      barcode: { type: DataTypes.STRING(50), allowNull: false },
      is_primary: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    { tableName: 'master_variant_barcodes' }
  );
}

function defineMasterUnit(sequelize) {
  return sequelize.define(
    'MasterUnit',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      code: {
        type: DataTypes.STRING(10),
        allowNull: false,
        unique: true,
      },
      name: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM('count', 'weight', 'volume', 'length'),
        allowNull: false,
      },
      base_unit_id: DataTypes.UUID,
      conversion_factor: {
        type: DataTypes.DECIMAL(15, 6),
        defaultValue: 1,
      },
      status: {
        type: DataTypes.ENUM('active', 'inactive'),
        defaultValue: 'active',
      },
      sort_order: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
    },
    { tableName: 'master_units' }
  );
}

function definePlatformAuditLog(sequelize) {
  return sequelize.define(
    'PlatformAuditLog',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      action: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      tenant_id: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      ip_address: {
        type: DataTypes.STRING(45),
        allowNull: true,
      },
    },
    {
      tableName: 'platform_audit_logs',
      updatedAt: false,
    }
  );
}

function defineShopifyShop(sequelize) {
  return sequelize.define(
    'ShopifyShop',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenant_id: { type: DataTypes.UUID, allowNull: false, unique: true },
      shop_domain: { type: DataTypes.STRING(255), allowNull: true, unique: true },
      shop_name: DataTypes.STRING(255),
      status: {
        type: DataTypes.ENUM('pending', 'connected', 'disconnected', 'error'),
        allowNull: false,
        defaultValue: 'pending',
      },
      sync_status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'idle' },
      last_sync_at: DataTypes.DATE,
      last_error: DataTypes.TEXT,
      last_error_at: DataTypes.DATE,
      connected_at: DataTypes.DATE,
      disconnected_at: DataTypes.DATE,
    },
    { tableName: 'shopify_shops' }
  );
}

function defineShopifySyncJob(sequelize) {
  return sequelize.define(
    'ShopifySyncJob',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenant_id: { type: DataTypes.UUID, allowNull: false },
      job_type: { type: DataTypes.STRING(40), allowNull: false },
      payload: jsonColumn('payload'),
      dedupe_key: { type: DataTypes.STRING(191), allowNull: true, unique: true },
      status: {
        type: DataTypes.ENUM('pending', 'running', 'done', 'failed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      max_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 8 },
      run_after: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      locked_at: DataTypes.DATE,
      locked_by: DataTypes.STRING(100),
      last_error: DataTypes.TEXT,
      completed_at: DataTypes.DATE,
    },
    { tableName: 'shopify_sync_jobs' }
  );
}

let masterModels = null;

function initMasterModels(sequelize) {
  if (masterModels && masterModels.sequelize === sequelize) {
    return masterModels;
  }

  const SubscriptionPlan = defineSubscriptionPlan(sequelize);
  const Tenant = defineTenant(sequelize);
  const TenantUserIndex = defineTenantUserIndex(sequelize);
  const PlatformAuditLog = definePlatformAuditLog(sequelize);
  const MasterUnit = defineMasterUnit(sequelize);
  const BusinessType = defineBusinessType(sequelize);
  const MasterCategory = defineMasterCategory(sequelize);
  const MasterBrand = defineMasterBrand(sequelize);
  const MasterProduct = defineMasterProduct(sequelize);
  const MasterProductVariant = defineMasterProductVariant(sequelize);
  const MasterVariantBarcode = defineMasterVariantBarcode(sequelize);
  const ShopifyShop = defineShopifyShop(sequelize);
  const ShopifySyncJob = defineShopifySyncJob(sequelize);

  Tenant.hasOne(ShopifyShop, { foreignKey: 'tenant_id', as: 'shopifyShop' });
  ShopifyShop.belongsTo(Tenant, { foreignKey: 'tenant_id', as: 'tenant' });

  SubscriptionPlan.hasMany(Tenant, { foreignKey: 'plan_id', as: 'tenants' });
  Tenant.belongsTo(SubscriptionPlan, { foreignKey: 'plan_id', as: 'subscriptionPlan' });

  BusinessType.hasMany(Tenant, { foreignKey: 'business_type_id', as: 'tenants' });
  Tenant.belongsTo(BusinessType, { foreignKey: 'business_type_id', as: 'businessType' });

  BusinessType.hasMany(MasterCategory, { foreignKey: 'business_type_id', as: 'categories' });
  MasterCategory.belongsTo(BusinessType, { foreignKey: 'business_type_id', as: 'businessType' });

  BusinessType.hasMany(MasterBrand, { foreignKey: 'business_type_id', as: 'brands' });
  MasterBrand.belongsTo(BusinessType, { foreignKey: 'business_type_id', as: 'businessType' });

  BusinessType.hasMany(MasterProduct, { foreignKey: 'business_type_id', as: 'products' });
  MasterProduct.belongsTo(BusinessType, { foreignKey: 'business_type_id', as: 'businessType' });
  MasterCategory.hasMany(MasterProduct, { foreignKey: 'category_id', as: 'products' });
  MasterProduct.belongsTo(MasterCategory, { foreignKey: 'category_id', as: 'category' });
  MasterBrand.hasMany(MasterProduct, { foreignKey: 'brand_id', as: 'products' });
  MasterProduct.belongsTo(MasterBrand, { foreignKey: 'brand_id', as: 'brand' });

  MasterProduct.hasMany(MasterProductVariant, {
    foreignKey: 'master_product_id',
    as: 'variants',
    onDelete: 'CASCADE',
  });
  MasterProductVariant.belongsTo(MasterProduct, { foreignKey: 'master_product_id', as: 'product' });
  MasterProductVariant.hasMany(MasterVariantBarcode, {
    foreignKey: 'variant_id',
    as: 'barcodes',
    onDelete: 'CASCADE',
  });
  MasterVariantBarcode.belongsTo(MasterProductVariant, { foreignKey: 'variant_id', as: 'variant' });

  Tenant.hasMany(TenantUserIndex, { foreignKey: 'tenant_id', as: 'userIndexes' });
  TenantUserIndex.belongsTo(Tenant, { foreignKey: 'tenant_id', as: 'tenant' });

  MasterUnit.belongsTo(MasterUnit, { foreignKey: 'base_unit_id', as: 'baseUnit' });

  masterModels = {
    sequelize,
    SubscriptionPlan,
    Tenant,
    TenantUserIndex,
    PlatformAuditLog,
    MasterUnit,
    BusinessType,
    MasterCategory,
    MasterBrand,
    MasterProduct,
    MasterProductVariant,
    MasterVariantBarcode,
    ShopifyShop,
    ShopifySyncJob,
  };
  return masterModels;
}

function getMasterModels() {
  if (!masterModels) {
    const { getMasterSequelize } = require('../../config/masterDatabase');
    return initMasterModels(getMasterSequelize());
  }
  return masterModels;
}

module.exports = {
  initMasterModels,
  getMasterModels,
};
