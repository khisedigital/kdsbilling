'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tenants', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      slug: {
        type: Sequelize.STRING(100),
        allowNull: false,
        unique: true,
      },
      status: {
        type: Sequelize.ENUM('active', 'trial', 'suspended', 'deleted'),
        defaultValue: 'trial',
      },
      db_host: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      db_port: {
        type: Sequelize.INTEGER,
        defaultValue: 3306,
      },
      db_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
        unique: true,
      },
      db_user: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      db_password: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      country_code: {
        type: Sequelize.STRING(2),
        defaultValue: 'IN',
      },
      timezone: {
        type: Sequelize.STRING(50),
        defaultValue: 'Asia/Kolkata',
      },
      currency_code: {
        type: Sequelize.STRING(3),
        defaultValue: 'INR',
      },
      max_branches: {
        type: Sequelize.INTEGER,
        defaultValue: 5,
      },
      max_users: {
        type: Sequelize.INTEGER,
        defaultValue: 20,
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

    await queryInterface.createTable('tenant_user_index', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      tenant_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      email: {
        type: Sequelize.STRING(150),
        allowNull: true,
      },
      phone: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive'),
        defaultValue: 'active',
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

    await queryInterface.addIndex('tenant_user_index', ['tenant_id', 'email']);
    await queryInterface.addIndex('tenant_user_index', ['tenant_id', 'phone']);

    await queryInterface.createTable('platform_audit_logs', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      action: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      tenant_id: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      metadata: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      ip_address: {
        type: Sequelize.STRING(45),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('platform_audit_logs');
    await queryInterface.dropTable('tenant_user_index');
    await queryInterface.dropTable('tenants');
  },
};
