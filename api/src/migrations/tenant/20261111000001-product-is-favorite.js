'use strict';

const { DataTypes } = require('sequelize');

/** Shop favorites — shown first on product list, price management, and billing. */
module.exports = {
  async up(queryInterface) {
    const table = await queryInterface.describeTable('products');
    if (table.is_favorite) return;
    await queryInterface.addColumn('products', 'is_favorite', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('products');
    if (!table.is_favorite) return;
    await queryInterface.removeColumn('products', 'is_favorite');
  },
};
