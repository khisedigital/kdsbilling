'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Track cumulative returned qty on original sale lines (sold qty stays unchanged).
    await queryInterface.addColumn('sales_order_items', 'returned_quantity', {
      type: Sequelize.DECIMAL(15, 3),
      allowNull: false,
      defaultValue: 0,
      after: 'quantity',
    });

    // Expand bill status for partial / full returns (MySQL ENUM requires MODIFY).
    await queryInterface.sequelize.query(`
      ALTER TABLE sales_orders
      MODIFY COLUMN status ENUM(
        'draft',
        'held',
        'completed',
        'void',
        'partially_returned',
        'fully_returned'
      ) NOT NULL DEFAULT 'completed'
    `);

    await queryInterface.addColumn('returns', 'credit_note_number', {
      type: Sequelize.STRING(30),
      allowNull: true,
      unique: true,
      after: 'return_number',
    });
    await queryInterface.addColumn('returns', 'tax_amount', {
      type: Sequelize.DECIMAL(15, 4),
      allowNull: false,
      defaultValue: 0,
      after: 'subtotal',
    });
    await queryInterface.addColumn('returns', 'discount_amount', {
      type: Sequelize.DECIMAL(15, 4),
      allowNull: false,
      defaultValue: 0,
      after: 'tax_amount',
    });
    await queryInterface.addColumn('returns', 'total_amount', {
      type: Sequelize.DECIMAL(15, 4),
      allowNull: false,
      defaultValue: 0,
      after: 'discount_amount',
    });
    await queryInterface.addColumn('returns', 'refund_mode', {
      type: Sequelize.ENUM('cash', 'store_credit'),
      allowNull: false,
      defaultValue: 'cash',
      after: 'store_credit_amount',
    });

    await queryInterface.addColumn('return_items', 'discount_amount', {
      type: Sequelize.DECIMAL(15, 4),
      allowNull: false,
      defaultValue: 0,
      after: 'unit_price',
    });
    await queryInterface.addColumn('return_items', 'tax_amount', {
      type: Sequelize.DECIMAL(15, 4),
      allowNull: false,
      defaultValue: 0,
      after: 'discount_amount',
    });

    await queryInterface.createTable('return_item_taxes', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      return_item_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'return_items', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      tax_type_code: Sequelize.STRING(20),
      tax_name: Sequelize.STRING(100),
      rate_percent: { type: Sequelize.DECIMAL(8, 4), defaultValue: 0 },
      tax_amount: { type: Sequelize.DECIMAL(15, 4), defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('return_item_taxes', ['return_item_id']);

    // Backfill returned quantities from existing completed returns.
    await queryInterface.sequelize.query(`
      UPDATE sales_order_items soi
      LEFT JOIN (
        SELECT ri.sales_order_item_id AS item_id, SUM(ri.quantity) AS qty
        FROM return_items ri
        INNER JOIN returns r ON r.id = ri.return_id AND r.status = 'completed'
        WHERE ri.sales_order_item_id IS NOT NULL
        GROUP BY ri.sales_order_item_id
      ) x ON x.item_id = soi.id
      SET soi.returned_quantity = COALESCE(x.qty, 0)
    `);

    // Mark bills fully/partially returned from backfilled quantities.
    await queryInterface.sequelize.query(`
      UPDATE sales_orders so
      INNER JOIN (
        SELECT
          sales_order_id,
          SUM(CASE WHEN returned_quantity + 0.0005 >= quantity THEN 1 ELSE 0 END) AS full_lines,
          SUM(CASE WHEN returned_quantity > 0 THEN 1 ELSE 0 END) AS any_lines,
          COUNT(*) AS total_lines
        FROM sales_order_items
        GROUP BY sales_order_id
      ) t ON t.sales_order_id = so.id
      SET so.status = CASE
        WHEN t.any_lines = 0 THEN so.status
        WHEN t.full_lines = t.total_lines THEN 'fully_returned'
        ELSE 'partially_returned'
      END
      WHERE so.status = 'completed'
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('return_item_taxes');
    await queryInterface.removeColumn('return_items', 'tax_amount');
    await queryInterface.removeColumn('return_items', 'discount_amount');
    await queryInterface.removeColumn('returns', 'refund_mode');
    await queryInterface.removeColumn('returns', 'total_amount');
    await queryInterface.removeColumn('returns', 'discount_amount');
    await queryInterface.removeColumn('returns', 'tax_amount');
    await queryInterface.removeColumn('returns', 'credit_note_number');
    await queryInterface.sequelize.query(`
      ALTER TABLE sales_orders
      MODIFY COLUMN status ENUM('draft', 'held', 'completed', 'void')
      NOT NULL DEFAULT 'completed'
    `);
    await queryInterface.removeColumn('sales_order_items', 'returned_quantity');
  },
};
