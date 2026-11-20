'use strict';

/** Optional favorite flag on master products (shown first after client import). */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('master_products');
    if (table.is_favorite) return;
    await queryInterface.addColumn('master_products', 'is_favorite', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('master_products');
    if (!table.is_favorite) return;
    await queryInterface.removeColumn('master_products', 'is_favorite');
  },
};
