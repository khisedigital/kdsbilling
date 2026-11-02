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

async function createDailyClosing(db, branchId, userId, data) {
  const { SalesOrder, Expense, SalesPayment } = db;
  const closingDate = data.closingDate || new Date().toISOString().slice(0, 10);

  const existing = await db.DailyClosing.findOne({ where: { branch_id: branchId, closing_date: closingDate } });
  if (existing) throw new AppError('Closing already done for this date', 409, 'DUPLICATE');

  const dayStart = new Date(closingDate);
  const dayEnd = new Date(closingDate + 'T23:59:59');

  const totalSales = await SalesOrder.sum('total_amount', {
    where: { branch_id: branchId, status: { [Op.in]: SOLD_BILL_STATUSES }, created_at: { [Op.between]: [dayStart, dayEnd] } },
  }) || 0;

  const cashSalesResult = await db.sequelize.query(`
    SELECT COALESCE(SUM(sp.amount), 0) as total
    FROM sales_payments sp
    JOIN sales_orders so ON sp.sales_order_id = so.id
    WHERE so.branch_id = :branchId AND so.status IN ('completed', 'partially_returned', 'fully_returned')
      AND sp.payment_mode = 'cash'
      AND so.created_at BETWEEN :dayStart AND :dayEnd
  `, {
    replacements: { branchId, dayStart, dayEnd },
    type: db.sequelize.QueryTypes.SELECT,
  });
  const cashSales = cashSalesResult[0]?.total || 0;

  const cashRefundResult = await db.sequelize.query(`
    SELECT COALESCE(SUM(r.refund_amount), 0) as total
    FROM returns r
    WHERE r.branch_id = :branchId
      AND r.status = 'completed'
      AND r.refund_mode = 'cash'
      AND r.created_at BETWEEN :dayStart AND :dayEnd
  `, {
    replacements: { branchId, dayStart, dayEnd },
    type: db.sequelize.QueryTypes.SELECT,
  });
  const cashRefunds = parseFloat(cashRefundResult[0]?.total || 0);

  const totalExpenses = await Expense.sum('amount', {
    where: { branch_id: branchId, expense_date: closingDate, payment_mode: 'cash' },
  }) || 0;

  const openingCash = parseFloat(data.openingCash || 0);
  const expectedCash = openingCash + parseFloat(cashSales) - cashRefunds - parseFloat(totalExpenses);
  const actualCash = parseFloat(data.actualCash);
  if (!Number.isFinite(actualCash)) {
    throw new AppError('Actual cash amount is required', 400, 'VALIDATION_ERROR');
  }
  const variance = actualCash - expectedCash;

  return db.DailyClosing.create({
    branch_id: branchId,
    closing_date: closingDate,
    opening_cash: openingCash,
    expected_cash: expectedCash,
    actual_cash: actualCash,
    variance,
    total_sales: totalSales,
    total_expenses: totalExpenses,
    notes: data.notes || null,
    created_by: userId,
  });
}

async function listClosings(db, branchId) {
  return db.DailyClosing.findAll({
    where: { branch_id: branchId },
    order: [['closing_date', 'DESC']],
    limit: 30,
  });
}

module.exports = {
  listCategories,
  createExpense,
  listExpenses,
  listOffers,
  createDailyClosing,
  listClosings,
};
