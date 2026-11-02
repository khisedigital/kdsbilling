'use strict';

/**
 * Master-side Shopify tables:
 * - shopify_shops: routes webhooks (shop domain → tenant) and powers super-admin
 *   monitoring. Never holds tokens; those live encrypted in each tenant DB.
 * - shopify_sync_jobs: DB-backed background job queue shared by all API workers.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) =>
      typeof t === 'string' ? t : t.tableName
    );

    if (!tables.includes('shopify_shops')) {
      await queryInterface.createTable('shopify_shops', {
        id: { type: Sequelize.UUID, primaryKey: true },
        tenant_id: {
          type: Sequelize.UUID,
          allowNull: false,
          unique: true,
          references: { model: 'tenants', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        shop_domain: { type: Sequelize.STRING(255), allowNull: true, unique: true },
        shop_name: { type: Sequelize.STRING(255), allowNull: true },
        status: {
          type: Sequelize.ENUM('pending', 'connected', 'disconnected', 'error'),
          allowNull: false,
          defaultValue: 'pending',
        },
        sync_status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'idle' },
        last_sync_at: { type: Sequelize.DATE, allowNull: true },
        last_error: { type: Sequelize.TEXT, allowNull: true },
        last_error_at: { type: Sequelize.DATE, allowNull: true },
        connected_at: { type: Sequelize.DATE, allowNull: true },
        disconnected_at: { type: Sequelize.DATE, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('shopify_shops', ['status'], { name: 'shopify_shops_status' });
    }

    if (!tables.includes('shopify_sync_jobs')) {
      await queryInterface.createTable('shopify_sync_jobs', {
        id: { type: Sequelize.UUID, primaryKey: true },
        tenant_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'tenants', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        job_type: { type: Sequelize.STRING(40), allowNull: false },
        payload: { type: Sequelize.JSON, allowNull: true },
        dedupe_key: { type: Sequelize.STRING(191), allowNull: true, unique: true },
        status: {
          type: Sequelize.ENUM('pending', 'running', 'done', 'failed'),
          allowNull: false,
          defaultValue: 'pending',
        },
        attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        max_attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 8 },
        run_after: { type: Sequelize.DATE, allowNull: false },
        locked_at: { type: Sequelize.DATE, allowNull: true },
        locked_by: { type: Sequelize.STRING(100), allowNull: true },
        last_error: { type: Sequelize.TEXT, allowNull: true },
        completed_at: { type: Sequelize.DATE, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('shopify_sync_jobs', ['status', 'run_after'], {
        name: 'shopify_sync_jobs_status_run_after',
      });
      await queryInterface.addIndex('shopify_sync_jobs', ['tenant_id', 'job_type', 'status'], {
        name: 'shopify_sync_jobs_tenant_type_status',
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('shopify_sync_jobs');
    await queryInterface.dropTable('shopify_shops');
  },
};
