'use strict';

const { DataTypes } = require('sequelize');

/** Extra closing snapshot (denominations, payment split, reasons) as JSON text. */
module.exports = {
  async up(queryInterface) {
    const table = await queryInterface.describeTable('daily_closings');
    if (table.details) return;
    await queryInterface.addColumn('daily_closings', 'details', {
      type: DataTypes.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('daily_closings');
    if (!table.details) return;
    await queryInterface.removeColumn('daily_closings', 'details');
  },
};
