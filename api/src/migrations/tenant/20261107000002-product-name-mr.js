'use strict';

const { DataTypes } = require('sequelize');

/** Optional Marathi product name, used on Marathi bills. */
module.exports = {
  async up(queryInterface) {
    const table = await queryInterface.describeTable('products');
    if (table.name_mr) return;
    await queryInterface.addColumn('products', 'name_mr', {
      type: DataTypes.STRING(200),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('products');
    if (!table.name_mr) return;
    await queryInterface.removeColumn('products', 'name_mr');
  },
};
