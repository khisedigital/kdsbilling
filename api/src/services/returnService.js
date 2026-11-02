const { Op } = require('sequelize');
const AppError = require('../utils/AppError');
const { applyStockMovement, MOVEMENT_TYPES, generateDocNumber } = require('./stockEngine');

const RETURNABLE_STATUSES = ['completed', 'partially_returned'];
const SOLD_STATUSES = ['completed', 'partially_returned', 'fully_returned'];

function round4(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

function computeBillReturnStatus(items) {
  let anyReturned = false;
  let allFullyReturned = items.length > 0;
  for (const item of items) {
    const sold = round3(item.quantity);
    const returned = round3(item.returned_quantity);
    if (returned > 0) anyReturned = true;
    if (returned + 0.0005 < sold) allFullyReturned = false;
  }
  if (allFullyReturned && anyReturned) return 'fully_returned';
  if (anyReturned) return 'partially_returned';
  return 'completed';
}

async function createReturn(db, branchId, userId, data) {
  const {
    Return,
    ReturnItem,
    ReturnItemTax,
    SalesOrder,
    SalesOrderItem,
    SalesOrderItemTax,
    Customer,
    CustomerLedger,
  } = db;

  if (!data.salesOrderId) {
    throw new AppError('salesOrderId is required', 400, 'VALIDATION_ERROR');
  }
  if (!data.items?.length) {
    throw new AppError('Return items required', 400, 'VALIDATION_ERROR');
  }

  // Collapse duplicate lines for the same bill item (prevents accidental double-return in one request).
  const mergedByItemId = new Map();
  for (const item of data.items) {
    if (!item.salesOrderItemId) {
      throw new AppError('salesOrderItemId is required for each return line', 400, 'VALIDATION_ERROR');
    }
    const qty = round3(item.quantity);
    if (!(qty > 0)) {
      throw new AppError('Return quantity must be greater than zero', 400, 'VALIDATION_ERROR');
    }
    const prev = mergedByItemId.get(item.salesOrderItemId);
    if (prev) {
      prev.quantity = round3(prev.quantity + qty);
      if (item.restock === false) prev.restock = false;
    } else {
      mergedByItemId.set(item.salesOrderItemId, {
        salesOrderItemId: item.salesOrderItemId,
        quantity: qty,
        restock: item.restock !== false,
      });
    }
  }
  const returnLines = [...mergedByItemId.values()];

  const transaction = await db.sequelize.transaction();
  try {
    // Lock the bill first so concurrent return requests for the same bill serialize.
    const bill = await SalesOrder.findOne({
      where: {
        id: data.salesOrderId,
        branch_id: branchId,
        status: { [Op.in]: RETURNABLE_STATUSES },
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!bill) {
      throw new AppError('Bill not found or not returnable', 404, 'NOT_FOUND');
    }

    const lockedItems = await SalesOrderItem.findAll({
      where: { sales_order_id: bill.id },
      include: [{ model: SalesOrderItemTax, as: 'taxes' }],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    bill.setDataValue('items', lockedItems);

    const remainingById = new Map();
    for (const item of lockedItems) {
      const sold = round3(item.quantity);
      const returned = round3(item.returned_quantity || 0);
      remainingById.set(item.id, round3(sold - returned));
    }

    const hasRemaining = [...remainingById.values()].some((qty) => qty > 0.0005);
    if (!hasRemaining) {
      // Sync status, then reject — commit so the fix is not rolled back with the error.
      await bill.update({ status: 'fully_returned' }, { transaction });
      await transaction.commit();
      throw new AppError('All items on this bill are already returned', 400, 'ALREADY_RETURNED');
    }

    const refundMode = data.refundMode === 'store_credit' ? 'store_credit' : 'cash';
    if (refundMode === 'store_credit' && !(data.customerId || bill.customer_id)) {
      throw new AppError('Store credit requires a customer on the bill', 400, 'VALIDATION_ERROR');
    }

    const billLinesSum = lockedItems.reduce((sum, item) => sum + parseFloat(item.line_total || 0), 0);
    const billDiscount = parseFloat(bill.discount_amount || 0);
    const billRoundOff = parseFloat(bill.round_off_amount || 0);

    const ret = await Return.create({
      return_number: generateDocNumber('RET'),
      credit_note_number: generateDocNumber('CN'),
      sales_order_id: bill.id,
      branch_id: branchId,
      customer_id: data.customerId || bill.customer_id,
      return_type: data.returnType || 'return',
      subtotal: 0,
      tax_amount: 0,
      discount_amount: 0,
      total_amount: 0,
      refund_amount: 0,
      store_credit_amount: 0,
      refund_mode: refundMode,
      notes: data.notes || null,
      created_by: userId,
      status: 'completed',
    }, { transaction });

    let taxableSubtotal = 0;
    let taxTotal = 0;
    let discountTotal = 0;
    let netTotal = 0;

    for (const item of returnLines) {
      const billItem = lockedItems.find((i) => i.id === item.salesOrderItemId);
      if (!billItem) throw new AppError('Invalid return item', 400, 'VALIDATION_ERROR');

      const soldQty = round3(billItem.quantity);
      const alreadyReturned = round3(billItem.returned_quantity || 0);
      const remaining = remainingById.get(billItem.id) ?? round3(soldQty - alreadyReturned);
      const qty = round3(item.quantity);

      if (qty > remaining + 0.0005) {
        throw new AppError(
          `${billItem.product_name}: only ${remaining} left to return (sold ${soldQty}, already returned ${alreadyReturned})`,
          400,
          'OVER_RETURN'
        );
      }

      const ratio = soldQty > 0 ? qty / soldQty : 0;
      const unitPrice = parseFloat(billItem.unit_price);
      const lineGross = round4(ratio * parseFloat(billItem.line_total));
      const lineTax = round4(ratio * parseFloat(billItem.tax_amount || 0));
      const lineItemDiscount = round4(ratio * parseFloat(billItem.discount_amount || 0));
      const billDiscountShare = billLinesSum > 0
        ? round4(ratio * (parseFloat(billItem.line_total) / billLinesSum) * billDiscount)
        : 0;
      const roundOffShare = billLinesSum > 0
        ? round4(ratio * (parseFloat(billItem.line_total) / billLinesSum) * billRoundOff)
        : 0;
      const discountShare = round4(lineItemDiscount + billDiscountShare);
      // line_total on sale already includes tax; allocate bill discount + round-off against it.
      const lineNet = round4(lineGross - billDiscountShare + roundOffShare);
      const taxableShare = round4(Math.max(0, lineNet - lineTax));

      taxableSubtotal = round4(taxableSubtotal + taxableShare);
      taxTotal = round4(taxTotal + lineTax);
      discountTotal = round4(discountTotal + discountShare);
      netTotal = round4(netTotal + lineNet);

      const isCustomLine = !billItem.variant_id;
      const shouldRestock = !isCustomLine && item.restock !== false;

      const returnItem = await ReturnItem.create({
        return_id: ret.id,
        sales_order_item_id: billItem.id,
        variant_id: billItem.variant_id || null,
        quantity: qty,
        unit_price: unitPrice,
        discount_amount: discountShare,
        tax_amount: lineTax,
        line_total: lineNet,
        restock: shouldRestock,
      }, { transaction });

      const taxes = billItem.taxes || [];
      for (const tax of taxes) {
        await ReturnItemTax.create({
          return_item_id: returnItem.id,
          tax_type_code: tax.tax_type_code,
          tax_name: tax.tax_name,
          rate_percent: tax.rate_percent,
          tax_amount: round4(ratio * parseFloat(tax.tax_amount || 0)),
        }, { transaction });
      }

      const nextReturned = round3(alreadyReturned + qty);
      await billItem.update({ returned_quantity: nextReturned }, { transaction });
      billItem.setDataValue('returned_quantity', nextReturned);
      remainingById.set(billItem.id, round3(soldQty - nextReturned));

      if (shouldRestock) {
        await applyStockMovement(db, {
          branchId,
          variantId: billItem.variant_id,
          quantityChange: qty,
          movementType: MOVEMENT_TYPES.STOCK_IN,
          referenceType: 'return',
          referenceId: ret.id,
          notes: `Sales return / credit note ${ret.credit_note_number}`,
          userId,
        }, transaction);
      }
    }

    const refundAmount = refundMode === 'cash' ? netTotal : 0;
    const storeCreditAmount = refundMode === 'store_credit' ? netTotal : 0;

    await ret.update({
      subtotal: taxableSubtotal,
      tax_amount: taxTotal,
      discount_amount: discountTotal,
      total_amount: netTotal,
      refund_amount: refundAmount,
      store_credit_amount: storeCreditAmount,
    }, { transaction });

    if (storeCreditAmount > 0 && ret.customer_id) {
      const customer = await Customer.findByPk(ret.customer_id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!customer) throw new AppError('Customer not found', 404, 'NOT_FOUND');
      const newBal = round4(parseFloat(customer.store_credit_balance) + storeCreditAmount);
      await customer.update({ store_credit_balance: newBal }, { transaction });
      await CustomerLedger.create({
        customer_id: customer.id,
        entry_type: 'store_credit_add',
        amount: storeCreditAmount,
        balance_after: newBal,
        reference_type: 'return',
        reference_id: ret.id,
        notes: `Credit note ${ret.credit_note_number}`,
        created_by: userId,
      }, { transaction });
    }

    if (refundAmount > 0 && ret.customer_id) {
      const customer = await Customer.findByPk(ret.customer_id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (customer) {
        await CustomerLedger.create({
          customer_id: customer.id,
          entry_type: 'refund',
          amount: refundAmount,
          balance_after: parseFloat(customer.store_credit_balance),
          reference_type: 'return',
          reference_id: ret.id,
          notes: `Cash refund for credit note ${ret.credit_note_number}`,
          created_by: userId,
        }, { transaction });
      }
    }

    // Refresh items for status computation (returned_quantity updated in memory via update).
    const refreshedItems = await SalesOrderItem.findAll({
      where: { sales_order_id: bill.id },
      transaction,
    });
    const nextStatus = computeBillReturnStatus(refreshedItems);
    await bill.update({ status: nextStatus }, { transaction });

    await transaction.commit();
    return getReturn(db, ret.id);
  } catch (err) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }
    throw err;
  }
}

async function getReturn(db, id) {
  const { Return } = db;
  const ret = await Return.findByPk(id, {
    include: [
      {
        model: db.SalesOrder,
        as: 'salesOrder',
        attributes: ['id', 'bill_number', 'status', 'total_amount'],
      },
      {
        model: db.ReturnItem,
        as: 'items',
        include: [
          { model: db.ProductVariant, as: 'variant', attributes: ['sku'] },
          { model: db.ReturnItemTax, as: 'taxes' },
        ],
      },
      { model: db.Customer, as: 'customer', attributes: ['id', 'name'] },
    ],
  });
  if (!ret) throw new AppError('Return not found', 404, 'NOT_FOUND');
  return ret;
}

async function listReturns(db, branchId, query) {
  const { Return } = db;
  const { page, limit, offset } = require('../utils/pagination').getPagination(query);
  const where = { branch_id: branchId };
  if (query.salesOrderId) where.sales_order_id = query.salesOrderId;
  const { rows, count } = await Return.findAndCountAll({
    where,
    include: [{ model: db.SalesOrder, as: 'salesOrder', attributes: ['bill_number', 'status'] }],
    order: [['created_at', 'DESC']],
    limit,
    offset,
  });
  return require('../utils/pagination').paginatedResponse(rows, count, { page, limit });
}

module.exports = {
  createReturn,
  getReturn,
  listReturns,
  RETURNABLE_STATUSES,
  SOLD_STATUSES,
  computeBillReturnStatus,
};
