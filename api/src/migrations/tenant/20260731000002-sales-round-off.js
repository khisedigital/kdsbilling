'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('sales_orders', 'round_off_amount', {
      type: Sequelize.DECIMAL(15, 4),
      allowNull: false,
      defaultValue: 0,
      after: 'tax_amount',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('sales_orders', 'round_off_amount');
  },
};
