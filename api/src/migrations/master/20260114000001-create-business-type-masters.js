'use strict';

const { v4: uuidv4 } = require('uuid');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('business_types', {
      id: { type: Sequelize.UUID, primaryKey: true },
      code: { type: Sequelize.STRING(50), allowNull: false, unique: true },
      name: { type: Sequelize.STRING(100), allowNull: false },
      description: { type: Sequelize.TEXT },
      status: { type: Sequelize.ENUM('active', 'inactive'), defaultValue: 'active' },
      sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('master_categories', {
      id: { type: Sequelize.UUID, primaryKey: true },
      business_type_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'business_types', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      name: { type: Sequelize.STRING(150), allowNull: false },
      description: { type: Sequelize.TEXT },
      status: { type: Sequelize.ENUM('active', 'inactive'), defaultValue: 'active' },
      sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('master_categories', ['business_type_id', 'name'], {
      unique: true,
      name: 'master_categories_business_type_name',
    });

    await queryInterface.createTable('master_products', {
      id: { type: Sequelize.UUID, primaryKey: true },
      business_type_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'business_types', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      category_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'master_categories', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      name: { type: Sequelize.STRING(200), allowNull: false },
      description: { type: Sequelize.TEXT },
      uom_code: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'pcs' },
      selling_price: { type: Sequelize.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
      cost_price: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      mrp: { type: Sequelize.DECIMAL(15, 4) },
      sku: { type: Sequelize.STRING(50) },
      barcode: { type: Sequelize.STRING(50) },
      status: { type: Sequelize.ENUM('active', 'inactive'), defaultValue: 'active' },
      sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addColumn('tenants', 'business_type_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'business_types', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      after: 'status',
    });

    const now = new Date();
    const kiranaId = uuidv4();
    const restaurantId = uuidv4();
    const groceryId = uuidv4();
    const bevId = uuidv4();
    const foodId = uuidv4();

    await queryInterface.bulkInsert('business_types', [
      { id: kiranaId, code: 'kirana', name: 'Kirana / Grocery Store', description: 'General grocery and daily needs shop', status: 'active', sort_order: 1, created_at: now, updated_at: now },
      { id: restaurantId, code: 'restaurant', name: 'Restaurant / Cafe', description: 'Food service business', status: 'active', sort_order: 2, created_at: now, updated_at: now },
    ]);

    await queryInterface.bulkInsert('master_categories', [
      { id: groceryId, business_type_id: kiranaId, name: 'Grocery', description: 'Staples and packaged goods', status: 'active', sort_order: 1, created_at: now, updated_at: now },
      { id: bevId, business_type_id: kiranaId, name: 'Beverages', description: 'Drinks and juices', status: 'active', sort_order: 2, created_at: now, updated_at: now },
      { id: foodId, business_type_id: restaurantId, name: 'Food Items', description: 'Menu food items', status: 'active', sort_order: 1, created_at: now, updated_at: now },
    ]);

    await queryInterface.bulkInsert('master_products', [
      { id: uuidv4(), business_type_id: kiranaId, category_id: groceryId, name: 'Rice 1kg', description: 'Basmati rice', uom_code: 'kg', selling_price: 60, cost_price: 50, mrp: 65, sku: 'KIR-RICE-1KG', barcode: '8901001001001', status: 'active', sort_order: 1, created_at: now, updated_at: now },
      { id: uuidv4(), business_type_id: kiranaId, category_id: groceryId, name: 'Sugar 1kg', description: 'White sugar', uom_code: 'kg', selling_price: 45, cost_price: 38, mrp: 50, sku: 'KIR-SUGAR-1KG', barcode: '8901001001002', status: 'active', sort_order: 2, created_at: now, updated_at: now },
      { id: uuidv4(), business_type_id: kiranaId, category_id: groceryId, name: 'Cooking Oil 1L', description: 'Sunflower oil', uom_code: 'ltr', selling_price: 120, cost_price: 100, mrp: 135, sku: 'KIR-OIL-1L', barcode: '8901001001003', status: 'active', sort_order: 3, created_at: now, updated_at: now },
      { id: uuidv4(), business_type_id: kiranaId, category_id: bevId, name: 'Cola 600ml', description: 'Soft drink', uom_code: 'pcs', selling_price: 35, cost_price: 28, mrp: 40, sku: 'KIR-COLA-600', barcode: '8901001001004', status: 'active', sort_order: 4, created_at: now, updated_at: now },
      { id: uuidv4(), business_type_id: restaurantId, category_id: foodId, name: 'Masala Dosa', description: 'South Indian breakfast', uom_code: 'pcs', selling_price: 80, cost_price: 45, mrp: 90, sku: 'RST-DOSA', barcode: null, status: 'active', sort_order: 1, created_at: now, updated_at: now },
      { id: uuidv4(), business_type_id: restaurantId, category_id: foodId, name: 'Veg Thali', description: 'Full meal plate', uom_code: 'pcs', selling_price: 150, cost_price: 90, mrp: 180, sku: 'RST-THALI', barcode: null, status: 'active', sort_order: 2, created_at: now, updated_at: now },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('tenants', 'business_type_id');
    await queryInterface.dropTable('master_products');
    await queryInterface.dropTable('master_categories');
    await queryInterface.dropTable('business_types');
  },
};
