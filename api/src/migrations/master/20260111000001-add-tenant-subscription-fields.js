'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tenants', 'plan', {
      type: Sequelize.ENUM('free', 'basic', 'standard', 'premium', 'enterprise'),
      defaultValue: 'basic',
      after: 'status',
    });
    await queryInterface.addColumn('tenants', 'trial_ends_at', {
      type: Sequelize.DATE,
      allowNull: true,
      after: 'plan',
    });
    await queryInterface.addColumn('tenants', 'subscription_ends_at', {
      type: Sequelize.DATE,
      allowNull: true,
      after: 'trial_ends_at',
    });
    await queryInterface.addColumn('tenants', 'billing_email', {
      type: Sequelize.STRING(150),
      allowNull: true,
      after: 'subscription_ends_at',
    });
    await queryInterface.addColumn('tenants', 'notes', {
      type: Sequelize.TEXT,
      allowNull: true,
      after: 'billing_email',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('tenants', 'notes');
    await queryInterface.removeColumn('tenants', 'billing_email');
    await queryInterface.removeColumn('tenants', 'subscription_ends_at');
    await queryInterface.removeColumn('tenants', 'trial_ends_at');
    await queryInterface.removeColumn('tenants', 'plan');
  },
};
