const { Op } = require('sequelize');
const AppError = require('../utils/AppError');
const { getPagination, paginatedResponse } = require('../utils/pagination');
const { MOVEMENT_TYPES, applyStockMovement, generateDocNumber } = require('./stockEngine');

const variantInclude = (db) => ({
  model: db.ProductVariant,
  as: 'variant',
  attributes: ['id', 'sku', 'size', 'color'],
  include: [{ model: db.Product, as: 'product', attributes: ['id', 'name'] }],
});

async function listSuppliers(db, query) {
  const { Supplier } = db;
  const where = { deleted_at: null };
  if (query.search) where.name = { [Op.like]: `%${query.search}%` };
  if (query.status) where.status = query.status;
  return Supplier.findAll({ where, order: [['name', 'ASC']] });
}

async function createSupplier(db, data) {
  const { Supplier } = db;
  if (!data.name?.trim()) throw new AppError('Supplier name is required', 400, 'VALIDATION_ERROR');
  return Supplier.create({
    name: data.name.trim(),
    phone: data.phone || null,
    email: data.email || null,
    address: data.address || null,
    tax_number: data.taxNumber || null,
    status: data.status || 'active',
  });
}

async function updateSupplier(db, id, data) {
  const { Supplier } = db;
  const supplier = await Supplier.findOne({ where: { id, deleted_at: null } });
  if (!supplier) throw new AppError('Supplier not found', 404, 'NOT_FOUND');

  await supplier.update({
    name: data.name?.trim() ?? supplier.name,
    phone: data.phone !== undefined ? data.phone : supplier.phone,
    email: data.email !== undefined ? data.email : supplier.email,
    address: data.address !== undefined ? data.address : supplier.address,
    tax_number: data.taxNumber !== undefined ? data.taxNumber : supplier.tax_number,
    status: data.status ?? supplier.status,
  });
  return supplier;
}

async function deleteSupplier(db, id) {
  const { Supplier } = db;
  const supplier = await Supplier.findOne({ where: { id, deleted_at: null } });
  if (!supplier) throw new AppError('Supplier not found', 404, 'NOT_FOUND');
  await supplier.update({ deleted_at: new Date(), status: 'inactive' });
  return { deleted: true };
}

