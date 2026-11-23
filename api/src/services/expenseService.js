const { Op } = require('sequelize');
const AppError = require('../utils/AppError');
const { SOLD_BILL_STATUSES } = require('../constants/billStatuses');

async function listCategories(db) {
  return db.ExpenseCategory.findAll({ where: { status: 'active' }, order: [['name', 'ASC']] });
}

async function createExpense(db, branchId, userId, data) {
  if (!data.categoryId || !data.amount) throw new AppError('Category and amount required', 400, 'VALIDATION_ERROR');
  return db.Expense.create({
    branch_id: branchId,
    category_id: data.categoryId,
    amount: data.amount,
    payment_mode: data.paymentMode || 'cash',
    expense_date: data.expenseDate || new Date().toISOString().slice(0, 10),
    notes: data.notes || null,
    created_by: userId,
  });
}

async function listExpenses(db, branchId, query) {
  const where = { branch_id: branchId };
  if (query.from) where.expense_date = { [Op.gte]: query.from };
  if (query.to) where.expense_date = { ...(where.expense_date || {}), [Op.lte]: query.to };
  return db.Expense.findAll({
    where,
    include: [{ model: db.ExpenseCategory, as: 'category' }],
    order: [['expense_date', 'DESC']],
    limit: parseInt(query.limit, 10) || 50,
  });
}

async function listOffers(db) {
  return db.Offer.findAll({ where: { status: 'active' }, order: [['name', 'ASC']] });
}

