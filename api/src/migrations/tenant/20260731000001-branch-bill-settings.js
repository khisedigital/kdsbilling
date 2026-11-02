'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('branches', 'phone', {
      type: Sequelize.STRING(20),
      allowNull: true,
      after: 'tax_registration_number',
    });
    await queryInterface.addColumn('branches', 'bill_footer', {
      type: Sequelize.STRING(255),
      allowNull: true,
      after: 'phone',
    });
    await queryInterface.addColumn('branches', 'logo_url', {
      type: Sequelize.STRING(500),
      allowNull: true,
      after: 'bill_footer',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('branches', 'logo_url');
    await queryInterface.removeColumn('branches', 'bill_footer');
    await queryInterface.removeColumn('branches', 'phone');
  },
};
