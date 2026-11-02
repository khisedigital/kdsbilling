'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tax_jurisdictions', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      country_code: { type: Sequelize.STRING(2), allowNull: false },
      region_code: { type: Sequelize.STRING(10), allowNull: true },
      name: { type: Sequelize.STRING(100), allowNull: false },
      status: {
        type: Sequelize.ENUM('active', 'inactive'),
        defaultValue: 'active',
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('tax_types', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      code: { type: Sequelize.STRING(20), allowNull: false, unique: true },
      name: { type: Sequelize.STRING(100), allowNull: false },
      is_compound: { type: Sequelize.BOOLEAN, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('tax_groups', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      jurisdiction_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'tax_jurisdictions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      name: { type: Sequelize.STRING(100), allowNull: false },
      total_rate: { type: Sequelize.DECIMAL(8, 4), defaultValue: 0 },
      status: {
        type: Sequelize.ENUM('active', 'inactive'),
        defaultValue: 'active',
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('tax_group_components', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      tax_group_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'tax_groups', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      tax_type_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'tax_types', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      rate_percent: { type: Sequelize.DECIMAL(8, 4), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('categories', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      name: { type: Sequelize.STRING(150), allowNull: false },
      parent_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'categories', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      description: Sequelize.TEXT,
      status: {
        type: Sequelize.ENUM('active', 'inactive'),
        defaultValue: 'active',
      },
      deleted_at: Sequelize.DATE,
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('brands', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      name: { type: Sequelize.STRING(150), allowNull: false, unique: true },
      description: Sequelize.TEXT,
      status: {
        type: Sequelize.ENUM('active', 'inactive'),
        defaultValue: 'active',
      },
      deleted_at: Sequelize.DATE,
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('products', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      name: { type: Sequelize.STRING(200), allowNull: false },
      description: Sequelize.TEXT,
      category_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'categories', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      brand_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'brands', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      uom_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'units_of_measure', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      tax_group_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'tax_groups', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      tax_code: Sequelize.STRING(30),
      is_weight_based: { type: Sequelize.BOOLEAN, defaultValue: false },
      allow_decimal_qty: { type: Sequelize.BOOLEAN, defaultValue: false },
      has_variants: { type: Sequelize.BOOLEAN, defaultValue: false },
      status: {
        type: Sequelize.ENUM('active', 'inactive'),
        defaultValue: 'active',
      },
      deleted_at: Sequelize.DATE,
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('product_variants', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      product_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'products', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      sku: { type: Sequelize.STRING(50), allowNull: false, unique: true },
      size: Sequelize.STRING(30),
      color: Sequelize.STRING(50),
      cost_price: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      selling_price: { type: Sequelize.DECIMAL(15, 4), allowNull: false },
      mrp: { type: Sequelize.DECIMAL(15, 4), allowNull: true },
      wholesale_price: { type: Sequelize.DECIMAL(15, 4), allowNull: true },
      uom_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'units_of_measure', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      tax_group_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'tax_groups', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      reorder_level: { type: Sequelize.DECIMAL(15, 3), defaultValue: 0 },
      status: {
        type: Sequelize.ENUM('active', 'inactive'),
        defaultValue: 'active',
      },
      deleted_at: Sequelize.DATE,
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('barcodes', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      variant_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'product_variants', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      barcode: { type: Sequelize.STRING(50), allowNull: false, unique: true },
      is_primary: { type: Sequelize.BOOLEAN, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('product_images', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
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
        allowNull: true,
        references: { model: 'product_variants', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      file_name: { type: Sequelize.STRING(255), allowNull: false },
      file_path: { type: Sequelize.STRING(500), allowNull: false },
      mime_type: Sequelize.STRING(100),
      is_primary: { type: Sequelize.BOOLEAN, defaultValue: false },
      sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('products', ['name']);
    await queryInterface.addIndex('products', ['category_id']);
    await queryInterface.addIndex('products', ['brand_id']);
    await queryInterface.addIndex('product_variants', ['product_id']);
    await queryInterface.addIndex('product_variants', ['sku']);
    await queryInterface.addIndex('barcodes', ['barcode']);
    await queryInterface.addIndex('categories', ['parent_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('product_images');
    await queryInterface.dropTable('barcodes');
    await queryInterface.dropTable('product_variants');
    await queryInterface.dropTable('products');
    await queryInterface.dropTable('brands');
    await queryInterface.dropTable('categories');
    await queryInterface.dropTable('tax_group_components');
    await queryInterface.dropTable('tax_groups');
    await queryInterface.dropTable('tax_types');
    await queryInterface.dropTable('tax_jurisdictions');
  },
};