function money(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function parseClosingDetails(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function serializeClosingDetails(details) {
  if (!details) return null;
  return JSON.stringify(details);
}

function formatClosingRow(row) {
  const plain = row?.toJSON ? row.toJSON() : row;
  return {
    ...plain,
    details: parseClosingDetails(plain.details),
  };
}

async function dayBounds(closingDate) {
  const dayStart = new Date(`${closingDate}T00:00:00`);
  const dayEnd = new Date(`${closingDate}T23:59:59.999`);
  return { dayStart, dayEnd };
}

/** Cash / UPI / Card / other totals for the day (UPI & card never enter the drawer). */
async function paymentBreakdownForDay(db, branchId, closingDate) {
  const { dayStart, dayEnd } = await dayBounds(closingDate);
  const rows = await db.sequelize.query(
    `
    SELECT LOWER(TRIM(sp.payment_mode)) AS mode, COALESCE(SUM(sp.amount), 0) AS total
    FROM sales_payments sp
    JOIN sales_orders so ON sp.sales_order_id = so.id
    WHERE so.branch_id = :branchId
      AND so.status IN ('completed', 'partially_returned', 'fully_returned')
      AND so.created_at BETWEEN :dayStart AND :dayEnd
    GROUP BY LOWER(TRIM(sp.payment_mode))
  `,
    {
      replacements: { branchId, dayStart, dayEnd },
      type: db.sequelize.QueryTypes.SELECT,
    },
  );

  const payments = { cash: 0, upi: 0, card: 0, other: 0 };
  for (const row of rows) {
    const mode = String(row.mode || '').toLowerCase();
    const total = money(row.total);
    if (mode === 'cash') payments.cash += total;
    else if (mode === 'upi' || mode === 'qr' || mode === 'gpay' || mode === 'phonepe') payments.upi += total;
    else if (mode === 'card' || mode === 'credit_card' || mode === 'debit_card') payments.card += total;
    else payments.other += total;
  }
  return payments;
}

async function cashRefundsForDay(db, branchId, closingDate) {
  const { dayStart, dayEnd } = await dayBounds(closingDate);
  const rows = await db.sequelize.query(
    `
    SELECT COALESCE(SUM(r.refund_amount), 0) AS total
    FROM returns r
    WHERE r.branch_id = :branchId
      AND r.status = 'completed'
      AND r.refund_mode = 'cash'
      AND r.created_at BETWEEN :dayStart AND :dayEnd
  `,
    {
      replacements: { branchId, dayStart, dayEnd },
      type: db.sequelize.QueryTypes.SELECT,
    },
  );
  return money(rows[0]?.total);
}

async function cashExpensesForDay(db, branchId, closingDate) {
  const total = await db.Expense.sum('amount', {
    where: { branch_id: branchId, expense_date: closingDate, payment_mode: 'cash' },
  });
  return money(total);
}

async function totalSalesForDay(db, branchId, closingDate) {
  const { dayStart, dayEnd } = await dayBounds(closingDate);
  const total = await db.SalesOrder.sum('total_amount', {
    where: {
      branch_id: branchId,
      status: { [Op.in]: SOLD_BILL_STATUSES },
      created_at: { [Op.between]: [dayStart, dayEnd] },
    },
  });
  return money(total);
}

/**
 * Preview today's register numbers before the cashier counts cash.
 * Opening suggestion = yesterday's actual cash (or 0).
 */
async function previewDailyClosing(db, branchId, query = {}) {
  const closingDate = query.closingDate || new Date().toISOString().slice(0, 10);
  const existing = await db.DailyClosing.findOne({
    where: { branch_id: branchId, closing_date: closingDate },
    include: [{ model: db.User, as: 'creator', attributes: ['id', 'name'], required: false }],
  });

  const previous = await db.DailyClosing.findOne({
    where: {
      branch_id: branchId,
      closing_date: { [Op.lt]: closingDate },
    },
    order: [['closing_date', 'DESC']],
  });

  const payments = await paymentBreakdownForDay(db, branchId, closingDate);
  const cashSales = payments.cash;
  const cashRefunds = await cashRefundsForDay(db, branchId, closingDate);
  const cashExpenses = await cashExpensesForDay(db, branchId, closingDate);
  const totalSales = await totalSalesForDay(db, branchId, closingDate);
  const suggestedOpeningCash = previous ? money(previous.actual_cash) : 0;

  return {
    closingDate,
    alreadyClosed: Boolean(existing),
    existingClosing: existing ? formatClosingRow(existing) : null,
    suggestedOpeningCash,
    previousClosingDate: previous?.closing_date || null,
    totalSales,
    payments,
    cashSales,
    cashRefunds,
    cashExpenses,
    /** Cash added is entered by cashier (float top-ups); not from sales. */
    formula:
      'Expected cash = Opening cash + Cash sales + Cash added − Cash refunds − Cash expenses',
  };
}

async function createDailyClosing(db, branchId, userId, data) {
  const closingDate = data.closingDate || new Date().toISOString().slice(0, 10);

  const existing = await db.DailyClosing.findOne({
    where: { branch_id: branchId, closing_date: closingDate },
  });
  if (existing) {
    // Offline sync / second close for the same day → update, don't 409.
    return updateDailyClosing(db, branchId, userId, existing.id, data);
  }

  const payments = await paymentBreakdownForDay(db, branchId, closingDate);
  const cashSales = payments.cash;
  const cashRefunds = await cashRefundsForDay(db, branchId, closingDate);
  const cashExpenses = await cashExpensesForDay(db, branchId, closingDate);
  const totalSales = await totalSalesForDay(db, branchId, closingDate);

  const openingCash = money(data.openingCash);
  const cashAdded = money(data.cashAdded);
  // UPI/Card never enter physical cash.
  const expectedCash = money(openingCash + cashSales + cashAdded - cashRefunds - cashExpenses);
  const actualCash = money(data.actualCash);
  if (!Number.isFinite(parseFloat(data.actualCash))) {
    throw new AppError('Enter the cash you counted in the drawer', 400, 'VALIDATION_ERROR');
  }
  const variance = money(actualCash - expectedCash);

  const remarks = data.notes != null ? String(data.notes).trim() : data.remarks != null ? String(data.remarks).trim() : '';
  const varianceReason =
    data.varianceReason != null ? String(data.varianceReason).trim() : '';

  if (Math.abs(variance) >= 0.01 && !varianceReason) {
    throw new AppError('Please enter a reason when cash does not match', 400, 'VALIDATION_ERROR');
  }

  const denominations = data.denominations && typeof data.denominations === 'object'
    ? data.denominations
    : null;

  const details = {
    version: 1,
    payments,
    cashSales,
    cashRefunds,
    cashExpenses,
    cashAdded,
    denominations,
    varianceReason: varianceReason || null,
    remarks: remarks || null,
    closedByUserId: userId,
  };

  const noteParts = [];
  if (remarks) noteParts.push(remarks);
  if (varianceReason) noteParts.push(`Difference reason: ${varianceReason}`);

  const isValidUuid = (val) =>
    typeof val === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);

  const closingId = isValidUuid(data.id) ? data.id : undefined;

  try {
    const created = await db.DailyClosing.create({
      ...(closingId ? { id: closingId } : {}),
      branch_id: branchId,
      closing_date: closingDate,
      opening_cash: openingCash,
      expected_cash: expectedCash,
      actual_cash: actualCash,
      variance,
      total_sales: totalSales,
      total_expenses: cashExpenses,
      notes: noteParts.length ? noteParts.join('\n') : null,
      details: serializeClosingDetails(details),
      created_by: userId,
    });

    const withCreator = await db.DailyClosing.findByPk(created.id, {
      include: [{ model: db.User, as: 'creator', attributes: ['id', 'name'], required: false }],
    });
    return formatClosingRow(withCreator || created);
  } catch (err) {
    // Race: another device/sync created the same branch+date while we were inserting.
    if (err?.name === 'SequelizeUniqueConstraintError') {
      const raced = await db.DailyClosing.findOne({
        where: { branch_id: branchId, closing_date: closingDate },
      });
      if (raced) {
        return updateDailyClosing(db, branchId, userId, raced.id, data);
      }
    }
    throw err;
  }
}

async function updateDailyClosing(db, branchId, userId, id, data) {
  let existing = null;
  if (id && id !== 'undefined' && id !== 'null') {
    try {
      existing = await db.DailyClosing.findOne({
        where: { id, branch_id: branchId },
      });
    } catch {
      existing = null;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const targetDate = data?.closingDate || data?.closing_date || null;

  // Fallback 1: Lookup by closing_date if not found by id (e.g. offline temporary ID)
  if (!existing && targetDate) {
    existing = await db.DailyClosing.findOne({
      where: { branch_id: branchId, closing_date: targetDate },
    });
  }

  // Fallback 2: Lookup by date if id itself is formatted as YYYY-MM-DD
  if (!existing && typeof id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(id)) {
    existing = await db.DailyClosing.findOne({
      where: { branch_id: branchId, closing_date: id },
    });
  }

  // Fallback 3: Upsert/create if closing does not exist yet on server (e.g. offline closing synced via update)
  if (!existing) {
    if (targetDate) {
      return createDailyClosing(db, branchId, userId, { ...data, closingDate: targetDate });
    }
    throw new AppError('Closing not found', 404, 'NOT_FOUND');
  }

  const effectiveTargetDate = targetDate || today;
  if (existing.closing_date !== effectiveTargetDate && existing.closing_date !== today) {
    throw new AppError("Only today's register can be edited", 400, 'VALIDATION_ERROR');
  }

  const closingDate = existing.closing_date;

  const payments = await paymentBreakdownForDay(db, branchId, closingDate);
  const cashSales = payments.cash;
  const cashRefunds = await cashRefundsForDay(db, branchId, closingDate);
  const cashExpenses = await cashExpensesForDay(db, branchId, closingDate);
  const totalSales = await totalSalesForDay(db, branchId, closingDate);

  const openingCash = money(data.openingCash);
  const cashAdded = money(data.cashAdded);
  const expectedCash = money(openingCash + cashSales + cashAdded - cashRefunds - cashExpenses);
  const actualCash = money(data.actualCash);
  if (!Number.isFinite(parseFloat(data.actualCash))) {
    throw new AppError('Enter the cash you counted in the drawer', 400, 'VALIDATION_ERROR');
  }
  const variance = money(actualCash - expectedCash);

  const remarks = data.notes != null ? String(data.notes).trim() : data.remarks != null ? String(data.remarks).trim() : '';
  const varianceReason =
    data.varianceReason != null ? String(data.varianceReason).trim() : '';

  if (Math.abs(variance) >= 0.01 && !varianceReason) {
    throw new AppError('Please enter a reason when cash does not match', 400, 'VALIDATION_ERROR');
  }

  const denominations = data.denominations && typeof data.denominations === 'object'
    ? data.denominations
    : null;

  const details = {
    version: 1,
    payments,
    cashSales,
    cashRefunds,
    cashExpenses,
    cashAdded,
    denominations,
    varianceReason: varianceReason || null,
    remarks: remarks || null,
    closedByUserId: existing.created_by,
    lastEditedByUserId: userId,
    lastEditedAt: new Date().toISOString(),
  };

  const noteParts = [];
  if (remarks) noteParts.push(remarks);
  if (varianceReason) noteParts.push(`Difference reason: ${varianceReason}`);

  await existing.update({
    opening_cash: openingCash,
    expected_cash: expectedCash,
    actual_cash: actualCash,
    variance,
    total_sales: totalSales,
    total_expenses: cashExpenses,
    notes: noteParts.length ? noteParts.join('\n') : null,
    details: serializeClosingDetails(details),
  });

  const withCreator = await db.DailyClosing.findByPk(existing.id, {
    include: [{ model: db.User, as: 'creator', attributes: ['id', 'name'], required: false }],
  });
  return formatClosingRow(withCreator || existing);
}

async function listClosings(db, branchId) {
  const rows = await db.DailyClosing.findAll({
    where: { branch_id: branchId },
    include: [{ model: db.User, as: 'creator', attributes: ['id', 'name'], required: false }],
    order: [['closing_date', 'DESC']],
    limit: 30,
  });
  return rows.map(formatClosingRow);
}

async function getDailyClosing(db, branchId, id) {
  let row = null;
  if (id && id !== 'undefined' && id !== 'null') {
    try {
      row = await db.DailyClosing.findOne({
        where: { id, branch_id: branchId },
        include: [
          { model: db.User, as: 'creator', attributes: ['id', 'name'], required: false },
          { model: db.Branch, as: 'branch', attributes: ['id', 'name', 'code'], required: false },
        ],
      });
    } catch {
      row = null;
    }
  }
  if (!row && typeof id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(id)) {
    row = await db.DailyClosing.findOne({
      where: { branch_id: branchId, closing_date: id },
      include: [
        { model: db.User, as: 'creator', attributes: ['id', 'name'], required: false },
        { model: db.Branch, as: 'branch', attributes: ['id', 'name', 'code'], required: false },
      ],
    });
  }
  if (!row) throw new AppError('Closing not found', 404, 'NOT_FOUND');
  return formatClosingRow(row);
}

module.exports = {
  listCategories,
  createExpense,
  listExpenses,
  listOffers,
  previewDailyClosing,
  createDailyClosing,
  updateDailyClosing,
  listClosings,
  getDailyClosing,
};