async function createPurchaseBill(db, branchId, userId, data) {
  const { PurchaseBill, PurchaseBillItem, Supplier } = db;

  if (!data.supplierId) throw new AppError('Supplier is required', 400, 'VALIDATION_ERROR');
  if (!data.items?.length) throw new AppError('At least one item is required', 400, 'VALIDATION_ERROR');

  const supplier = await Supplier.findOne({ where: { id: data.supplierId, deleted_at: null } });
  if (!supplier) throw new AppError('Supplier not found', 404, 'NOT_FOUND');

  const transaction = await db.sequelize.transaction();
  try {
    let subtotal = 0;
    let taxAmount = 0;

    const bill = await PurchaseBill.create(
      {
        bill_number: data.billNumber || generateDocNumber('PB'),
        supplier_id: data.supplierId,
        branch_id: branchId,
        purchase_order_id: data.purchaseOrderId || null,
        bill_date: data.billDate || new Date().toISOString().slice(0, 10),
        notes: data.notes || null,
        status: 'confirmed',
        created_by: userId,
      },
      { transaction }
    );

    for (const item of data.items) {
      const qty = parseFloat(item.quantity);
      const unitCost = parseFloat(item.unitCost);
      const itemTax = parseFloat(item.taxAmount || 0);
      const lineTotal = qty * unitCost + itemTax;

      if (!item.variantId || Number.isNaN(qty) || qty <= 0 || Number.isNaN(unitCost)) {
        throw new AppError('Invalid purchase item', 400, 'VALIDATION_ERROR');
      }

      await PurchaseBillItem.create(
        {
          purchase_bill_id: bill.id,
          variant_id: item.variantId,
          quantity: qty,
          unit_cost: unitCost,
          tax_amount: itemTax,
          total_amount: lineTotal,
        },
        { transaction }
      );

      await applyStockMovement(
        db,
        {
          branchId,
          variantId: item.variantId,
          quantityChange: qty,
          movementType: MOVEMENT_TYPES.PURCHASE_IN,
          referenceType: 'purchase_bill',
          referenceId: bill.id,
          unitCost,
          notes: `Purchase bill ${bill.bill_number}`,
          userId,
        },
        transaction
      );

      subtotal += qty * unitCost;
      taxAmount += itemTax;
    }

    await bill.update(
      {
        subtotal,
        tax_amount: taxAmount,
        total_amount: subtotal + taxAmount,
      },
      { transaction }
    );

    await transaction.commit();
    return getPurchaseBill(db, bill.id);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function getPurchaseBill(db, id) {
  const { PurchaseBill } = db;
  const bill = await PurchaseBill.findByPk(id, {
    include: [
      { model: db.Supplier, as: 'supplier', attributes: ['id', 'name', 'phone'] },
      { model: db.Branch, as: 'branch', attributes: ['id', 'name', 'code'] },
      {
        model: db.PurchaseBillItem,
        as: 'items',
        include: [variantInclude(db)],
      },
      { model: db.User, as: 'creator', attributes: ['id', 'name'] },
    ],
  });
  if (!bill) throw new AppError('Purchase bill not found', 404, 'NOT_FOUND');
  return bill;
}

async function listPurchaseBills(db, branchId, query) {
  const { PurchaseBill } = db;
  const { page, limit, offset } = getPagination(query);
  const where = { branch_id: branchId };
  if (query.supplierId) where.supplier_id = query.supplierId;
  if (query.status) where.status = query.status;

  const { rows, count } = await PurchaseBill.findAndCountAll({
    where,
    include: [
      { model: db.Supplier, as: 'supplier', attributes: ['id', 'name'] },
      { model: db.Branch, as: 'branch', attributes: ['id', 'name', 'code'] },
    ],
    order: [['bill_date', 'DESC']],
    limit,
    offset,
  });

  return paginatedResponse(rows, count, { page, limit });
}

async function createPurchaseOrder(db, branchId, userId, data) {
  const { PurchaseOrder, PurchaseOrderItem, Supplier } = db;

  if (!data.supplierId) throw new AppError('Supplier is required', 400, 'VALIDATION_ERROR');
  if (!data.items?.length) throw new AppError('At least one item is required', 400, 'VALIDATION_ERROR');

  const supplier = await Supplier.findOne({ where: { id: data.supplierId, deleted_at: null } });
  if (!supplier) throw new AppError('Supplier not found', 404, 'NOT_FOUND');

  const transaction = await db.sequelize.transaction();
  try {
    const po = await PurchaseOrder.create(
      {
        po_number: data.poNumber || generateDocNumber('PO'),
        supplier_id: data.supplierId,
        branch_id: branchId,
        status: data.status || 'ordered',
        order_date: data.orderDate || new Date().toISOString().slice(0, 10),
        expected_date: data.expectedDate || null,
        notes: data.notes || null,
        created_by: userId,
      },
      { transaction }
    );

    for (const item of data.items) {
      await PurchaseOrderItem.create(
        {
          purchase_order_id: po.id,
          variant_id: item.variantId,
          quantity: item.quantity,
          unit_cost: item.unitCost || 0,
        },
        { transaction }
      );
    }

    await transaction.commit();
    return getPurchaseOrder(db, po.id);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function getPurchaseOrder(db, id) {
  const { PurchaseOrder } = db;
  const po = await PurchaseOrder.findByPk(id, {
    include: [
      { model: db.Supplier, as: 'supplier', attributes: ['id', 'name', 'phone'] },
      { model: db.Branch, as: 'branch', attributes: ['id', 'name', 'code'] },
      {
        model: db.PurchaseOrderItem,
        as: 'items',
        include: [variantInclude(db)],
      },
      { model: db.User, as: 'creator', attributes: ['id', 'name'] },
    ],
  });
  if (!po) throw new AppError('Purchase order not found', 404, 'NOT_FOUND');
  return po;
}

async function listPurchaseOrders(db, branchId, query) {
  const { PurchaseOrder } = db;
  const { page, limit, offset } = getPagination(query);
  const where = { branch_id: branchId };
  if (query.status) where.status = query.status;
  if (query.supplierId) where.supplier_id = query.supplierId;

  const { rows, count } = await PurchaseOrder.findAndCountAll({
    where,
    include: [{ model: db.Supplier, as: 'supplier', attributes: ['id', 'name'] }],
    order: [['order_date', 'DESC']],
    limit,
    offset,
  });

  return paginatedResponse(rows, count, { page, limit });
}

async function receivePurchaseOrder(db, branchId, userId, poId, data) {
  const po = await getPurchaseOrder(db, poId);
  if (!['ordered', 'partial'].includes(po.status)) {
    throw new AppError('Purchase order cannot be received', 400, 'INVALID_STATUS');
  }

  const items = (data?.items || po.items).map((item) => ({
    variantId: item.variant_id || item.variantId,
    quantity: item.quantity,
    unitCost: item.unit_cost || item.unitCost,
    taxAmount: item.tax_amount || item.taxAmount || 0,
  }));

  // Mark PO received first with a guard so a second receive cannot race after stock is posted.
  const { PurchaseOrder } = db;
  const [updated] = await PurchaseOrder.update(
    { status: 'received' },
    { where: { id: poId, status: { [Op.in]: ['ordered', 'partial'] } } },
  );
  if (!updated) {
    throw new AppError('Purchase order cannot be received', 400, 'INVALID_STATUS');
  }

  try {
    const bill = await createPurchaseBill(db, branchId, userId, {
      supplierId: po.supplier_id,
      purchaseOrderId: po.id,
      billDate: data?.billDate,
      notes: data?.notes || `Received from PO ${po.po_number}`,
      items,
    });
    return bill;
  } catch (err) {
    // Roll PO status back if bill/stock posting fails.
    await PurchaseOrder.update(
      { status: po.status },
      { where: { id: poId, status: 'received' } },
    );
    throw err;
  }
}

module.exports = {
  listSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  createPurchaseBill,
  getPurchaseBill,
  listPurchaseBills,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  receivePurchaseOrder,
};
