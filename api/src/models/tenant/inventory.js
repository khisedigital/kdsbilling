const { DataTypes } = require('sequelize');

function defineSupplier(sequelize) {
  return sequelize.define('Supplier', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING(150), allowNull: false },
    phone: DataTypes.STRING(20),
    email: DataTypes.STRING(150),
    address: DataTypes.TEXT,
    tax_number: DataTypes.STRING(50),
    status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
    deleted_at: DataTypes.DATE,
  }, { tableName: 'suppliers', paranoid: false });
}

function defineStockBalance(sequelize) {
  return sequelize.define('StockBalance', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    branch_id: { type: DataTypes.UUID, allowNull: false },
    variant_id: { type: DataTypes.UUID, allowNull: false },
    quantity: { type: DataTypes.DECIMAL(15, 3), allowNull: false, defaultValue: 0 },
  }, {
    tableName: 'stock_balances',
    indexes: [{ unique: true, fields: ['branch_id', 'variant_id'] }],
  });
}

function defineStockLedger(sequelize) {
  return sequelize.define('StockLedger', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    branch_id: { type: DataTypes.UUID, allowNull: false },
    variant_id: { type: DataTypes.UUID, allowNull: false },
    movement_type: {
      type: DataTypes.ENUM(
        'OPENING', 'PURCHASE_IN', 'STOCK_IN', 'STOCK_OUT',
        'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'DAMAGE', 'SALE'
      ),
      allowNull: false,
    },
    quantity_change: { type: DataTypes.DECIMAL(15, 3), allowNull: false },
    balance_after: { type: DataTypes.DECIMAL(15, 3), allowNull: false },
    reference_type: DataTypes.STRING(50),
    reference_id: DataTypes.UUID,
    related_branch_id: DataTypes.UUID,
    unit_cost: DataTypes.DECIMAL(15, 4),
    notes: DataTypes.TEXT,
    created_by: { type: DataTypes.UUID, allowNull: false },
  }, { tableName: 'stock_ledger' });
}

function definePurchaseOrder(sequelize) {
  return sequelize.define('PurchaseOrder', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    po_number: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    supplier_id: { type: DataTypes.UUID, allowNull: false },
    branch_id: { type: DataTypes.UUID, allowNull: false },
    status: {
      type: DataTypes.ENUM('draft', 'ordered', 'partial', 'received', 'cancelled'),
      defaultValue: 'draft',
    },
    order_date: { type: DataTypes.DATEONLY, allowNull: false },
    expected_date: DataTypes.DATEONLY,
    notes: DataTypes.TEXT,
    created_by: { type: DataTypes.UUID, allowNull: false },
  }, { tableName: 'purchase_orders' });
}

function definePurchaseOrderItem(sequelize) {
  return sequelize.define('PurchaseOrderItem', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    purchase_order_id: { type: DataTypes.UUID, allowNull: false },
    variant_id: { type: DataTypes.UUID, allowNull: false },
    quantity: { type: DataTypes.DECIMAL(15, 3), allowNull: false },
    unit_cost: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    received_qty: { type: DataTypes.DECIMAL(15, 3), defaultValue: 0 },
  }, { tableName: 'purchase_order_items' });
}

function definePurchaseBill(sequelize) {
  return sequelize.define('PurchaseBill', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    bill_number: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    supplier_id: { type: DataTypes.UUID, allowNull: false },
    branch_id: { type: DataTypes.UUID, allowNull: false },
    purchase_order_id: DataTypes.UUID,
    bill_date: { type: DataTypes.DATEONLY, allowNull: false },
    subtotal: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    tax_amount: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    total_amount: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    notes: DataTypes.TEXT,
    status: {
      type: DataTypes.ENUM('draft', 'confirmed', 'cancelled'),
      defaultValue: 'confirmed',
    },
    created_by: { type: DataTypes.UUID, allowNull: false },
  }, { tableName: 'purchase_bills' });
}

function definePurchaseBillItem(sequelize) {
  return sequelize.define('PurchaseBillItem', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    purchase_bill_id: { type: DataTypes.UUID, allowNull: false },
    variant_id: { type: DataTypes.UUID, allowNull: false },
    quantity: { type: DataTypes.DECIMAL(15, 3), allowNull: false },
    unit_cost: { type: DataTypes.DECIMAL(15, 4), allowNull: false },
    tax_amount: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
    total_amount: { type: DataTypes.DECIMAL(15, 4), allowNull: false },
  }, { tableName: 'purchase_bill_items' });
}

