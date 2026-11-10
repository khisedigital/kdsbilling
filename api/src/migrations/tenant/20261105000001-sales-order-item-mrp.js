'use strict';

const { DataTypes } = require('sequelize');

/** Snapshot MRP on each bill line so receipt savings stay correct after catalog edits. */
module.exports = {
  async up(queryInterface) {
    const table = await queryInterface.describeTable('sales_order_items');
    if (table.mrp) return;
    await queryInterface.addColumn('sales_order_items', 'mrp', {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('sales_order_items');
    if (!table.mrp) return;
    await queryInterface.removeColumn('sales_order_items', 'mrp');
  },
};
