const { Op } = require('sequelize');
const AppError = require('../utils/AppError');
const { getPagination, paginatedResponse } = require('../utils/pagination');
const { calculateBill } = require('./taxCalculator');
const { applyStockMovement, MOVEMENT_TYPES, generateDocNumber } = require('./stockEngine');

function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

/** Whether any sold qty remains returnable on the bill. */
function computeIsReturnable(bill) {
  const status = String(bill?.status || '');
  if (status !== 'completed' && status !== 'partially_returned') return false;
  const items = bill?.items;
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.some((item) => {
    const sold = round3(item.quantity);
    const returned = round3(item.returned_quantity ?? item.returnedQuantity ?? 0);
    return sold - returned > 0.0005;
  });
}

function serializeBill(bill) {
  const json = typeof bill?.toJSON === 'function' ? bill.toJSON() : { ...bill };
  json.is_returnable = computeIsReturnable(json);
  return json;
}

async function nextBillNumber(db, branchId, transaction) {
  const { BillSequence, Branch } = db;
  const branch = await Branch.findByPk(branchId, { transaction });
  const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  let seq = await BillSequence.findOne({ where: { branch_id: branchId }, transaction, lock: transaction?.LOCK?.UPDATE });
  if (!seq || seq.date_prefix !== datePrefix) {
    if (seq) {
      await seq.update({ date_prefix: datePrefix, last_sequence: 1 }, { transaction });
    } else {
      seq = await BillSequence.create({ branch_id: branchId, date_prefix: datePrefix, last_sequence: 1 }, { transaction });
    }
  } else {
    await seq.increment('last_sequence', { transaction });
    await seq.reload({ transaction });
  }

  const num = String(seq.last_sequence).padStart(4, '0');
  return `${branch.code}-${datePrefix}-${num}`;
}

const billIncludes = (db) => [
  { model: db.Customer, as: 'customer', attributes: ['id', 'name', 'phone'] },
  { model: db.Branch, as: 'branch', attributes: ['id', 'name', 'code'] },
  { model: db.User, as: 'creator', attributes: ['id', 'name'] },
  {
    model: db.SalesOrderItem,
    as: 'items',
    include: [
      { model: db.SalesOrderItemTax, as: 'taxes' },
      { model: db.ProductVariant, as: 'variant', attributes: ['id', 'sku'] },
    ],
  },
  { model: db.SalesPayment, as: 'payments' },
  {
    model: db.Return,
    as: 'returns',
    attributes: [
      'id',
      'return_number',
      'credit_note_number',
      'subtotal',
      'tax_amount',
      'discount_amount',
      'total_amount',
      'refund_amount',
      'store_credit_amount',
      'refund_mode',
      'notes',
      'created_at',
      'status',
    ],
    separate: true,
    order: [['created_at', 'DESC']],
    include: [{
      model: db.ReturnItem,
      as: 'items',
      attributes: [
        'id',
        'quantity',
        'unit_price',
        'discount_amount',
        'tax_amount',
        'line_total',
      ],
      include: [{
        model: db.SalesOrderItem,
        as: 'salesOrderItem',
        attributes: ['id', 'product_name', 'sku'],
      }],
    }],
  },
];

async function previewBill(db, payload) {
  const { Offer } = db;
  let offer = null;
  if (payload.offerId) {
    offer = await Offer.findOne({ where: { id: payload.offerId, status: 'active' } });
  }
  return calculateBill(db, { ...payload, offer });
}

