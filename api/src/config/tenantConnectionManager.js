const { Sequelize } = require('sequelize');
const config = require('./index');
const { getMasterModels } = require('../models/master');
const AppError = require('../utils/AppError');

class TenantConnectionManager {
  constructor() {
    this.connections = new Map();
    this.modelCache = new Map();
  }

  async getTenantConfig(tenantId) {
    const { Tenant } = getMasterModels();
    const tenant = await Tenant.findByPk(tenantId);
    if (!tenant) {
      throw new AppError('Tenant not found', 404, 'TENANT_NOT_FOUND');
    }
    if (tenant.status !== 'active' && tenant.status !== 'trial') {
      throw new AppError('Tenant is not active', 403, 'TENANT_SUSPENDED');
    }
    return tenant;
  }

  async getTenantBySlug(slug) {
    const { Tenant } = getMasterModels();
    const tenant = await Tenant.findOne({ where: { slug } });
    if (!tenant) {
      throw new AppError('Shop not found', 404, 'SHOP_NOT_FOUND');
    }
    return tenant;
  }

  async getConnection(tenant) {
    const tenantId = tenant.id;
    if (this.connections.has(tenantId)) {
      return this.connections.get(tenantId);
    }

    const sequelize = new Sequelize(tenant.db_name, tenant.db_user, tenant.db_password, {
      host: tenant.db_host || config.tenantDb.host,
      port: tenant.db_port || config.tenantDb.port,
      dialect: 'mysql',
      logging: config.env === 'development' ? false : false,
      define: {
        underscored: true,
        timestamps: true,
      },
      pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000,
      },
    });

    await sequelize.authenticate();
    this.connections.set(tenantId, sequelize);
    return sequelize;
  }

  async getTenantModels(tenant) {
    const tenantId = tenant.id;
    if (this.modelCache.has(tenantId)) {
      return this.modelCache.get(tenantId);
    }

    const sequelize = await this.getConnection(tenant);
    const { initTenantModels } = require('../models/tenant');
    const models = initTenantModels(sequelize);
    Object.defineProperty(models, 'tenantId', { value: tenantId, enumerable: false });
    this.modelCache.set(tenantId, models);
    return models;
  }

  async getTenantById(tenantId) {
    const { Tenant } = getMasterModels();
    const tenant = await Tenant.findByPk(tenantId);
    if (!tenant) {
      throw new AppError('Tenant not found', 404, 'TENANT_NOT_FOUND');
    }
    return tenant;
  }

  async getTenantModelsForAdmin(tenantId) {
    const tenant = await this.getTenantById(tenantId);
    return { tenant, db: await this.getTenantModels(tenant) };
  }

  async closeTenant(tenantId) {
    const connection = this.connections.get(tenantId);
    if (connection) {
      await connection.close();
      this.connections.delete(tenantId);
      this.modelCache.delete(tenantId);
    }
  }
}

const tenantConnectionManager = new TenantConnectionManager();

module.exports = tenantConnectionManager;
