const { Op } = require('sequelize');
const AppError = require('../utils/AppError');
const { SOLD_BILL_STATUSES } = require('../constants/billStatuses');
const { getPagination, paginatedResponse } = require('../utils/pagination');

async function listCustomers(db, query) {
  const { Customer } = db;
  const { page, limit, offset } = getPagination(query);
  const where = { deleted_at: null };
  if (query.search) {
    where[Op.or] = [
      { name: { [Op.like]: `%${query.search}%` } },
      { phone: { [Op.like]: `%${query.search}%` } },
    ];
  }

  const { rows, count } = await Customer.findAndCountAll({
    where,
    order: [['name', 'ASC']],
    limit,
    offset,
  });
  return paginatedResponse(rows, count, { page, limit });
}

async function getCustomer(db, id) {
  const { Customer, CustomerLedger, SalesOrder } = db;
  const customer = await Customer.findOne({
    where: { id, deleted_at: null },
    include: [
      { model: CustomerLedger, as: 'ledger', limit: 20, order: [['created_at', 'DESC']] },
    ],
  });
  if (!customer) throw new AppError('Customer not found', 404, 'NOT_FOUND');

  const purchases = await SalesOrder.findAll({
    where: { customer_id: id, status: { [Op.in]: SOLD_BILL_STATUSES } },
    order: [['created_at', 'DESC']],
    limit: 10,
    attributes: ['id', 'bill_number', 'total_amount', 'created_at'],
  });

  return { ...customer.toJSON(), recentPurchases: purchases };
}

async function createCustomer(db, data) {
  const { Customer } = db;
  if (!data.name?.trim()) throw new AppError('Name required', 400, 'VALIDATION_ERROR');
  return Customer.create({
    name: data.name.trim(),
    phone: data.phone || null,
    email: data.email || null,
    address: data.address || null,
    notes: data.notes || null,
  });
}

async function updateCustomer(db, id, data) {
  const { Customer } = db;
  const customer = await Customer.findOne({ where: { id, deleted_at: null } });
  if (!customer) throw new AppError('Customer not found', 404, 'NOT_FOUND');
  await customer.update({
    name: data.name?.trim() ?? customer.name,
    phone: data.phone !== undefined ? data.phone : customer.phone,
    email: data.email !== undefined ? data.email : customer.email,
    address: data.address !== undefined ? data.address : customer.address,
    notes: data.notes !== undefined ? data.notes : customer.notes,
  });
  return customer;
}

async function deleteCustomer(db, id) {
  const { Customer } = db;
  const customer = await Customer.findOne({ where: { id, deleted_at: null } });
  if (!customer) throw new AppError('Customer not found', 404, 'NOT_FOUND');
  await customer.update({ deleted_at: new Date(), status: 'inactive' });
  return { deleted: true };
}

async function addStoreCredit(db, customerId, amount, userId, notes) {
  const { Customer, CustomerLedger } = db;
  const credit = parseFloat(amount);
  if (!Number.isFinite(credit) || credit <= 0) {
    throw new AppError('Credit amount must be a positive number', 400, 'VALIDATION_ERROR');
  }

  const transaction = await db.sequelize.transaction();
  try {
    const customer = await Customer.findOne({
      where: { id: customerId, deleted_at: null },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!customer) throw new AppError('Customer not found', 404, 'NOT_FOUND');

    const newBal = parseFloat(customer.store_credit_balance) + credit;
    await customer.update({ store_credit_balance: newBal }, { transaction });
    await CustomerLedger.create({
      customer_id: customerId,
      entry_type: 'store_credit_add',
      amount: credit,
      balance_after: newBal,
      notes,
      created_by: userId,
    }, { transaction });

    await transaction.commit();
    return customer;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = { listCustomers, getCustomer, createCustomer, updateCustomer, deleteCustomer, addStoreCredit };