async function createBill(db, branchId, userId, payload) {
  const { SalesOrder, SalesOrderItem, SalesOrderItemTax, SalesPayment, Customer, Offer } = db;

  if (!payload.items?.length) throw new AppError('Bill items required', 400, 'VALIDATION_ERROR');
  if (!payload.payments?.length) throw new AppError('Payment required', 400, 'VALIDATION_ERROR');

  let offer = null;
  if (payload.offerId) offer = await Offer.findOne({ where: { id: payload.offerId, status: 'active' } });

  const calculated = await calculateBill(db, { ...payload, offer });
  const paidAmount = payload.payments.reduce((s, p) => s + parseFloat(p.amount), 0);

  if (paidAmount < calculated.totalAmount - 0.01) {
    throw new AppError('Insufficient payment amount', 400, 'INSUFFICIENT_PAYMENT');
  }

  const usesStoreCredit = payload.payments.some((p) => p.mode === 'store_credit' && parseFloat(p.amount) > 0);
  if (usesStoreCredit && !payload.customerId) {
    throw new AppError('Store credit payment requires a customer', 400, 'VALIDATION_ERROR');
  }

  const transaction = await db.sequelize.transaction();
  try {
    const billNumber = await nextBillNumber(db, branchId, transaction);

    let customer = null;
    if (payload.customerId) {
      customer = await Customer.findByPk(payload.customerId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!customer) throw new AppError('Customer not found', 404, 'NOT_FOUND');
    }

    const bill = await SalesOrder.create({
      bill_number: billNumber,
      branch_id: branchId,
      customer_id: customer ? customer.id : null,
      status: 'completed',
      subtotal: calculated.subtotal,
      discount_amount: calculated.discountAmount,
      discount_percent: calculated.discountPercent,
      tax_amount: calculated.taxAmount,
      round_off_amount: calculated.roundOffAmount || 0,
      total_amount: calculated.totalAmount,
      paid_amount: paidAmount,
      change_amount: Math.max(0, paidAmount - calculated.totalAmount),
      notes: payload.notes || null,
      created_by: userId,
    }, { transaction });

    for (const line of calculated.items) {
      const isCustom = line.isCustom === true || !line.variantId || String(line.variantId).startsWith('custom-');
      const item = await SalesOrderItem.create({
        sales_order_id: bill.id,
        variant_id: isCustom ? null : line.variantId,
        product_name: line.productName,
        sku: line.sku || (isCustom ? 'CUSTOM' : ''),
        quantity: line.quantity,
        unit_price: line.unitPrice,
        cost_price: line.costPrice,
        discount_amount: line.discountAmount,
        discount_percent: line.discountPercent,
        tax_amount: line.taxAmount,
        line_total: line.lineTotal,
      }, { transaction });

      for (const tax of line.taxes) {
        await SalesOrderItemTax.create({
          sales_order_item_id: item.id,
          tax_type_code: tax.taxTypeCode,
          tax_name: tax.taxName,
          rate_percent: tax.ratePercent,
          tax_amount: tax.taxAmount,
        }, { transaction });
      }

      // Custom / open-price lines are not tied to inventory
      if (!isCustom) {
        await applyStockMovement(db, {
          branchId,
          variantId: line.variantId,
          quantityChange: -line.quantity,
          movementType: MOVEMENT_TYPES.SALE,
          referenceType: 'sales_order',
          referenceId: bill.id,
          userId,
          allowNegative: true,
        }, transaction);
      }
    }

    for (const payment of payload.payments) {
      await SalesPayment.create({
        sales_order_id: bill.id,
        payment_mode: payment.mode,
        amount: payment.amount,
        reference_number: payment.referenceNumber || null,
      }, { transaction });

      if (payment.mode === 'store_credit') {
        const amount = parseFloat(payment.amount);
        if (!(amount > 0)) continue;
        if (!customer) throw new AppError('Store credit payment requires a customer', 400, 'VALIDATION_ERROR');
        const newBal = parseFloat(customer.store_credit_balance) - amount;
        if (newBal < -0.01) throw new AppError('Insufficient store credit', 400, 'INSUFFICIENT_CREDIT');
        await customer.update({ store_credit_balance: newBal }, { transaction });
        await customer.reload({ transaction });
        await db.CustomerLedger.create({
          customer_id: customer.id,
          entry_type: 'store_credit_use',
          amount: -amount,
          balance_after: newBal,
          reference_type: 'sales_order',
          reference_id: bill.id,
          created_by: userId,
        }, { transaction });
      }
    }

    if (customer) {
      const points = Math.floor(calculated.totalAmount / 100);
      if (points > 0) {
        const newPts = parseFloat(customer.loyalty_points) + points;
        await customer.update({ loyalty_points: newPts }, { transaction });
        await db.CustomerLedger.create({
          customer_id: customer.id,
          entry_type: 'loyalty_earn',
          amount: points,
          balance_after: newPts,
          reference_type: 'sales_order',
          reference_id: bill.id,
          created_by: userId,
        }, { transaction });
      }
    }

    await transaction.commit();
    const billId = bill.id;
    if (payload.heldBillId) {
      try {
        const held = await db.HeldBill.findOne({
          where: { id: payload.heldBillId, branch_id: branchId },
        });
        if (held) await held.destroy();
      } catch {
        // The sale is already saved. A leftover hold can still be cancelled from Held bills.
      }
    }
    return getBill(db, billId);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function getBill(db, id) {
  const { SalesOrder } = db;
  const bill = await SalesOrder.findByPk(id, { include: billIncludes(db) });
  if (!bill) throw new AppError('Bill not found', 404, 'NOT_FOUND');
  return serializeBill(bill);
}

async function listBills(db, branchId, query) {
  const { SalesOrder } = db;
  const { page, limit, offset } = getPagination(query);
  const where = { branch_id: branchId, status: { [Op.ne]: 'held' } };
  if (query.status) where.status = query.status;
  if (query.search?.trim()) {
    where.bill_number = { [Op.like]: `%${query.search.trim()}%` };
  }
  if (query.from || query.to) {
    where.created_at = {};
    if (query.from) where.created_at[Op.gte] = new Date(query.from);
    if (query.to) where.created_at[Op.lte] = new Date(query.to + 'T23:59:59');
  }

  const { rows, count } = await SalesOrder.findAndCountAll({
    where,
    include: [
      { model: db.Customer, as: 'customer', attributes: ['id', 'name'] },
      { model: db.SalesPayment, as: 'payments' },
      {
        model: db.SalesOrderItem,
        as: 'items',
        attributes: ['id', 'quantity', 'returned_quantity'],
      },
    ],
    order: [['created_at', 'DESC']],
    limit,
    offset,
    distinct: true,
  });
  return paginatedResponse(rows.map(serializeBill), count, { page, limit });
}

async function voidBill(db, branchId, userId, billId, reason) {
  const { SalesOrder, SalesOrderItem, SalesPayment, Customer } = db;
  const bill = await SalesOrder.findOne({
    where: { id: billId, branch_id: branchId, status: 'completed' },
    include: [
      { model: SalesOrderItem, as: 'items' },
      { model: SalesPayment, as: 'payments' },
    ],
  });
  if (!bill) throw new AppError('Bill not found or already voided', 404, 'NOT_FOUND');
  if (!reason?.trim()) throw new AppError('Void reason required', 400, 'VALIDATION_ERROR');

  const hasReturns = (bill.items || []).some((item) => parseFloat(item.returned_quantity || 0) > 0);
  if (hasReturns) {
    throw new AppError('Cannot void a bill that has returns. Process remaining items via return instead.', 400, 'VALIDATION_ERROR');
  }

  const transaction = await db.sequelize.transaction();
  try {
    for (const item of bill.items) {
      await applyStockMovement(db, {
        branchId,
        variantId: item.variant_id,
        quantityChange: parseFloat(item.quantity),
        movementType: MOVEMENT_TYPES.STOCK_IN,
        referenceType: 'void_bill',
        referenceId: bill.id,
        notes: `Void: ${reason}`,
        userId,
      }, transaction);
    }

    // Restore store credit used on this bill.
    const creditPayments = (bill.payments || []).filter((p) => p.payment_mode === 'store_credit');
    if (creditPayments.length && bill.customer_id) {
      const customer = await Customer.findByPk(bill.customer_id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (customer) {
        let bal = parseFloat(customer.store_credit_balance);
        for (const payment of creditPayments) {
          const amount = parseFloat(payment.amount);
          if (!(amount > 0)) continue;
          bal += amount;
          await db.CustomerLedger.create({
            customer_id: customer.id,
            entry_type: 'store_credit_add',
            amount,
            balance_after: bal,
            reference_type: 'void_bill',
            reference_id: bill.id,
            notes: `Void restore: ${reason}`,
            created_by: userId,
          }, { transaction });
        }
        await customer.update({ store_credit_balance: bal }, { transaction });
      }
    }

    await bill.update({
      status: 'void',
      voided_by: userId,
      void_reason: reason,
      voided_at: new Date(),
    }, { transaction });

    await transaction.commit();
    return getBill(db, bill.id);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function holdBill(db, branchId, userId, payload) {
  const { HeldBill } = db;
  if (!payload.name?.trim()) throw new AppError('Hold name required', 400, 'VALIDATION_ERROR');
  return HeldBill.create({
    branch_id: branchId,
    name: payload.name.trim(),
    cart_data: payload.cartData,
    customer_id: payload.customerId || null,
    created_by: userId,
  });
}

function serializeHeldBill(row) {
  const json = typeof row.toJSON === 'function' ? row.toJSON() : { ...row };
  const created = json.created_at || json.createdAt || null;
  const createdIso = created instanceof Date ? created.toISOString() : created;
  return { ...json, created_at: createdIso, createdAt: createdIso };
}

async function listHeldBills(db, branchId) {
  const { HeldBill } = db;
  const rows = await HeldBill.findAll({
    where: { branch_id: branchId },
    order: [['created_at', 'DESC']],
    include: [{ model: db.User, as: 'creator', attributes: ['id', 'name'] }],
  });
  return rows.map(serializeHeldBill);
}

async function resumeHeldBill(db, branchId, heldId) {
  const { HeldBill } = db;
  const held = await HeldBill.findOne({ where: { id: heldId, branch_id: branchId } });
  if (!held) throw new AppError('Held bill not found', 404, 'NOT_FOUND');
  return {
    id: held.id,
    cartData: held.cart_data,
    customerId: held.customer_id,
    name: held.name,
  };
}

async function deleteHeldBill(db, branchId, heldId) {
  const { HeldBill } = db;
  const held = await HeldBill.findOne({ where: { id: heldId, branch_id: branchId } });
  if (!held) throw new AppError('Held bill not found', 404, 'NOT_FOUND');
  await held.destroy();
  return { deleted: true };
}

module.exports = {
  previewBill,
  createBill,
  getBill,
  listBills,
  voidBill,
  holdBill,
  listHeldBills,
  resumeHeldBill,
  deleteHeldBill,
};
