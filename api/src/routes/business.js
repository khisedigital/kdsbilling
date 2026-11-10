const express = require('express');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../constants/permissions');
const asyncHandler = require('../utils/asyncHandler');
const upload = require('../middleware/upload');
const biz = require('../controllers/businessController');

const router = express.Router();
router.use(authMiddleware);

// Dashboard & Reports
router.get('/dashboard', requirePermission(PERMISSIONS.DASHBOARD_VIEW), asyncHandler(biz.dashboard));
router.get('/reports/sales', requirePermission(PERMISSIONS.REPORT_VIEW), asyncHandler(biz.salesReport));
router.get('/reports/sales/monthly', requirePermission(PERMISSIONS.REPORT_VIEW), asyncHandler(biz.monthlySalesReport));
router.get('/reports/products', requirePermission(PERMISSIONS.REPORT_VIEW), asyncHandler(biz.productSalesReport));
router.get('/reports/categories', requirePermission(PERMISSIONS.REPORT_VIEW), asyncHandler(biz.categorySalesReport));
router.get('/reports/brands', requirePermission(PERMISSIONS.REPORT_VIEW), asyncHandler(biz.brandSalesReport));
router.get('/reports/profit', requirePermission(PERMISSIONS.REPORT_VIEW), asyncHandler(biz.profitReport));
router.get('/reports/purchases', requirePermission(PERMISSIONS.REPORT_VIEW), asyncHandler(biz.purchaseReport));
router.get('/reports/gst', requirePermission(PERMISSIONS.REPORT_VIEW), asyncHandler(biz.gstReport));
router.get('/reports/stock', requirePermission(PERMISSIONS.REPORT_VIEW), asyncHandler(biz.stockReport));
router.get('/reports/stock/low', requirePermission(PERMISSIONS.REPORT_VIEW), asyncHandler(biz.lowStockReport));
router.get('/reports/customers', requirePermission(PERMISSIONS.REPORT_VIEW), asyncHandler(biz.customerReport));
router.get('/reports/suppliers', requirePermission(PERMISSIONS.REPORT_VIEW), asyncHandler(biz.supplierReport));
router.get('/reports/expenses', requirePermission(PERMISSIONS.REPORT_VIEW), asyncHandler(biz.expenseReport));
router.get('/reports/cash-flow', requirePermission(PERMISSIONS.REPORT_VIEW), asyncHandler(biz.cashFlowReport));

// Billing
router.post('/bills/preview', requirePermission(PERMISSIONS.BILL_CREATE), asyncHandler(biz.previewBill));
router.post('/bills', requirePermission(PERMISSIONS.BILL_CREATE), asyncHandler(biz.createBill));
router.get('/bills', requirePermission(PERMISSIONS.BILL_CREATE), asyncHandler(biz.listBills));
router.get('/bills/held/list', requirePermission(PERMISSIONS.BILL_HOLD), asyncHandler(biz.listHeld));
router.post('/bills/hold', requirePermission(PERMISSIONS.BILL_HOLD), asyncHandler(biz.holdBill));
router.post('/bills/held/:id/resume', requirePermission(PERMISSIONS.BILL_HOLD), asyncHandler(biz.resumeHeld));
router.delete('/bills/held/:id', requirePermission(PERMISSIONS.BILL_HOLD), asyncHandler(biz.deleteHeld));
router.get('/bills/:id', requirePermission(PERMISSIONS.BILL_CREATE), asyncHandler(biz.getBill));
router.get('/bills/:id/print', requirePermission(PERMISSIONS.BILL_REPRINT), asyncHandler(biz.printBill));
router.post('/bills/:id/void', requirePermission(PERMISSIONS.BILL_VOID), asyncHandler(biz.voidBill));

// Customers
router.get('/customers', requirePermission(PERMISSIONS.CUSTOMER_VIEW), asyncHandler(biz.listCustomers));
router.post('/customers', requirePermission(PERMISSIONS.CUSTOMER_MANAGE), asyncHandler(biz.createCustomer));
router.get('/customers/:id', requirePermission(PERMISSIONS.CUSTOMER_VIEW), asyncHandler(biz.getCustomer));
router.put('/customers/:id', requirePermission(PERMISSIONS.CUSTOMER_MANAGE), asyncHandler(biz.updateCustomer));
router.delete('/customers/:id', requirePermission(PERMISSIONS.CUSTOMER_MANAGE), asyncHandler(biz.deleteCustomer));
router.post('/customers/:id/store-credit', requirePermission(PERMISSIONS.CUSTOMER_MANAGE), asyncHandler(biz.addStoreCredit));

// Returns
router.post('/returns', requirePermission(PERMISSIONS.BILL_CREATE), asyncHandler(biz.createReturn));
router.get('/returns', requirePermission(PERMISSIONS.BILL_CREATE), asyncHandler(biz.listReturns));
router.get('/returns/:id', requirePermission(PERMISSIONS.BILL_CREATE), asyncHandler(biz.getReturn));

// Expenses & Offers & Closing
router.get('/expense-categories', requirePermission(PERMISSIONS.EXPENSE_MANAGE), asyncHandler(biz.listExpenseCategories));
router.get('/expenses', requirePermission(PERMISSIONS.EXPENSE_MANAGE), asyncHandler(biz.listExpenses));
router.post('/expenses', requirePermission(PERMISSIONS.EXPENSE_MANAGE), asyncHandler(biz.createExpense));
router.get('/offers', requirePermission(PERMISSIONS.BILL_CREATE), asyncHandler(biz.listOffers));
router.get('/daily-closings/preview', requirePermission(PERMISSIONS.CLOSING_MANAGE), asyncHandler(biz.previewClosing));
router.get('/daily-closings', requirePermission(PERMISSIONS.CLOSING_MANAGE), asyncHandler(biz.listClosings));
router.get('/daily-closings/:id', requirePermission(PERMISSIONS.CLOSING_MANAGE), asyncHandler(biz.getClosing));
router.post('/daily-closings', requirePermission(PERMISSIONS.CLOSING_MANAGE), asyncHandler(biz.createClosing));

// Printers
router.get('/printers', requirePermission(PERMISSIONS.SETTINGS_MANAGE), asyncHandler(biz.listPrinters));
router.post('/printers', requirePermission(PERMISSIONS.SETTINGS_MANAGE), asyncHandler(biz.createPrinter));
router.put('/printers/:id', requirePermission(PERMISSIONS.SETTINGS_MANAGE), asyncHandler(biz.updatePrinter));
router.delete('/printers/:id', requirePermission(PERMISSIONS.SETTINGS_MANAGE), asyncHandler(biz.deletePrinter));
router.post('/bills/:id/print-network', requirePermission(PERMISSIONS.BILL_REPRINT), asyncHandler(biz.printBillNetwork));

// Shop / bill settings
router.get('/shop-settings', requirePermission(PERMISSIONS.SETTINGS_MANAGE), asyncHandler(biz.getShopSettings));
router.patch('/shop-settings', requirePermission(PERMISSIONS.SETTINGS_MANAGE), asyncHandler(biz.updateShopSettings));
router.post(
  '/shop-settings/logo',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  upload.single('image'),
  asyncHandler(biz.uploadShopLogo)
);
router.delete(
  '/shop-settings/logo',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  asyncHandler(biz.removeShopLogo)
);

module.exports = router;
