'use strict';

/** Pack sizes and barcodes for a master product, matching the shop product shape. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const products = await queryInterface.describeTable('master_products');
    if (!products.name_mr) {
      await queryInterface.addColumn('master_products', 'name_mr', {
        type: Sequelize.STRING(200),
        allowNull: true,
      });
    }

    const tables = await queryInterface.showAllTables();
    const names = tables.map((table) => (typeof table === 'string' ? table : table.tableName || table.TABLE_NAME));
    if (!names.includes('master_product_variants')) {
      await queryInterface.createTable('master_product_variants', {
        id: { type: Sequelize.UUID, primaryKey: true },
        master_product_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'master_products', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        size: { type: Sequelize.STRING(30), allowNull: true },
        selling_price: { type: Sequelize.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
        mrp: { type: Sequelize.DECIMAL(15, 4), allowNull: true },
        sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('master_product_variants', ['master_product_id'], {
        name: 'master_product_variants_product',
      });
    }

    if (!names.includes('master_variant_barcodes')) {
      await queryInterface.createTable('master_variant_barcodes', {
        id: { type: Sequelize.UUID, primaryKey: true },
        variant_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'master_product_variants', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        barcode: { type: Sequelize.STRING(50), allowNull: false },
        is_primary: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('master_variant_barcodes', ['barcode'], {
        name: 'master_variant_barcodes_barcode',
      });
      await queryInterface.addIndex('master_variant_barcodes', ['variant_id'], {
        name: 'master_variant_barcodes_variant',
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('master_variant_barcodes');
    await queryInterface.dropTable('master_product_variants');
    await queryInterface.removeColumn('master_products', 'name_mr');
  },
};
