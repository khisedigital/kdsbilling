'use strict';

/** Optional Marathi name on master products (search + import). */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('master_products');
    if (table.name_mr) return;
    await queryInterface.addColumn('master_products', 'name_mr', {
      type: Sequelize.STRING(200),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('master_products');
    if (!table.name_mr) return;
    await queryInterface.removeColumn('master_products', 'name_mr');
  },
};
