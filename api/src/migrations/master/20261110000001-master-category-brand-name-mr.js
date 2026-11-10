'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const categories = await queryInterface.describeTable('master_categories');
    if (!categories.name_mr) {
      await queryInterface.addColumn('master_categories', 'name_mr', {
        type: Sequelize.STRING(150),
        allowNull: true,
      });
    }

    const brands = await queryInterface.describeTable('master_brands');
    if (!brands.name_mr) {
      await queryInterface.addColumn('master_brands', 'name_mr', {
        type: Sequelize.STRING(150),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const categories = await queryInterface.describeTable('master_categories');
    if (categories.name_mr) {
      await queryInterface.removeColumn('master_categories', 'name_mr');
    }
    const brands = await queryInterface.describeTable('master_brands');
    if (brands.name_mr) {
      await queryInterface.removeColumn('master_brands', 'name_mr');
    }
  },
};
