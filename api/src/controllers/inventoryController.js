const stockService = require('../services/stockService');
const purchaseService = require('../services/purchaseService');

function getBranchId(req) {
  return req.auth.branchId;
}

async function listBranches(req, res) {
  const { Branch } = req.db;
  const branches = await Branch.findAll({
    where: { status: 'active' },
    attributes: ['id', 'name', 'code', 'is_default'],
    order: [['name', 'ASC']],
  });
  res.json({ success: true, data: branches });
}

// Stock balances & history
async function listBalances(req, res) {
  const data = await stockService.listBalances(req.db, getBranchId(req), req.query);
  res.json({ success: true, data });
}

async function getHistory(req, res) {
  const data = await stockService.getStockHistory(req.db, getBranchId(req), req.query);
  res.json({ success: true, data });
}

async function openingStock(req, res) {
  const data = await stockService.recordOpeningStock(
    req.db,
    getBranchId(req),
    req.auth.sub,
    req.body.items
  );
  res.status(201).json({ success: true, data });
}

async function stockIn(req, res) {
  const data = await stockService.recordStockIn(
    req.db,
    getBranchId(req),
    req.auth.sub,
    req.body.items,
    req.body.notes
  );
  res.status(201).json({ success: true, data });
}

async function stockOut(req, res) {
  const data = await stockService.recordStockOut(
    req.db,
    getBranchId(req),
    req.auth.sub,
    req.body.items,
    req.body.notes
  );
  res.status(201).json({ success: true, data });
}

async function adjustStock(req, res) {
  const data = await stockService.recordAdjustment(
    req.db,
    getBranchId(req),
    req.auth.sub,
    req.body.items,
    req.body.notes
  );
  res.status(201).json({ success: true, data });
}

async function damageStock(req, res) {
  const data = await stockService.recordDamage(
    req.db,
    getBranchId(req),
    req.auth.sub,
    req.body.items,
    req.body.notes
  );
  res.status(201).json({ success: true, data });
}

async function transferStock(req, res) {
  const data = await stockService.transferStock(req.db, req.auth.sub, {
    fromBranchId: req.body.fromBranchId || req.auth.branchId,
    toBranchId: req.body.toBranchId,
    items: req.body.items,
    notes: req.body.notes,
  });
  res.status(201).json({ success: true, data });
}

async function listTransfers(req, res) {
  const data = await stockService.listTransfers(req.db, req.query);
  res.json({ success: true, data });
}

async function getTransfer(req, res) {
  const data = await stockService.getTransfer(req.db, req.params.id);
  res.json({ success: true, data });
}

// Suppliers
async function listSuppliers(req, res) {
  const data = await purchaseService.listSuppliers(req.db, req.query);
  res.json({ success: true, data });
}

async function createSupplier(req, res) {
  const data = await purchaseService.createSupplier(req.db, req.body);
  res.status(201).json({ success: true, data });
}

async function bulkImportSuppliers(req, res) {
  const data = await purchaseService.bulkImportSuppliers(req.db, req.body.rows);
  res.status(201).json({ success: true, data });
}

async function updateSupplier(req, res) {
  const data = await purchaseService.updateSupplier(req.db, req.params.id, req.body);
  res.json({ success: true, data });
}

async function deleteSupplier(req, res) {
  const data = await purchaseService.deleteSupplier(req.db, req.params.id);
  res.json({ success: true, data });
}

// Purchase bills
async function listPurchaseBills(req, res) {
  const data = await purchaseService.listPurchaseBills(req.db, getBranchId(req), req.query);
  res.json({ success: true, data });
}

async function createPurchaseBill(req, res) {
  const data = await purchaseService.createPurchaseBill(
    req.db,
    getBranchId(req),
    req.auth.sub,
    req.body
  );
  res.status(201).json({ success: true, data });
}

async function getPurchaseBill(req, res) {
  const data = await purchaseService.getPurchaseBill(req.db, req.params.id);
  res.json({ success: true, data });
}

// Purchase orders
async function listPurchaseOrders(req, res) {
  const data = await purchaseService.listPurchaseOrders(req.db, getBranchId(req), req.query);
  res.json({ success: true, data });
}

async function createPurchaseOrder(req, res) {
  const data = await purchaseService.createPurchaseOrder(
    req.db,
    getBranchId(req),
    req.auth.sub,
    req.body
  );
  res.status(201).json({ success: true, data });
}

async function getPurchaseOrder(req, res) {
  const data = await purchaseService.getPurchaseOrder(req.db, req.params.id);
  res.json({ success: true, data });
}

async function receivePurchaseOrder(req, res) {
  const data = await purchaseService.receivePurchaseOrder(
    req.db,
    getBranchId(req),
    req.auth.sub,
    req.params.id,
    req.body
  );
  res.status(201).json({ success: true, data });
}

module.exports = {
  listBalances,
  getHistory,
  openingStock,
  stockIn,
  stockOut,
  adjustStock,
  damageStock,
  transferStock,
  listTransfers,
  getTransfer,
  listSuppliers,
  createSupplier,
  bulkImportSuppliers,
  updateSupplier,
  deleteSupplier,
  listPurchaseBills,
  createPurchaseBill,
  getPurchaseBill,
  listPurchaseOrders,
  createPurchaseOrder,
  getPurchaseOrder,
  receivePurchaseOrder,
  listBranches,
};
