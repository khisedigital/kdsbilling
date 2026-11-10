const billingService = require('../services/billingService');
const customerService = require('../services/customerService');
const returnService = require('../services/returnService');
const reportService = require('../services/reportService');
const expenseService = require('../services/expenseService');
const printerService = require('../services/printerService');
const shopSettingsService = require('../services/shopSettingsService');
const { generatePrint } = require('../services/printService');

const branchId = (req) => req.auth.branchId;

function publicBaseUrl(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host');
  return host ? `${proto}://${host}` : null;
}

async function loadShopSettings(req) {
  return shopSettingsService.getShopSettings(req.db, req.tenant, branchId(req));
}

// Dashboard & Reports
async function dashboard(req, res) {
  const data = await reportService.getDashboard(req.db, branchId(req));
  res.json({ success: true, data });
}

async function salesReport(req, res) {
  const data = await reportService.salesReport(req.db, branchId(req), req.query);
  res.json({ success: true, data });
}

async function monthlySalesReport(req, res) {
  const data = await reportService.monthlySalesReport(req.db, branchId(req), req.query);
  res.json({ success: true, data });
}

async function productSalesReport(req, res) {
  const data = await reportService.productSalesReport(req.db, branchId(req), req.query);
  res.json({ success: true, data });
}

async function categorySalesReport(req, res) {
  const data = await reportService.categorySalesReport(req.db, branchId(req), req.query);
  res.json({ success: true, data });
}

async function brandSalesReport(req, res) {
  const data = await reportService.brandSalesReport(req.db, branchId(req), req.query);
  res.json({ success: true, data });
}

async function profitReport(req, res) {
  const data = await reportService.profitReport(req.db, branchId(req), req.query);
  res.json({ success: true, data });
}

async function purchaseReport(req, res) {
  const data = await reportService.purchaseReport(req.db, branchId(req), req.query);
  res.json({ success: true, data });
}

async function gstReport(req, res) {
  const data = await reportService.gstReport(req.db, branchId(req), req.query);
  res.json({ success: true, data });
}

async function stockReport(req, res) {
  const data = await reportService.stockReport(req.db, branchId(req));
  res.json({ success: true, data });
}

async function lowStockReport(req, res) {
  const data = await reportService.lowStockReport(req.db, branchId(req));
  res.json({ success: true, data });
}

async function customerReport(req, res) {
  const data = await reportService.customerReport(req.db, branchId(req), req.query);
  res.json({ success: true, data });
}

async function supplierReport(req, res) {
  const data = await reportService.supplierReport(req.db, branchId(req), req.query);
  res.json({ success: true, data });
}

async function expenseReport(req, res) {
  const data = await reportService.expenseReport(req.db, branchId(req), req.query);
  res.json({ success: true, data });
}

async function cashFlowReport(req, res) {
  const data = await reportService.cashFlowReport(req.db, branchId(req), req.query);
  res.json({ success: true, data });
}

// Billing
async function previewBill(req, res) {
  const data = await billingService.previewBill(req.db, req.body);
  res.json({ success: true, data });
}

async function createBill(req, res) {
  const data = await billingService.createBill(req.db, branchId(req), req.auth.sub, req.body);
  res.status(201).json({ success: true, data });
}

async function getBill(req, res) {
  const data = await billingService.getBill(req.db, req.params.id);
  res.json({ success: true, data });
}

async function listBills(req, res) {
  const data = await billingService.listBills(req.db, branchId(req), req.query);
  res.json({ success: true, data });
}

async function voidBill(req, res) {
  const data = await billingService.voidBill(req.db, branchId(req), req.auth.sub, req.params.id, req.body.reason);
  res.json({ success: true, data });
}

async function printBill(req, res) {
  const bill = await billingService.getBill(req.db, req.params.id);
  const format = req.query.format || '80';
  const shopSettings = await loadShopSettings(req);
  const data = generatePrint(bill, req.tenant, format, shopSettings, publicBaseUrl(req), req.query.language);
  res.json({ success: true, data });
}

async function holdBill(req, res) {
  const data = await billingService.holdBill(req.db, branchId(req), req.auth.sub, req.body);
  res.status(201).json({ success: true, data });
}

async function listHeld(req, res) {
  const data = await billingService.listHeldBills(req.db, branchId(req));
  res.json({ success: true, data });
}

async function resumeHeld(req, res) {
  const data = await billingService.resumeHeldBill(req.db, branchId(req), req.params.id);
  res.json({ success: true, data });
}

async function deleteHeld(req, res) {
  const data = await billingService.deleteHeldBill(req.db, branchId(req), req.params.id);
  res.json({ success: true, data });
}

// Customers
async function listCustomers(req, res) {
  const data = await customerService.listCustomers(req.db, req.query);
  res.json({ success: true, data });
}

async function getCustomer(req, res) {
  const data = await customerService.getCustomer(req.db, req.params.id);
  res.json({ success: true, data });
}

