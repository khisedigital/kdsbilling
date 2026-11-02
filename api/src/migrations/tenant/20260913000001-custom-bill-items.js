'use strict';

const { DataTypes } = require('sequelize');

/** Allow bill lines without a catalog variant (custom / open-price items). */
module.exports = {
  async up(queryInterface) {
    const table = await queryInterface.describeTable('sales_order_items');
    if (!table.variant_id || table.variant_id.allowNull === true) return;

    const [fks] = await queryInterface.sequelize.query(
      "SELECT CONSTRAINT_NAME AS name FROM information_schema.KEY_COLUMN_USAGE " +
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_order_items' " +
        "AND COLUMN_NAME = 'variant_id' AND REFERENCED_TABLE_NAME IS NOT NULL"
    );
    for (const row of fks || []) {
      try {
        await queryInterface.removeConstraint('sales_order_items', row.name);
      } catch (_) {}
    }

    await queryInterface.changeColumn('sales_order_items', 'variant_id', {
      type: DataTypes.CHAR(36),
      allowNull: true,
    });

    try {
      await queryInterface.addConstraint('sales_order_items', {
        fields: ['variant_id'],
        type: 'foreign key',
        name: 'sales_order_items_variant_id_fkey',
        references: { table: 'product_variants', field: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
    } catch (_) {}
  },

  async down(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(
      'SELECT COUNT(*) AS cnt FROM sales_order_items WHERE variant_id IS NULL'
    );
    if (Number(rows?.[0]?.cnt || 0) > 0) {
      throw new Error('Cannot revert: custom bill lines with null variant_id exist');
    }
    try {
      await queryInterface.removeConstraint('sales_order_items', 'sales_order_items_variant_id_fkey');
    } catch (_) {}
    await queryInterface.changeColumn('sales_order_items', 'variant_id', {
      type: DataTypes.CHAR(36),
      allowNull: false,
    });
  },
};
