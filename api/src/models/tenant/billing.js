const { DataTypes } = require('sequelize');

function initBillingModels(sequelize, refs) {
  const { Branch, User, ProductVariant } = refs;

  const CustomerModel = sequelize.define('Customer', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING(150), allowNull: false },
    phone: DataTypes.STRING(20),
    email: DataTypes.STRING(150),
    address: DataTypes.TEXT,
    loyalty_points: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    store_credit_balance: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    notes: DataTypes.TEXT,
    status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
    deleted_at: DataTypes.DATE,
  }, { tableName: 'customers', paranoid: false });

  const CustomerLedger = sequelize.define('CustomerLedger', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    customer_id: { type: DataTypes.UUID, allowNull: false },
    entry_type: {
      type: DataTypes.ENUM('sale', 'payment', 'loyalty_earn', 'loyalty_redeem', 'store_credit_add', 'store_credit_use', 'refund'),
      allowNull: false,
    },
    amount: { type: DataTypes.DECIMAL(15, 4), allowNull: false },
    balance_after: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    reference_type: DataTypes.STRING(50),
    reference_id: DataTypes.UUID,
    notes: DataTypes.TEXT,
    created_by: { type: DataTypes.UUID, allowNull: false },
  }, { tableName: 'customer_ledger' });

  const BillSequence = sequelize.define('BillSequence', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    branch_id: { type: DataTypes.UUID, allowNull: false, unique: true },
    date_prefix: { type: DataTypes.STRING(8), allowNull: false },
    last_sequence: { type: DataTypes.INTEGER, defaultValue: 0 },
  }, { tableName: 'bill_sequences' });

  const SalesOrder = sequelize.define('SalesOrder', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    bill_number: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    branch_id: { type: DataTypes.UUID, allowNull: false },
    customer_id: DataTypes.UUID,
    status: {
      type: DataTypes.ENUM('draft', 'held', 'completed', 'void', 'partially_returned', 'fully_returned'),
      defaultValue: 'completed',
    },
    subtotal: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    discount_amount: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    discount_percent: { type: DataTypes.DECIMAL(8, 4), defaultValue: 0 },
    tax_amount: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    round_off_amount: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    total_amount: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    paid_amount: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    change_amount: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    notes: DataTypes.TEXT,
    held_name: DataTypes.STRING(100),
    created_by: { type: DataTypes.UUID, allowNull: false },
    voided_by: DataTypes.UUID,
    void_reason: DataTypes.TEXT,
    voided_at: DataTypes.DATE,
  }, { tableName: 'sales_orders' });

  const SalesOrderItem = sequelize.define('SalesOrderItem', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    sales_order_id: { type: DataTypes.UUID, allowNull: false },
    variant_id: { type: DataTypes.UUID, allowNull: true },
    product_name: { type: DataTypes.STRING(200), allowNull: false },
    sku: { type: DataTypes.STRING(50), allowNull: false },
    quantity: { type: DataTypes.DECIMAL(15, 3), allowNull: false },
    returned_quantity: { type: DataTypes.DECIMAL(15, 3), defaultValue: 0 },
    unit_price: { type: DataTypes.DECIMAL(15, 4), allowNull: false },
    mrp: { type: DataTypes.DECIMAL(15, 4), allowNull: true, defaultValue: null },
    cost_price: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    discount_amount: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    discount_percent: { type: DataTypes.DECIMAL(8, 4), defaultValue: 0 },
    tax_amount: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    line_total: { type: DataTypes.DECIMAL(15, 4), allowNull: false },
  }, { tableName: 'sales_order_items' });

  const SalesOrderItemTax = sequelize.define('SalesOrderItemTax', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    sales_order_item_id: { type: DataTypes.UUID, allowNull: false },
    tax_type_code: DataTypes.STRING(20),
    tax_name: DataTypes.STRING(100),
    rate_percent: { type: DataTypes.DECIMAL(8, 4), defaultValue: 0 },
    tax_amount: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
  }, { tableName: 'sales_order_item_taxes' });

  const SalesPayment = sequelize.define('SalesPayment', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    sales_order_id: { type: DataTypes.UUID, allowNull: false },
    payment_mode: { type: DataTypes.ENUM('cash', 'upi', 'card', 'credit', 'store_credit'), allowNull: false },
    amount: { type: DataTypes.DECIMAL(15, 4), allowNull: false },
    reference_number: DataTypes.STRING(100),
  }, { tableName: 'sales_payments' });

  const HeldBill = sequelize.define('HeldBill', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    branch_id: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING(100), allowNull: false },
    cart_data: { type: DataTypes.JSON, allowNull: false },
    customer_id: DataTypes.UUID,
    created_by: { type: DataTypes.UUID, allowNull: false },
  }, { tableName: 'held_bills' });

  const Return = sequelize.define('Return', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    return_number: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    credit_note_number: { type: DataTypes.STRING(30), unique: true },
    sales_order_id: { type: DataTypes.UUID, allowNull: false },
    branch_id: { type: DataTypes.UUID, allowNull: false },
    customer_id: DataTypes.UUID,
    return_type: { type: DataTypes.ENUM('return', 'exchange'), defaultValue: 'return' },
    subtotal: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    tax_amount: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    discount_amount: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    total_amount: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    refund_amount: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    store_credit_amount: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    refund_mode: { type: DataTypes.ENUM('cash', 'store_credit'), defaultValue: 'cash' },
    status: { type: DataTypes.ENUM('completed', 'cancelled'), defaultValue: 'completed' },
    notes: DataTypes.TEXT,
    created_by: { type: DataTypes.UUID, allowNull: false },
  }, { tableName: 'returns' });

  const ReturnItem = sequelize.define('ReturnItem', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    return_id: { type: DataTypes.UUID, allowNull: false },
    sales_order_item_id: DataTypes.UUID,
    variant_id: { type: DataTypes.UUID, allowNull: true },
    quantity: { type: DataTypes.DECIMAL(15, 3), allowNull: false },
    unit_price: { type: DataTypes.DECIMAL(15, 4), allowNull: false },
    discount_amount: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    tax_amount: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    line_total: { type: DataTypes.DECIMAL(15, 4), allowNull: false },
    restock: { type: DataTypes.BOOLEAN, defaultValue: true },
  }, { tableName: 'return_items' });

  const ReturnItemTax = sequelize.define('ReturnItemTax', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    return_item_id: { type: DataTypes.UUID, allowNull: false },
    tax_type_code: DataTypes.STRING(20),
    tax_name: DataTypes.STRING(100),
    rate_percent: { type: DataTypes.DECIMAL(8, 4), defaultValue: 0 },
    tax_amount: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
  }, { tableName: 'return_item_taxes' });

  const ExpenseCategory = sequelize.define('ExpenseCategory', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
  }, { tableName: 'expense_categories' });

  const Expense = sequelize.define('Expense', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    branch_id: { type: DataTypes.UUID, allowNull: false },
    category_id: { type: DataTypes.UUID, allowNull: false },
    amount: { type: DataTypes.DECIMAL(15, 4), allowNull: false },
    payment_mode: { type: DataTypes.ENUM('cash', 'upi', 'card', 'bank'), defaultValue: 'cash' },
    expense_date: { type: DataTypes.DATEONLY, allowNull: false },
    notes: DataTypes.TEXT,
    created_by: { type: DataTypes.UUID, allowNull: false },
  }, { tableName: 'expenses' });

  const Offer = sequelize.define('Offer', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING(150), allowNull: false },
    offer_type: { type: DataTypes.ENUM('percent_off', 'flat_off'), allowNull: false },
    value: { type: DataTypes.DECIMAL(15, 4), allowNull: false },
    min_purchase: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
    valid_from: DataTypes.DATEONLY,
    valid_to: DataTypes.DATEONLY,
  }, { tableName: 'offers' });

  const DailyClosing = sequelize.define('DailyClosing', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    branch_id: { type: DataTypes.UUID, allowNull: false },
    closing_date: { type: DataTypes.DATEONLY, allowNull: false },
    opening_cash: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    expected_cash: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    actual_cash: { type: DataTypes.DECIMAL(15, 4), allowNull: false },
    variance: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    total_sales: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    total_expenses: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    notes: DataTypes.TEXT,
    /** JSON: payments, cash breakdown, denominations, varianceReason, remarks */
    details: DataTypes.TEXT,
    created_by: { type: DataTypes.UUID, allowNull: false },
  }, { tableName: 'daily_closings' });

  const Printer = sequelize.define('Printer', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    branch_id: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING(100), allowNull: false },
    printer_type: { type: DataTypes.ENUM('bluetooth', 'network', 'usb'), defaultValue: 'network' },
    connection_string: DataTypes.STRING(255),
    paper_size: { type: DataTypes.ENUM('58mm', '80mm', 'a4'), defaultValue: '80mm' },
    is_default: { type: DataTypes.BOOLEAN, defaultValue: false },
    status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
  }, { tableName: 'printers' });

  CustomerModel.hasMany(CustomerLedger, { foreignKey: 'customer_id', as: 'ledger' });
  CustomerLedger.belongsTo(CustomerModel, { foreignKey: 'customer_id', as: 'customer' });
  CustomerLedger.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });

  SalesOrder.belongsTo(Branch, { foreignKey: 'branch_id', as: 'branch' });
  SalesOrder.belongsTo(CustomerModel, { foreignKey: 'customer_id', as: 'customer' });
  SalesOrder.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
  SalesOrder.hasMany(SalesOrderItem, { foreignKey: 'sales_order_id', as: 'items' });
  SalesOrder.hasMany(SalesPayment, { foreignKey: 'sales_order_id', as: 'payments' });
  SalesOrderItem.belongsTo(SalesOrder, { foreignKey: 'sales_order_id', as: 'salesOrder' });
  SalesOrderItem.belongsTo(ProductVariant, { foreignKey: 'variant_id', as: 'variant' });
  SalesOrderItem.hasMany(SalesOrderItemTax, { foreignKey: 'sales_order_item_id', as: 'taxes' });
  SalesOrderItemTax.belongsTo(SalesOrderItem, { foreignKey: 'sales_order_item_id', as: 'salesOrderItem' });
  SalesPayment.belongsTo(SalesOrder, { foreignKey: 'sales_order_id', as: 'salesOrder' });

  HeldBill.belongsTo(Branch, { foreignKey: 'branch_id', as: 'branch' });
  HeldBill.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });

  Return.belongsTo(SalesOrder, { foreignKey: 'sales_order_id', as: 'salesOrder' });
  Return.belongsTo(CustomerModel, { foreignKey: 'customer_id', as: 'customer' });
  Return.hasMany(ReturnItem, { foreignKey: 'return_id', as: 'items' });
  ReturnItem.belongsTo(Return, { foreignKey: 'return_id', as: 'return' });
  ReturnItem.belongsTo(ProductVariant, {
    foreignKey: { name: 'variant_id', allowNull: true },
    as: 'variant',
  });
  ReturnItem.belongsTo(SalesOrderItem, { foreignKey: 'sales_order_item_id', as: 'salesOrderItem' });
  ReturnItem.hasMany(ReturnItemTax, { foreignKey: 'return_item_id', as: 'taxes' });
  ReturnItemTax.belongsTo(ReturnItem, { foreignKey: 'return_item_id', as: 'returnItem' });
  SalesOrder.hasMany(Return, { foreignKey: 'sales_order_id', as: 'returns' });

  Expense.belongsTo(ExpenseCategory, { foreignKey: 'category_id', as: 'category' });
  Expense.belongsTo(Branch, { foreignKey: 'branch_id', as: 'branch' });
  Expense.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });

  DailyClosing.belongsTo(Branch, { foreignKey: 'branch_id', as: 'branch' });
  DailyClosing.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
  Printer.belongsTo(Branch, { foreignKey: 'branch_id', as: 'branch' });

  return {
    Customer: CustomerModel,
    CustomerLedger,
    BillSequence,
    SalesOrder,
    SalesOrderItem,
    SalesOrderItemTax,
    SalesPayment,
    HeldBill,
    Return,
    ReturnItem,
    ReturnItemTax,
    ExpenseCategory,
    Expense,
    Offer,
    DailyClosing,
    Printer,
  };
}

module.exports = { initBillingModels };
