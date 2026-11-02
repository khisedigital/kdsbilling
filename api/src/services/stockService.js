const { Op } = require('sequelize');
const { SOLD_BILL_STATUSES } = require('../constants/billStatuses');
const AppError = require('../utils/AppError');
const { getPagination, paginatedResponse } = require('../utils/pagination');
const { MOVEMENT_TYPES, applyStockMovement } = require('./stockEngine');

const variantInclude = (db) => ({
  model: db.ProductVariant,
  as: 'variant',
  attributes: ['id', 'sku', 'size', 'color', 'selling_price', 'reorder_level'],
  include: [
    {
      model: db.Product,
      as: 'product',
      attributes: ['id', 'name', 'is_weight_based', 'allow_decimal_qty'],
    },
    { model: db.UnitOfMeasure, as: 'uom', attributes: ['id', 'code', 'name'] },
  ],
});

function isLowStock(quantity, reorderLevel) {
  const qty = parseFloat(quantity) || 0;
  const reorder = parseFloat(reorderLevel) || 0;
  // Reorder set: at/below reorder. Otherwise treat zero/negative as low/out of stock.
  if (reorder > 0) return qty <= reorder;
  return qty <= 0;
}

function serializeBalanceRow(branchId, variant, balance) {
  const quantity = balance ? parseFloat(balance.quantity) || 0 : 0;
  return {
    id: balance?.id || `virtual-${variant.id}`,
    branch_id: branchId,
    variant_id: variant.id,
    quantity,
    updated_at: balance?.updated_at || null,
    created_at: balance?.created_at || null,
    variant: typeof variant.toJSON === 'function' ? variant.toJSON() : variant,
  };
}

async function listBalances(db, branchId, query) {
  const { StockBalance, ProductVariant, Product } = db;
  const { page, limit, offset } = getPagination(query);
  const search = query.search?.trim();

  const productWhere = { deleted_at: null, status: 'active' };
  const variantWhere = { deleted_at: null, status: 'active' };

  if (search) {
    variantWhere[Op.or] = [
      { sku: { [Op.like]: `%${search}%` } },
      { '$product.name$': { [Op.like]: `%${search}%` } },
    ];
  }

  const variants = await ProductVariant.findAll({
    where: variantWhere,
    include: [
      {
        model: Product,
        as: 'product',
        attributes: ['id', 'name', 'is_weight_based', 'allow_decimal_qty'],
        where: productWhere,
        required: true,
      },
      { model: db.UnitOfMeasure, as: 'uom', attributes: ['id', 'code', 'name'] },
    ],
    order: [[{ model: Product, as: 'product' }, 'name', 'ASC']],
  });

  const balances = variants.length
    ? await StockBalance.findAll({
        where: {
          branch_id: branchId,
          variant_id: { [Op.in]: variants.map((v) => v.id) },
        },
      })
    : [];

  const balanceByVariant = new Map(balances.map((b) => [b.variant_id, b]));

  let items = variants.map((variant) =>
    serializeBalanceRow(branchId, variant, balanceByVariant.get(variant.id))
  );

  if (query.lowStock === 'true') {
    items = items.filter((row) => isLowStock(row.quantity, row.variant?.reorder_level));
  }

  const total = items.length;
  return paginatedResponse(items.slice(offset, offset + limit), total, { page, limit });
}

async function getStockHistory(db, branchId, query) {
  const { StockLedger, User } = db;
  const { page, limit, offset } = getPagination(query);
  const where = { branch_id: branchId };

  if (query.variantId) where.variant_id = query.variantId;
  if (query.movementType) where.movement_type = query.movementType;
  if (query.from || query.to) {
    where.created_at = {};
    if (query.from) where.created_at[Op.gte] = new Date(query.from);
    if (query.to) where.created_at[Op.lte] = new Date(query.to);
  }

  const variant = variantInclude(db);
  if (query.productId && !query.variantId) {
    variant.where = { ...(variant.where || {}), product_id: query.productId };
    variant.required = true;
  }

  const { rows, count } = await StockLedger.findAndCountAll({
    where,
    include: [
      variant,
      { model: User, as: 'creator', attributes: ['id', 'name'] },
      { model: db.Branch, as: 'relatedBranch', attributes: ['id', 'name', 'code'] },
    ],
    order: [['created_at', 'DESC']],
    limit,
    offset,
  });

  return paginatedResponse(rows, count, { page, limit });
}

async function recordOpeningStock(db, branchId, userId, items) {
  return processBulkMovement(db, branchId, userId, items, MOVEMENT_TYPES.OPENING, 'opening_stock');
}

async function recordStockIn(db, branchId, userId, items, notes) {
  return processBulkMovement(db, branchId, userId, items, MOVEMENT_TYPES.STOCK_IN, 'manual_in', notes);
}

async function recordStockOut(db, branchId, userId, items, notes) {
  const normalized = items.map((i) => ({ ...i, quantity: -Math.abs(parseFloat(i.quantity)) }));
  return processBulkMovement(db, branchId, userId, normalized, MOVEMENT_TYPES.STOCK_OUT, 'manual_out', notes);
}

