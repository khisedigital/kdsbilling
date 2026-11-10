'use strict';

const { DataTypes } = require('sequelize');

/** Optional Marathi names for shop categories and brands. */
module.exports = {
  async up(queryInterface) {
    const categories = await queryInterface.describeTable('categories');
    if (!categories.name_mr) {
      await queryInterface.addColumn('categories', 'name_mr', {
        type: DataTypes.STRING(150),
        allowNull: true,
      });
    }
    const brands = await queryInterface.describeTable('brands');
    if (!brands.name_mr) {
      await queryInterface.addColumn('brands', 'name_mr', {
        type: DataTypes.STRING(150),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const categories = await queryInterface.describeTable('categories');
    if (categories.name_mr) await queryInterface.removeColumn('categories', 'name_mr');
    const brands = await queryInterface.describeTable('brands');
    if (brands.name_mr) await queryInterface.removeColumn('brands', 'name_mr');
  },
};
