'use strict';

const { v4: uuidv4 } = require('uuid');

const DEFAULT_PLANS = [
  {
    id: uuidv4(),
    code: 'trial-14',
    name: 'Trial (14 Days)',
    description: 'Free trial for new shops',
    max_branches: 1,
    max_users: 3,
    is_trial: true,
    trial_days: 14,
    allowed_subscription_years: JSON.stringify([]),
    sort_order: 1,
  },
  {
    id: uuidv4(),
    code: 'trial-30',
    name: 'Trial (30 Days)',
    description: 'Extended trial for new shops',
    max_branches: 2,
    max_users: 5,
    is_trial: true,
    trial_days: 30,
    allowed_subscription_years: JSON.stringify([]),
    sort_order: 2,
  },
  {
    id: uuidv4(),
    code: 'basic',
    name: 'Basic',
    description: 'Small single-branch shops',
    max_branches: 2,
    max_users: 5,
    is_trial: false,
    trial_days: null,
    allowed_subscription_years: JSON.stringify([1, 2]),
    sort_order: 3,
  },
  {
    id: uuidv4(),
    code: 'standard',
    name: 'Standard',
    description: 'Growing businesses with multiple branches',
    max_branches: 5,
    max_users: 20,
    is_trial: false,
    trial_days: null,
    allowed_subscription_years: JSON.stringify([1, 2, 3]),
    sort_order: 4,
  },
  {
    id: uuidv4(),
    code: 'premium',
    name: 'Premium',
    description: 'Large retailers',
    max_branches: 10,
    max_users: 50,
    is_trial: false,
    trial_days: null,
    allowed_subscription_years: JSON.stringify([1, 2, 3, 5]),
    sort_order: 5,
  },
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('subscription_plans', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
      },
      code: {
        type: Sequelize.STRING(50),
        allowNull: false,
        unique: true,
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      max_branches: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      max_users: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 5,
      },
      is_trial: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      trial_days: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      allowed_subscription_years: {
        type: Sequelize.JSON,
        allowNull: false,
      },
      price_monthly: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
      },
      price_yearly: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive'),
        defaultValue: 'active',
      },
      sort_order: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    const now = new Date();
    await queryInterface.bulkInsert(
      'subscription_plans',
      DEFAULT_PLANS.map((p) => ({
        ...p,
        status: 'active',
        created_at: now,
        updated_at: now,
      }))
    );

    const [planRows] = await queryInterface.sequelize.query(
      'SELECT id, code FROM subscription_plans'
    );
    const planByCode = Object.fromEntries(planRows.map((r) => [r.code, r.id]));

    await queryInterface.addColumn('tenants', 'plan_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'subscription_plans', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      after: 'status',
    });

    await queryInterface.addColumn('tenants', 'subscription_years', {
      type: Sequelize.INTEGER,
      allowNull: true,
      after: 'plan_id',
    });

    const legacyMap = {
      free: planByCode['trial-14'],
      basic: planByCode.basic,
      standard: planByCode.standard,
      premium: planByCode.premium,
      enterprise: planByCode.premium,
    };

    for (const [legacyPlan, planId] of Object.entries(legacyMap)) {
      if (planId) {
        await queryInterface.sequelize.query(
          'UPDATE tenants SET plan_id = ? WHERE plan = ? AND plan_id IS NULL',
          { replacements: [planId, legacyPlan] }
        );
      }
    }

    await queryInterface.removeColumn('tenants', 'plan');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('tenants', 'plan', {
      type: Sequelize.ENUM('free', 'basic', 'standard', 'premium', 'enterprise'),
      defaultValue: 'basic',
    });
    await queryInterface.removeColumn('tenants', 'subscription_years');
    await queryInterface.removeColumn('tenants', 'plan_id');
    await queryInterface.dropTable('subscription_plans');
  },
};
