'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('customers', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      name: { type: Sequelize.STRING(150), allowNull: false },
      phone: Sequelize.STRING(20),
      email: Sequelize.STRING(150),
      address: Sequelize.TEXT,
      loyalty_points: { type: Sequelize.DECIMAL(15, 2), defaultValue: 0 },
      store_credit_balance: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      notes: Sequelize.TEXT,
      status: { type: Sequelize.ENUM('active', 'inactive'), defaultValue: 'active' },
      deleted_at: Sequelize.DATE,
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('customer_ledger', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      customer_id: {
        type: Sequelize.UUID, allowNull: false,
        references: { model: 'customers', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      entry_type: {
        type: Sequelize.ENUM('sale', 'payment', 'loyalty_earn', 'loyalty_redeem', 'store_credit_add', 'store_credit_use', 'refund'),
        allowNull: false,
      },
      amount: { type: Sequelize.DECIMAL(15, 4), allowNull: false },
      balance_after: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      reference_type: Sequelize.STRING(50),
      reference_id: Sequelize.UUID,
      notes: Sequelize.TEXT,
      created_by: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' } },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('bill_sequences', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      branch_id: {
        type: Sequelize.UUID, allowNull: false, unique: true,
        references: { model: 'branches', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      date_prefix: { type: Sequelize.STRING(8), allowNull: false },
      last_sequence: { type: Sequelize.INTEGER, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('sales_orders', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      bill_number: { type: Sequelize.STRING(30), allowNull: false, unique: true },
      branch_id: {
        type: Sequelize.UUID, allowNull: false,
        references: { model: 'branches', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT',
      },
      customer_id: {
        type: Sequelize.UUID, allowNull: true,
        references: { model: 'customers', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL',
      },
      status: {
        type: Sequelize.ENUM('draft', 'held', 'completed', 'void'),
        defaultValue: 'completed',
      },
      subtotal: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      discount_amount: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      discount_percent: { type: Sequelize.DECIMAL(8, 4), defaultValue: 0 },
      tax_amount: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      total_amount: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      paid_amount: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      change_amount: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      notes: Sequelize.TEXT,
      held_name: Sequelize.STRING(100),
      created_by: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' } },
      voided_by: Sequelize.UUID,
      void_reason: Sequelize.TEXT,
      voided_at: Sequelize.DATE,
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('sales_orders', ['branch_id', 'created_at']);
    await queryInterface.addIndex('sales_orders', ['status']);

    await queryInterface.createTable('sales_order_items', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      sales_order_id: {
        type: Sequelize.UUID, allowNull: false,
        references: { model: 'sales_orders', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      variant_id: {
        type: Sequelize.UUID, allowNull: false,
        references: { model: 'product_variants', key: 'id' },
      },
      product_name: { type: Sequelize.STRING(200), allowNull: false },
      sku: { type: Sequelize.STRING(50), allowNull: false },
      quantity: { type: Sequelize.DECIMAL(15, 3), allowNull: false },
      unit_price: { type: Sequelize.DECIMAL(15, 4), allowNull: false },
      cost_price: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      discount_amount: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      discount_percent: { type: Sequelize.DECIMAL(8, 4), defaultValue: 0 },
      tax_amount: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      line_total: { type: Sequelize.DECIMAL(15, 4), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('sales_order_item_taxes', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      sales_order_item_id: {
        type: Sequelize.UUID, allowNull: false,
        references: { model: 'sales_order_items', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      tax_type_code: Sequelize.STRING(20),
      tax_name: Sequelize.STRING(100),
      rate_percent: { type: Sequelize.DECIMAL(8, 4), defaultValue: 0 },
      tax_amount: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('sales_payments', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      sales_order_id: {
        type: Sequelize.UUID, allowNull: false,
        references: { model: 'sales_orders', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      payment_mode: {
        type: Sequelize.ENUM('cash', 'upi', 'card', 'credit', 'store_credit'),
        allowNull: false,
      },
      amount: { type: Sequelize.DECIMAL(15, 4), allowNull: false },
      reference_number: Sequelize.STRING(100),
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('held_bills', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      branch_id: {
        type: Sequelize.UUID, allowNull: false,
        references: { model: 'branches', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      name: { type: Sequelize.STRING(100), allowNull: false },
      cart_data: { type: Sequelize.JSON, allowNull: false },
      customer_id: Sequelize.UUID,
      created_by: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' } },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('returns', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      return_number: { type: Sequelize.STRING(30), allowNull: false, unique: true },
      sales_order_id: {
        type: Sequelize.UUID, allowNull: false,
        references: { model: 'sales_orders', key: 'id' },
      },
      branch_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'branches', key: 'id' } },
      customer_id: Sequelize.UUID,
      return_type: { type: Sequelize.ENUM('return', 'exchange'), defaultValue: 'return' },
      subtotal: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      refund_amount: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      store_credit_amount: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      status: { type: Sequelize.ENUM('completed', 'cancelled'), defaultValue: 'completed' },
      notes: Sequelize.TEXT,
      created_by: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' } },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('return_items', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      return_id: {
        type: Sequelize.UUID, allowNull: false,
        references: { model: 'returns', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      sales_order_item_id: Sequelize.UUID,
      variant_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'product_variants', key: 'id' } },
      quantity: { type: Sequelize.DECIMAL(15, 3), allowNull: false },
      unit_price: { type: Sequelize.DECIMAL(15, 4), allowNull: false },
      line_total: { type: Sequelize.DECIMAL(15, 4), allowNull: false },
      restock: { type: Sequelize.BOOLEAN, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('expense_categories', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      name: { type: Sequelize.STRING(100), allowNull: false, unique: true },
      status: { type: Sequelize.ENUM('active', 'inactive'), defaultValue: 'active' },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('expenses', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      branch_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'branches', key: 'id' } },
      category_id: {
        type: Sequelize.UUID, allowNull: false,
        references: { model: 'expense_categories', key: 'id' },
      },
      amount: { type: Sequelize.DECIMAL(15, 4), allowNull: false },
      payment_mode: { type: Sequelize.ENUM('cash', 'upi', 'card', 'bank'), defaultValue: 'cash' },
      expense_date: { type: Sequelize.DATEONLY, allowNull: false },
      notes: Sequelize.TEXT,
      created_by: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' } },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('offers', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      name: { type: Sequelize.STRING(150), allowNull: false },
      offer_type: { type: Sequelize.ENUM('percent_off', 'flat_off'), allowNull: false },
      value: { type: Sequelize.DECIMAL(15, 4), allowNull: false },
      min_purchase: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      status: { type: Sequelize.ENUM('active', 'inactive'), defaultValue: 'active' },
      valid_from: Sequelize.DATEONLY,
      valid_to: Sequelize.DATEONLY,
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('daily_closings', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      branch_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'branches', key: 'id' } },
      closing_date: { type: Sequelize.DATEONLY, allowNull: false },
      opening_cash: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      expected_cash: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      actual_cash: { type: Sequelize.DECIMAL(15, 4), allowNull: false },
      variance: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      total_sales: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      total_expenses: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      notes: Sequelize.TEXT,
      created_by: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' } },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('daily_closings', ['branch_id', 'closing_date'], { unique: true });

    await queryInterface.createTable('printers', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      branch_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'branches', key: 'id' } },
      name: { type: Sequelize.STRING(100), allowNull: false },
      printer_type: { type: Sequelize.ENUM('bluetooth', 'network', 'usb'), defaultValue: 'network' },
      connection_string: Sequelize.STRING(255),
      paper_size: { type: Sequelize.ENUM('58mm', '80mm', 'a4'), defaultValue: '80mm' },
      is_default: { type: Sequelize.BOOLEAN, defaultValue: false },
      status: { type: Sequelize.ENUM('active', 'inactive'), defaultValue: 'active' },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    const tables = [
      'printers', 'daily_closings', 'offers', 'expenses', 'expense_categories',
      'return_items', 'returns', 'held_bills', 'sales_payments',
      'sales_order_item_taxes', 'sales_order_items', 'sales_orders',
      'bill_sequences', 'customer_ledger', 'customers',
    ];
    for (const t of tables) await queryInterface.dropTable(t);
  },
};
