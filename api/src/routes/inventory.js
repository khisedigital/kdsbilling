const express = require('express');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../constants/permissions');
const asyncHandler = require('../utils/asyncHandler');
const inventory = require('../controllers/inventoryController');

const router = express.Router();

router.use(authMiddleware);

router.get('/branches', asyncHandler(inventory.listBranches));

// Stock
router.get('/stock/balances', requirePermission(PERMISSIONS.STOCK_VIEW), asyncHandler(inventory.listBalances));
router.get('/stock/history', requirePermission(PERMISSIONS.STOCK_VIEW), asyncHandler(inventory.getHistory));
router.post('/stock/opening', requirePermission(PERMISSIONS.STOCK_ADJUST), asyncHandler(inventory.openingStock));
router.post('/stock/in', requirePermission(PERMISSIONS.STOCK_ADJUST), asyncHandler(inventory.stockIn));
router.post('/stock/out', requirePermission(PERMISSIONS.STOCK_ADJUST), asyncHandler(inventory.stockOut));
router.post('/stock/adjust', requirePermission(PERMISSIONS.STOCK_ADJUST), asyncHandler(inventory.adjustStock));
router.post('/stock/damage', requirePermission(PERMISSIONS.STOCK_ADJUST), asyncHandler(inventory.damageStock));
router.post('/stock/transfer', requirePermission(PERMISSIONS.STOCK_ADJUST), asyncHandler(inventory.transferStock));
router.get('/stock/transfers', requirePermission(PERMISSIONS.STOCK_VIEW), asyncHandler(inventory.listTransfers));
router.get('/stock/transfers/:id', requirePermission(PERMISSIONS.STOCK_VIEW), asyncHandler(inventory.getTransfer));

// Suppliers
router.get('/suppliers', requirePermission(PERMISSIONS.SUPPLIER_VIEW), asyncHandler(inventory.listSuppliers));
router.post('/suppliers/bulk-import', requirePermission(PERMISSIONS.SUPPLIER_MANAGE), asyncHandler(inventory.bulkImportSuppliers));
router.post('/suppliers', requirePermission(PERMISSIONS.SUPPLIER_MANAGE), asyncHandler(inventory.createSupplier));
router.put('/suppliers/:id', requirePermission(PERMISSIONS.SUPPLIER_MANAGE), asyncHandler(inventory.updateSupplier));
router.delete('/suppliers/:id', requirePermission(PERMISSIONS.SUPPLIER_MANAGE), asyncHandler(inventory.deleteSupplier));

// Purchase bills
router.get('/purchases/bills', requirePermission(PERMISSIONS.SUPPLIER_VIEW), asyncHandler(inventory.listPurchaseBills));
router.post('/purchases/bills', requirePermission(PERMISSIONS.SUPPLIER_MANAGE), asyncHandler(inventory.createPurchaseBill));
router.get('/purchases/bills/:id', requirePermission(PERMISSIONS.SUPPLIER_VIEW), asyncHandler(inventory.getPurchaseBill));

// Purchase orders
router.get('/purchases/orders', requirePermission(PERMISSIONS.SUPPLIER_VIEW), asyncHandler(inventory.listPurchaseOrders));
router.post('/purchases/orders', requirePermission(PERMISSIONS.SUPPLIER_MANAGE), asyncHandler(inventory.createPurchaseOrder));
router.get('/purchases/orders/:id', requirePermission(PERMISSIONS.SUPPLIER_VIEW), asyncHandler(inventory.getPurchaseOrder));
router.post(
  '/purchases/orders/:id/receive',
  requirePermission(PERMISSIONS.SUPPLIER_MANAGE),
  asyncHandler(inventory.receivePurchaseOrder)
);

module.exports = router;
