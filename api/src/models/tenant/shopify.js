const { DataTypes } = require('sequelize');
const { jsonColumn } = require('../../utils/jsonColumn');

function initShopifyModels(sequelize, { Branch, Product, ProductVariant }) {
  const ShopifyConnection = sequelize.define(
    'ShopifyConnection',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      shop_domain: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      shop_name: DataTypes.STRING(255),
      shop_currency: DataTypes.STRING(3),
      status: {
        type: DataTypes.ENUM('pending', 'connected', 'disconnected', 'error'),
        allowNull: false,
        defaultValue: 'pending',
      },
      access_token_enc: DataTypes.TEXT,
      refresh_token_enc: DataTypes.TEXT,
      access_token_expires_at: DataTypes.DATE,
      refresh_token_expires_at: DataTypes.DATE,
      scopes: DataTypes.STRING(500),
      oauth_nonce: DataTypes.STRING(64),
      oauth_requested_at: DataTypes.DATE,
      branch_id: DataTypes.UUID,
      shopify_location_id: DataTypes.STRING(100),
      shopify_location_name: DataTypes.STRING(255),
      webhook_ids: jsonColumn('webhook_ids'),
      product_sync_status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'idle' },
      product_sync_at: DataTypes.DATE,
      product_sync_summary: jsonColumn('product_sync_summary'),
      inventory_sync_status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'idle' },
      inventory_sync_at: DataTypes.DATE,
      order_sync_status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'idle' },
      order_sync_at: DataTypes.DATE,
      last_sync_at: DataTypes.DATE,
      last_error: DataTypes.TEXT,
      last_error_at: DataTypes.DATE,
      connected_by: DataTypes.UUID,
      connected_at: DataTypes.DATE,
      disconnected_at: DataTypes.DATE,
    },
    { tableName: 'shopify_connections' }
  );

  const ShopifyProductMapping = sequelize.define(
    'ShopifyProductMapping',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      connection_id: { type: DataTypes.UUID, allowNull: false },
      product_id: { type: DataTypes.UUID, allowNull: false },
      variant_id: { type: DataTypes.UUID, allowNull: false },
      shopify_product_id: { type: DataTypes.STRING(100), allowNull: false },
      shopify_variant_id: { type: DataTypes.STRING(100), allowNull: false },
      shopify_inventory_item_id: DataTypes.STRING(100),
      inventory_tracked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      sku: DataTypes.STRING(100),
      barcode: DataTypes.STRING(100),
      match_type: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'created' },
      last_shopify_qty: DataTypes.INTEGER,
      last_synced_at: DataTypes.DATE,
      last_error: DataTypes.TEXT,
    },
    { tableName: 'shopify_product_mappings' }
  );

  const ShopifyOrderMapping = sequelize.define(
    'ShopifyOrderMapping',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      connection_id: { type: DataTypes.UUID, allowNull: false },
      shopify_order_id: { type: DataTypes.STRING(100), allowNull: false },
      shopify_order_name: DataTypes.STRING(50),
      financial_status: DataTypes.STRING(40),
      fulfillment_status: DataTypes.STRING(40),
      currency_code: DataTypes.STRING(3),
      total_amount: DataTypes.DECIMAL(15, 4),
      item_count: DataTypes.INTEGER,
      line_items: jsonColumn('line_items'),
      status: {
        type: DataTypes.ENUM('imported', 'cancelled', 'failed'),
        allowNull: false,
        defaultValue: 'imported',
      },
      error: DataTypes.TEXT,
      shopify_created_at: DataTypes.DATE,
      shopify_cancelled_at: DataTypes.DATE,
      processed_at: DataTypes.DATE,
    },
    { tableName: 'shopify_order_mappings' }
  );

  ShopifyConnection.belongsTo(Branch, { foreignKey: 'branch_id', as: 'branch' });
  ShopifyConnection.hasMany(ShopifyProductMapping, { foreignKey: 'connection_id', as: 'productMappings' });
  ShopifyConnection.hasMany(ShopifyOrderMapping, { foreignKey: 'connection_id', as: 'orderMappings' });
  ShopifyProductMapping.belongsTo(ShopifyConnection, { foreignKey: 'connection_id', as: 'connection' });
  ShopifyProductMapping.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });
  ShopifyProductMapping.belongsTo(ProductVariant, { foreignKey: 'variant_id', as: 'variant' });
  ShopifyOrderMapping.belongsTo(ShopifyConnection, { foreignKey: 'connection_id', as: 'connection' });

  return { ShopifyConnection, ShopifyProductMapping, ShopifyOrderMapping };
}

module.exports = { initShopifyModels };