async function createCustomer(req, res) {
  const data = await customerService.createCustomer(req.db, req.body);
  res.status(201).json({ success: true, data });
}

async function updateCustomer(req, res) {
  const data = await customerService.updateCustomer(req.db, req.params.id, req.body);
  res.json({ success: true, data });
}

async function deleteCustomer(req, res) {
  const data = await customerService.deleteCustomer(req.db, req.params.id);
  res.json({ success: true, data });
}

async function addStoreCredit(req, res) {
  const data = await customerService.addStoreCredit(req.db, req.params.id, req.body.amount, req.auth.sub, req.body.notes);
  res.json({ success: true, data });
}

// Returns
async function createReturn(req, res) {
  const data = await returnService.createReturn(req.db, branchId(req), req.auth.sub, req.body);
  res.status(201).json({ success: true, data });
}

async function listReturns(req, res) {
  const data = await returnService.listReturns(req.db, branchId(req), req.query);
  res.json({ success: true, data });
}

async function getReturn(req, res) {
  const data = await returnService.getReturn(req.db, req.params.id);
  res.json({ success: true, data });
}

// Expenses & Offers & Closing
async function listExpenseCategories(req, res) {
  const data = await expenseService.listCategories(req.db);
  res.json({ success: true, data });
}

async function createExpense(req, res) {
  const data = await expenseService.createExpense(req.db, branchId(req), req.auth.sub, req.body);
  res.status(201).json({ success: true, data });
}

async function listExpenses(req, res) {
  const data = await expenseService.listExpenses(req.db, branchId(req), req.query);
  res.json({ success: true, data });
}

async function listOffers(req, res) {
  const data = await expenseService.listOffers(req.db);
  res.json({ success: true, data });
}

async function previewClosing(req, res) {
  const data = await expenseService.previewDailyClosing(req.db, branchId(req), req.query);
  res.json({ success: true, data });
}

async function createClosing(req, res) {
  const data = await expenseService.createDailyClosing(req.db, branchId(req), req.auth.sub, req.body);
  res.status(201).json({ success: true, data });
}

async function listClosings(req, res) {
  const data = await expenseService.listClosings(req.db, branchId(req));
  res.json({ success: true, data });
}

async function getClosing(req, res) {
  const data = await expenseService.getDailyClosing(req.db, branchId(req), req.params.id);
  res.json({ success: true, data });
}

// Printers
async function listPrinters(req, res) {
  const data = await printerService.listPrinters(req.db, branchId(req));
  res.json({ success: true, data });
}

async function createPrinter(req, res) {
  const data = await printerService.createPrinter(req.db, branchId(req), req.body);
  res.status(201).json({ success: true, data });
}

async function updatePrinter(req, res) {
  const data = await printerService.updatePrinter(req.db, branchId(req), req.params.id, req.body);
  res.json({ success: true, data });
}

async function deletePrinter(req, res) {
  const data = await printerService.deletePrinter(req.db, branchId(req), req.params.id);
  res.json({ success: true, data });
}

async function printBillNetwork(req, res) {
  const data = await printerService.printBillNetwork(
    req.db,
    req.tenant,
    req.params.id,
    req.body.printerId,
    await loadShopSettings(req),
    publicBaseUrl(req),
    req.body.language
  );
  res.json({ success: true, data });
}

async function getShopSettings(req, res) {
  const data = await shopSettingsService.getShopSettings(req.db, req.tenant, branchId(req));
  res.json({ success: true, data });
}

async function updateShopSettings(req, res) {
  const data = await shopSettingsService.updateShopSettings(
    req.db,
    req.tenant,
    branchId(req),
    req.body
  );
  res.json({ success: true, data });
}

async function uploadShopLogo(req, res) {
  const data = await shopSettingsService.uploadShopLogo(
    req.db,
    req.tenant,
    branchId(req),
    req.file
  );
  res.json({ success: true, data });
}

async function removeShopLogo(req, res) {
  const data = await shopSettingsService.removeShopLogo(req.db, req.tenant, branchId(req));
  res.json({ success: true, data });
}

module.exports = {
  dashboard, salesReport, monthlySalesReport, productSalesReport, categorySalesReport, brandSalesReport,
  profitReport, purchaseReport, gstReport, stockReport, lowStockReport, customerReport, supplierReport,
  expenseReport, cashFlowReport,
  previewBill, createBill, getBill, listBills, voidBill, printBill,
  holdBill, listHeld, resumeHeld, deleteHeld,
  listCustomers, getCustomer, createCustomer, updateCustomer, deleteCustomer, addStoreCredit,
  createReturn, listReturns, getReturn,
  listExpenseCategories, createExpense, listExpenses, listOffers,
  previewClosing, createClosing, listClosings, getClosing,
  listPrinters, createPrinter, updatePrinter, deletePrinter, printBillNetwork,
  getShopSettings, updateShopSettings, uploadShopLogo, removeShopLogo,
};
