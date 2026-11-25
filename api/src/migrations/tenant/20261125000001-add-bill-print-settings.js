'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('branches', 'show_logo', {
      type: Sequelize.BOOLEAN,
      defaultValue: true,
      allowNull: false,
      after: 'logo_url',
    });
    await queryInterface.addColumn('branches', 'bill_qr_code_type', {
      type: Sequelize.ENUM('none', 'upi', 'bill', 'both'),
      defaultValue: 'none',
      allowNull: false,
      after: 'show_logo',
    });
    await queryInterface.addColumn('branches', 'enable_payment_qr', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      after: 'bill_qr_code_type',
    });
    await queryInterface.addColumn('branches', 'payment_qr_upi_id', {
      type: Sequelize.STRING(255),
      allowNull: true,
      after: 'enable_payment_qr',
    });
    await queryInterface.addColumn('branches', 'secondary_phone', {
      type: Sequelize.STRING(20),
      allowNull: true,
      after: 'phone',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('branches', 'payment_qr_upi_id');
    await queryInterface.removeColumn('branches', 'enable_payment_qr');
    await queryInterface.removeColumn('branches', 'bill_qr_code_type');
    await queryInterface.removeColumn('branches', 'show_logo');
    await queryInterface.removeColumn('branches', 'secondary_phone');
  },
};
