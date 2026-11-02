'use strict';

const { DataTypes } = require('sequelize');

/** A barcode can stand for a fixed quantity of its variant (e.g. a 500 g pack of a kg product). */
module.exports = {
  async up(queryInterface) {
    const table = await queryInterface.describeTable('barcodes');
    if (table.quantity) return;
    await queryInterface.addColumn('barcodes', 'quantity', {
      type: DataTypes.DECIMAL(12, 4),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('barcodes');
    if (!table.quantity) return;
    await queryInterface.removeColumn('barcodes', 'quantity');
  },
};
