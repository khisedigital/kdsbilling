'use strict';

async function tableExists(queryInterface, name) {
  const tables = (await queryInterface.showAllTables()).map((t) =>
    typeof t === 'string' ? t : t.tableName
  );
  return tables.includes(name);
}

/** Tenant-side Shopify tables. Access/refresh tokens are stored AES-256-GCM encrypted. */
module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await tableExists(queryInterface, 'shopify_connections'))) {
      await queryInterface.createTable('shopify_connections', {
        id: { type: Sequelize.UUID, primaryKey: true },
        shop_domain: { type: Sequelize.STRING(255), allowNull: false, unique: true },
        shop_name: { type: Sequelize.STRING(255), allowNull: true },
        shop_currency: { type: Sequelize.STRING(3), allowNull: true },
        status: {
          type: Sequelize.ENUM('pending', 'connected', 'disconnected', 'error'),
          allowNull: false,
          defaultValue: 'pending',
        },
        access_token_enc: { type: Sequelize.TEXT, allowNull: true },
        refresh_token_enc: { type: Sequelize.TEXT, allowNull: true },
        access_token_expires_at: { type: Sequelize.DATE, allowNull: true },
        refresh_token_expires_at: { type: Sequelize.DATE, allowNull: true },
        scopes: { type: Sequelize.STRING(500), allowNull: true },
        oauth_nonce: { type: Sequelize.STRING(64), allowNull: true },
        oauth_requested_at: { type: Sequelize.DATE, allowNull: true },
        branch_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'branches', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        shopify_location_id: { type: Sequelize.STRING(100), allowNull: true },
        shopify_location_name: { type: Sequelize.STRING(255), allowNull: true },
        webhook_ids: { type: Sequelize.JSON, allowNull: true },
        product_sync_status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'idle' },
        product_sync_at: { type: Sequelize.DATE, allowNull: true },
        product_sync_summary: { type: Sequelize.JSON, allowNull: true },
        inventory_sync_status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'idle' },
        inventory_sync_at: { type: Sequelize.DATE, allowNull: true },
        order_sync_status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'idle' },
        order_sync_at: { type: Sequelize.DATE, allowNull: true },
        last_sync_at: { type: Sequelize.DATE, allowNull: true },
        last_error: { type: Sequelize.TEXT, allowNull: true },
        last_error_at: { type: Sequelize.DATE, allowNull: true },
        connected_by: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        connected_at: { type: Sequelize.DATE, allowNull: true },
        disconnected_at: { type: Sequelize.DATE, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false },
      });
    }

    if (!(await tableExists(queryInterface, 'shopify_product_mappings'))) {
      await queryInterface.createTable('shopify_product_mappings', {
        id: { type: Sequelize.UUID, primaryKey: true },
        connection_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'shopify_connections', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        product_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'products', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        variant_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'product_variants', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        shopify_product_id: { type: Sequelize.STRING(100), allowNull: false },
        shopify_variant_id: { type: Sequelize.STRING(100), allowNull: false },
        shopify_inventory_item_id: { type: Sequelize.STRING(100), allowNull: true },
        inventory_tracked: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        sku: { type: Sequelize.STRING(100), allowNull: true },
        barcode: { type: Sequelize.STRING(100), allowNull: true },
        match_type: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'created' },
        last_shopify_qty: { type: Sequelize.INTEGER, allowNull: true },
        last_synced_at: { type: Sequelize.DATE, allowNull: true },
        last_error: { type: Sequelize.TEXT, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('shopify_product_mappings', ['connection_id', 'shopify_variant_id'], {
        unique: true,
        name: 'shopify_product_mappings_conn_shopify_variant',
      });
      await queryInterface.addIndex('shopify_product_mappings', ['connection_id', 'variant_id'], {
        unique: true,
        name: 'shopify_product_mappings_conn_variant',
      });
      await queryInterface.addIndex('shopify_product_mappings', ['shopify_inventory_item_id'], {
        name: 'shopify_product_mappings_inventory_item',
      });
      await queryInterface.addIndex('shopify_product_mappings', ['shopify_product_id'], {
        name: 'shopify_product_mappings_shopify_product',
      });
    }

    if (!(await tableExists(queryInterface, 'shopify_order_mappings'))) {
      await queryInterface.createTable('shopify_order_mappings', {
        id: { type: Sequelize.UUID, primaryKey: true },
        connection_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'shopify_connections', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        shopify_order_id: { type: Sequelize.STRING(100), allowNull: false },
        shopify_order_name: { type: Sequelize.STRING(50), allowNull: true },
        financial_status: { type: Sequelize.STRING(40), allowNull: true },
        fulfillment_status: { type: Sequelize.STRING(40), allowNull: true },
        currency_code: { type: Sequelize.STRING(3), allowNull: true },
        total_amount: { type: Sequelize.DECIMAL(15, 4), allowNull: true },
        item_count: { type: Sequelize.INTEGER, allowNull: true },
        line_items: { type: Sequelize.JSON, allowNull: true },
        status: {
          type: Sequelize.ENUM('imported', 'cancelled', 'failed'),
          allowNull: false,
          defaultValue: 'imported',
        },
        error: { type: Sequelize.TEXT, allowNull: true },
        shopify_created_at: { type: Sequelize.DATE, allowNull: true },
        shopify_cancelled_at: { type: Sequelize.DATE, allowNull: true },
        processed_at: { type: Sequelize.DATE, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('shopify_order_mappings', ['connection_id', 'shopify_order_id'], {
        unique: true,
        name: 'shopify_order_mappings_conn_order',
      });
      await queryInterface.addIndex('shopify_order_mappings', ['shopify_created_at'], {
        name: 'shopify_order_mappings_created',
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('shopify_order_mappings');
    await queryInterface.dropTable('shopify_product_mappings');
    await queryInterface.dropTable('shopify_connections');
  },
};
