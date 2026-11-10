'use strict';

const { DataTypes } = require('sequelize');

/** Optional Marathi shop name and address for bills printed in Marathi. */
module.exports = {
  async up(queryInterface) {
    const table = await queryInterface.describeTable('branches');
    if (!table.name_mr) {
      await queryInterface.addColumn('branches', 'name_mr', {
        type: DataTypes.STRING(150),
        allowNull: true,
      });
    }
    if (!table.address_mr) {
      await queryInterface.addColumn('branches', 'address_mr', {
        type: DataTypes.TEXT,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('branches');
    if (table.address_mr) await queryInterface.removeColumn('branches', 'address_mr');
    if (table.name_mr) await queryInterface.removeColumn('branches', 'name_mr');
  },
};
