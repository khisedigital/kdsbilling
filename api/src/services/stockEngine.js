const { Op } = require('sequelize');
const AppError = require('../utils/AppError');
const { notifyStockMovement } = require('./shopify/stockHook');

const MOVEMENT_TYPES = {
  OPENING: 'OPENING',
  PURCHASE_IN: 'PURCHASE_IN',
  STOCK_IN: 'STOCK_IN',
  STOCK_OUT: 'STOCK_OUT',
  ADJUSTMENT: 'ADJUSTMENT',
  TRANSFER_IN: 'TRANSFER_IN',
  TRANSFER_OUT: 'TRANSFER_OUT',
  DAMAGE: 'DAMAGE',
  SALE: 'SALE',
};

function toDecimal(value) {
  return parseFloat(parseFloat(value).toFixed(3));
}

async function getOrCreateBalance(db, branchId, variantId, transaction) {
  const { StockBalance } = db;
  const [balance] = await StockBalance.findOrCreate({
    where: { branch_id: branchId, variant_id: variantId },
    defaults: { quantity: 0 },
    transaction,
    lock: transaction ? transaction.LOCK.UPDATE : undefined,
  });
  return balance;
}

async function applyStockMovement(
  db,
  {
    branchId,
    variantId,
    quantityChange,
    movementType,
    referenceType,
    referenceId,
    relatedBranchId,
    unitCost,
    notes,
    userId,
    allowNegative = false,
  },
  transaction
) {
  const { StockBalance, StockLedger, ProductVariant } = db;

  const variant = await ProductVariant.findOne({
    where: { id: variantId, deleted_at: null, status: 'active' },
    transaction,
  });
  if (!variant) throw new AppError('Product variant not found', 404, 'NOT_FOUND');

  const change = toDecimal(quantityChange);
  if (change === 0) throw new AppError('Quantity change cannot be zero', 400, 'VALIDATION_ERROR');

  const balance = await getOrCreateBalance(db, branchId, variantId, transaction);
  const currentQty = toDecimal(balance.quantity);
  const newQty = toDecimal(currentQty + change);

  if (!allowNegative && newQty < 0) {
    throw new AppError(
      `Insufficient stock. Available: ${currentQty}, requested: ${Math.abs(change)}`,
      400,
      'INSUFFICIENT_STOCK'
    );
  }

  await balance.update({ quantity: newQty }, { transaction });

  const ledger = await StockLedger.create(
    {
      branch_id: branchId,
      variant_id: variantId,
      movement_type: movementType,
      quantity_change: change,
      balance_after: newQty,
      reference_type: referenceType || null,
      reference_id: referenceId || null,
      related_branch_id: relatedBranchId || null,
      unit_cost: unitCost ?? null,
      notes: notes || null,
      created_by: userId,
    },
    { transaction }
  );

  notifyStockMovement(db, { variantId, branchId, referenceType }, transaction);

  return { balance, ledger, newQty };
}

function generateDocNumber(prefix) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${date}-${rand}`;
}

module.exports = {
  MOVEMENT_TYPES,
  toDecimal,
  getOrCreateBalance,
  applyStockMovement,
  generateDocNumber,
};