function defineStockTransfer(sequelize) {
  return sequelize.define('StockTransfer', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    transfer_number: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    from_branch_id: { type: DataTypes.UUID, allowNull: false },
    to_branch_id: { type: DataTypes.UUID, allowNull: false },
    status: {
      type: DataTypes.ENUM('draft', 'completed', 'cancelled'),
      defaultValue: 'completed',
    },
    notes: DataTypes.TEXT,
    created_by: { type: DataTypes.UUID, allowNull: false },
    completed_at: DataTypes.DATE,
  }, { tableName: 'stock_transfers' });
}

function defineStockTransferItem(sequelize) {
  return sequelize.define('StockTransferItem', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    stock_transfer_id: { type: DataTypes.UUID, allowNull: false },
    variant_id: { type: DataTypes.UUID, allowNull: false },
    quantity: { type: DataTypes.DECIMAL(15, 3), allowNull: false },
  }, { tableName: 'stock_transfer_items' });
}

function initInventoryModels(sequelize, { Branch, User, ProductVariant, Product }) {
  const Supplier = defineSupplier(sequelize);
  const StockBalance = defineStockBalance(sequelize);
  const StockLedger = defineStockLedger(sequelize);
  const PurchaseOrder = definePurchaseOrder(sequelize);
  const PurchaseOrderItem = definePurchaseOrderItem(sequelize);
  const PurchaseBill = definePurchaseBill(sequelize);
  const PurchaseBillItem = definePurchaseBillItem(sequelize);
  const StockTransfer = defineStockTransfer(sequelize);
  const StockTransferItem = defineStockTransferItem(sequelize);

  Supplier.hasMany(PurchaseOrder, { foreignKey: 'supplier_id', as: 'purchaseOrders' });
  PurchaseOrder.belongsTo(Supplier, { foreignKey: 'supplier_id', as: 'supplier' });
  PurchaseOrder.belongsTo(Branch, { foreignKey: 'branch_id', as: 'branch' });
  PurchaseOrder.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
  PurchaseOrder.hasMany(PurchaseOrderItem, { foreignKey: 'purchase_order_id', as: 'items' });
  PurchaseOrderItem.belongsTo(PurchaseOrder, { foreignKey: 'purchase_order_id', as: 'purchaseOrder' });
  PurchaseOrderItem.belongsTo(ProductVariant, { foreignKey: 'variant_id', as: 'variant' });

  PurchaseBill.belongsTo(Supplier, { foreignKey: 'supplier_id', as: 'supplier' });
  PurchaseBill.belongsTo(Branch, { foreignKey: 'branch_id', as: 'branch' });
  PurchaseBill.belongsTo(PurchaseOrder, { foreignKey: 'purchase_order_id', as: 'purchaseOrder' });
  PurchaseBill.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
  PurchaseBill.hasMany(PurchaseBillItem, { foreignKey: 'purchase_bill_id', as: 'items' });
  PurchaseBillItem.belongsTo(PurchaseBill, { foreignKey: 'purchase_bill_id', as: 'purchaseBill' });
  PurchaseBillItem.belongsTo(ProductVariant, { foreignKey: 'variant_id', as: 'variant' });

  StockBalance.belongsTo(Branch, { foreignKey: 'branch_id', as: 'branch' });
  StockBalance.belongsTo(ProductVariant, { foreignKey: 'variant_id', as: 'variant' });

  StockLedger.belongsTo(Branch, { foreignKey: 'branch_id', as: 'branch' });
  StockLedger.belongsTo(ProductVariant, { foreignKey: 'variant_id', as: 'variant' });
  StockLedger.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
  StockLedger.belongsTo(Branch, { foreignKey: 'related_branch_id', as: 'relatedBranch' });

  ProductVariant.hasMany(StockBalance, { foreignKey: 'variant_id', as: 'stockBalances' });
  ProductVariant.hasMany(StockLedger, { foreignKey: 'variant_id', as: 'stockLedger' });

  StockTransfer.belongsTo(Branch, { foreignKey: 'from_branch_id', as: 'fromBranch' });
  StockTransfer.belongsTo(Branch, { foreignKey: 'to_branch_id', as: 'toBranch' });
  StockTransfer.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
  StockTransfer.hasMany(StockTransferItem, { foreignKey: 'stock_transfer_id', as: 'items' });
  StockTransferItem.belongsTo(StockTransfer, { foreignKey: 'stock_transfer_id', as: 'stockTransfer' });
  StockTransferItem.belongsTo(ProductVariant, { foreignKey: 'variant_id', as: 'variant' });

  return {
    Supplier,
    StockBalance,
    StockLedger,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchaseBill,
    PurchaseBillItem,
    StockTransfer,
    StockTransferItem,
  };
}

module.exports = { initInventoryModels };
