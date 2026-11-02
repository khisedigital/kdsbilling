'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('suppliers', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      name: { type: Sequelize.STRING(150), allowNull: false },
      phone: Sequelize.STRING(20),
      email: Sequelize.STRING(150),
      address: Sequelize.TEXT,
      tax_number: Sequelize.STRING(50),
      status: {
        type: Sequelize.ENUM('active', 'inactive'),
        defaultValue: 'active',
      },
      deleted_at: Sequelize.DATE,
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('stock_balances', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      branch_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'branches', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      variant_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'product_variants', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      quantity: {
        type: Sequelize.DECIMAL(15, 3),
        allowNull: false,
        defaultValue: 0,
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('stock_balances', ['branch_id', 'variant_id'], { unique: true });

    await queryInterface.createTable('stock_ledger', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      branch_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'branches', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      variant_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'product_variants', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      movement_type: {
        type: Sequelize.ENUM(
          'OPENING',
          'PURCHASE_IN',
          'STOCK_IN',
          'STOCK_OUT',
          'ADJUSTMENT',
          'TRANSFER_IN',
          'TRANSFER_OUT',
          'DAMAGE',
          'SALE'
        ),
        allowNull: false,
      },
      quantity_change: { type: Sequelize.DECIMAL(15, 3), allowNull: false },
      balance_after: { type: Sequelize.DECIMAL(15, 3), allowNull: false },
      reference_type: Sequelize.STRING(50),
      reference_id: Sequelize.UUID,
      related_branch_id: Sequelize.UUID,
      unit_cost: Sequelize.DECIMAL(15, 4),
      notes: Sequelize.TEXT,
      created_by: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('stock_ledger', ['branch_id', 'variant_id']);
    await queryInterface.addIndex('stock_ledger', ['movement_type']);
    await queryInterface.addIndex('stock_ledger', ['created_at']);

    await queryInterface.createTable('purchase_orders', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      po_number: { type: Sequelize.STRING(30), allowNull: false, unique: true },
      supplier_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'suppliers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      branch_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'branches', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      status: {
        type: Sequelize.ENUM('draft', 'ordered', 'partial', 'received', 'cancelled'),
        defaultValue: 'draft',
      },
      order_date: { type: Sequelize.DATEONLY, allowNull: false },
      expected_date: Sequelize.DATEONLY,
      notes: Sequelize.TEXT,
      created_by: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('purchase_order_items', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      purchase_order_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'purchase_orders', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      variant_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'product_variants', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      quantity: { type: Sequelize.DECIMAL(15, 3), allowNull: false },
      unit_cost: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      received_qty: { type: Sequelize.DECIMAL(15, 3), defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('purchase_bills', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      bill_number: { type: Sequelize.STRING(30), allowNull: false, unique: true },
      supplier_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'suppliers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      branch_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'branches', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      purchase_order_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'purchase_orders', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      bill_date: { type: Sequelize.DATEONLY, allowNull: false },
      subtotal: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      tax_amount: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      total_amount: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      notes: Sequelize.TEXT,
      status: {
        type: Sequelize.ENUM('draft', 'confirmed', 'cancelled'),
        defaultValue: 'confirmed',
      },
      created_by: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('purchase_bill_items', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      purchase_bill_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'purchase_bills', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      variant_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'product_variants', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      quantity: { type: Sequelize.DECIMAL(15, 3), allowNull: false },
      unit_cost: { type: Sequelize.DECIMAL(15, 4), allowNull: false },
      tax_amount: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      total_amount: { type: Sequelize.DECIMAL(15, 4), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('stock_transfers', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      transfer_number: { type: Sequelize.STRING(30), allowNull: false, unique: true },
      from_branch_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'branches', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      to_branch_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'branches', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      status: {
        type: Sequelize.ENUM('draft', 'completed', 'cancelled'),
        defaultValue: 'completed',
      },
      notes: Sequelize.TEXT,
      created_by: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      completed_at: Sequelize.DATE,
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('stock_transfer_items', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      stock_transfer_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'stock_transfers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      variant_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'product_variants', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      quantity: { type: Sequelize.DECIMAL(15, 3), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('stock_transfer_items');
    await queryInterface.dropTable('stock_transfers');
    await queryInterface.dropTable('purchase_bill_items');
    await queryInterface.dropTable('purchase_bills');
    await queryInterface.dropTable('purchase_order_items');
    await queryInterface.dropTable('purchase_orders');
    await queryInterface.dropTable('stock_ledger');
    await queryInterface.dropTable('stock_balances');
    await queryInterface.dropTable('suppliers');
  },
};
