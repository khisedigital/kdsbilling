'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tenants', 'owner_mobile', {
      type: Sequelize.STRING(20),
      allowNull: true,
      after: 'billing_email',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('tenants', 'owner_mobile');
  },
};