async function recordAdjustment(db, branchId, userId, items, notes) {
  return processBulkMovement(db, branchId, userId, items, MOVEMENT_TYPES.ADJUSTMENT, 'adjustment', notes);
}

async function recordDamage(db, branchId, userId, items, notes) {
  const normalized = items.map((i) => ({ ...i, quantity: -Math.abs(parseFloat(i.quantity)) }));
  return processBulkMovement(
    db,
    branchId,
    userId,
    normalized,
    MOVEMENT_TYPES.DAMAGE,
    'damaged_stock',
    notes || 'Damaged stock'
  );
}

async function processBulkMovement(db, branchId, userId, items, movementType, referenceType, notes) {
  if (!items?.length) throw new AppError('At least one item is required', 400, 'VALIDATION_ERROR');

  const transaction = await db.sequelize.transaction();
  const results = [];

  try {
    for (const item of items) {
      const qty = parseFloat(item.quantity);
      if (!item.variantId || Number.isNaN(qty) || qty === 0) {
        throw new AppError('Each item needs variantId and non-zero quantity', 400, 'VALIDATION_ERROR');
      }

      const result = await applyStockMovement(
        db,
        {
          branchId,
          variantId: item.variantId,
          quantityChange: qty,
          movementType,
          referenceType,
          unitCost: item.unitCost,
          notes: item.notes || notes,
          userId,
        },
        transaction
      );
      results.push(result);
    }

    await transaction.commit();
    return { items: results.length, movements: results.map((r) => r.ledger) };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function transferStock(db, userId, { fromBranchId, toBranchId, items, notes }) {
  if (fromBranchId === toBranchId) {
    throw new AppError('Source and destination branches must differ', 400, 'VALIDATION_ERROR');
  }
  if (!items?.length) throw new AppError('At least one item is required', 400, 'VALIDATION_ERROR');

  const { StockTransfer, StockTransferItem } = db;
  const { generateDocNumber } = require('./stockEngine');
  const transaction = await db.sequelize.transaction();

  try {
    const transfer = await StockTransfer.create(
      {
        transfer_number: generateDocNumber('TRF'),
        from_branch_id: fromBranchId,
        to_branch_id: toBranchId,
        status: 'completed',
        notes: notes || null,
        created_by: userId,
        completed_at: new Date(),
      },
      { transaction }
    );

    for (const item of items) {
      const qty = Math.abs(parseFloat(item.quantity));
      if (!item.variantId || Number.isNaN(qty) || qty <= 0) {
        throw new AppError('Invalid transfer item', 400, 'VALIDATION_ERROR');
      }

      await StockTransferItem.create(
        {
          stock_transfer_id: transfer.id,
          variant_id: item.variantId,
          quantity: qty,
        },
        { transaction }
      );

      await applyStockMovement(
        db,
        {
          branchId: fromBranchId,
          variantId: item.variantId,
          quantityChange: -qty,
          movementType: MOVEMENT_TYPES.TRANSFER_OUT,
          referenceType: 'stock_transfer',
          referenceId: transfer.id,
          relatedBranchId: toBranchId,
          notes: notes || `Transfer to branch`,
          userId,
        },
        transaction
      );

      await applyStockMovement(
        db,
        {
          branchId: toBranchId,
          variantId: item.variantId,
          quantityChange: qty,
          movementType: MOVEMENT_TYPES.TRANSFER_IN,
          referenceType: 'stock_transfer',
          referenceId: transfer.id,
          relatedBranchId: fromBranchId,
          notes: notes || `Transfer from branch`,
          userId,
        },
        transaction
      );
    }

    await transaction.commit();
    return getTransfer(db, transfer.id);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function getTransfer(db, id) {
  const { StockTransfer } = db;
  const transfer = await StockTransfer.findByPk(id, {
    include: [
      { model: db.Branch, as: 'fromBranch', attributes: ['id', 'name', 'code'] },
      { model: db.Branch, as: 'toBranch', attributes: ['id', 'name', 'code'] },
      {
        model: db.StockTransferItem,
        as: 'items',
        include: [variantInclude(db)],
      },
      { model: db.User, as: 'creator', attributes: ['id', 'name'] },
    ],
  });
  if (!transfer) throw new AppError('Transfer not found', 404, 'NOT_FOUND');
  return transfer;
}

async function listTransfers(db, query) {
  const { StockTransfer } = db;
  const { page, limit, offset } = getPagination(query);
  const where = {};
  if (query.fromBranchId) where.from_branch_id = query.fromBranchId;
  if (query.toBranchId) where.to_branch_id = query.toBranchId;

  const { rows, count } = await StockTransfer.findAndCountAll({
    where,
    include: [
      { model: db.Branch, as: 'fromBranch', attributes: ['id', 'name', 'code'] },
      { model: db.Branch, as: 'toBranch', attributes: ['id', 'name', 'code'] },
    ],
    order: [['created_at', 'DESC']],
    limit,
    offset,
  });

  return paginatedResponse(rows, count, { page, limit });
}

module.exports = {
  listBalances,
  getStockHistory,
  recordOpeningStock,
  recordStockIn,
  recordStockOut,
  recordAdjustment,
  recordDamage,
  transferStock,
  getTransfer,
  listTransfers,
};
