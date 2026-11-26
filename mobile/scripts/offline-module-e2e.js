'use strict';

/**
 * End-to-end offline module test with realistic UI-shaped payloads.
 * Catches regressions like:
 *  - sale_items.id collision across bills (local-item-0)
 *  - Sales list date filter YYYY-MM-DD excluding same-day ISO timestamps
 *  - master upsert wipe
 *
 * Does not mutate the live shop DB.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../desktop/db');

const results = [];
function ok(name, detail = '') {
  results.push({ name, pass: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, err) {
  const detail = err instanceof Error ? err.message : String(err);
  results.push({ name, pass: false, detail });
  console.error(`FAIL  ${name} — ${detail}`);
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function monthFromYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Mimic saleService.buildLocalBill item ids (fixed bug uses bill-scoped ids). */
function buildUiBill(clientBillId, { total, customerName, items }) {
  return {
    id: clientBillId,
    bill_number: `OFF-TEST-${clientBillId.slice(0, 8)}`,
    status: 'completed',
    subtotal: total,
    discount_amount: 0,
    tax_amount: 0,
    round_off_amount: 0,
    total_amount: total,
    paid_amount: total,
    change_amount: 0,
    created_at: new Date().toISOString(),
    customer: customerName ? { id: 'cu-e2e', name: customerName } : null,
    items: items.map((it, idx) => ({
      id: `${clientBillId}-i${idx}`,
      product_name: it.name,
      variant_id: it.variantId,
      quantity: it.qty,
      unit_price: it.price,
      line_total: it.qty * it.price,
      discount_amount: 0,
      sku: it.sku || '',
    })),
    payments: [{ id: `${clientBillId}-p0`, payment_mode: 'cash', amount: total }],
  };
}

/** Old buggy shape — must NOT be used by saveSale (saveSale scopes ids). */
function buildLegacyBuggyBill(clientBillId, total) {
  return {
    id: clientBillId,
    bill_number: `BUG-${clientBillId.slice(0, 6)}`,
    status: 'completed',
    total_amount: total,
    paid_amount: total,
    subtotal: total,
    discount_amount: 0,
    tax_amount: 0,
    items: [
      {
        id: 'local-item-0',
        product_name: 'Collision Product',
        variant_id: 'v1',
        quantity: 1,
        unit_price: total,
        line_total: total,
      },
    ],
    payments: [{ id: 'local-pay-0', payment_mode: 'cash', amount: total }],
  };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kdspoz-e2e-'));
const shop = 'e2e_shop';
let conn;

try {
  conn = db.openShopDb(root, shop);

  // ========== 1. Auth ==========
  try {
    db.saveAuthSession(conn, {
      shopCode: shop,
      mobile: '9876543210',
      passwordHash: 'abc',
      salt: 'xyz',
      accessToken: 'tok',
      refreshToken: 'ref',
      user: { id: 'u-e2e', name: 'E2E User', role: 'owner' },
      tenant: { id: 't-e2e', name: 'E2E Shop', slug: shop },
    });
    const auth = db.readAuthSession(conn);
    assert(auth?.mobile === '9876543210', 'auth mobile');
    assert(auth?.user?.name === 'E2E User', 'auth user');
    ok('1. Login / auth_session', auth.mobile);
  } catch (e) {
    fail('1. Login / auth_session', e);
  }

  // ========== 2. Shop settings ==========
  try {
    db.saveShopSettings(conn, {
      shopName: 'E2E Kirana',
      shopNameMr: 'ई२ई',
      phone: '9876543210',
      address: 'Test Road',
      gstin: '27AAAAA0000A1Z5',
      billFooter: 'Thank you',
    });
    const s = db.readShopSettings(conn);
    assert(s?.shopName === 'E2E Kirana', 'shop name');
    ok('2. Shop settings', s.shopName);
  } catch (e) {
    fail('2. Shop settings', e);
  }

  // ========== 3. Catalog masters (upsert) ==========
  try {
    db.replaceCatalog(conn, {
      clearProducts: false,
      categories: [
        { id: 'cat-food', name: 'Food', status: 'active' },
        { id: 'cat-drink', name: 'Drinks', status: 'active' },
      ],
      brands: [
        { id: 'br-a', name: 'Brand A', status: 'active' },
        { id: 'br-b', name: 'Brand B', status: 'active' },
      ],
      products: [
        {
          id: 'p1',
          name: 'Rice 1kg',
          categoryId: 'cat-food',
          brandId: 'br-a',
          status: 'active',
          isFavorite: true,
          variants: [
            { id: 'v1', sku: 'RICE1', barcode: '890001', sellingPrice: 60, costPrice: 40, stockQty: 100 },
          ],
        },
        {
          id: 'p2',
          name: 'Tea 250g',
          categoryId: 'cat-drink',
          brandId: 'br-b',
          status: 'active',
          variants: [
            { id: 'v2', sku: 'TEA250', barcode: '890002', sellingPrice: 120, costPrice: 80, stockQty: 50 },
          ],
        },
      ],
    });
    // Second sync: update + add, must keep p2
    db.replaceCatalog(conn, {
      clearProducts: false,
      categories: [{ id: 'cat-food', name: 'Food & Grocery', status: 'active' }],
      brands: [{ id: 'br-a', name: 'Brand A+', status: 'active' }],
      products: [
        {
          id: 'p1',
          name: 'Rice 1kg Premium',
          categoryId: 'cat-food',
          brandId: 'br-a',
          status: 'active',
          isFavorite: true,
          variants: [
            { id: 'v1', sku: 'RICE1', barcode: '890001', sellingPrice: 65, costPrice: 40, stockQty: 95 },
          ],
        },
        {
          id: 'p3',
          name: 'Sugar 1kg',
          categoryId: 'cat-food',
          brandId: 'br-a',
          status: 'active',
          variants: [
            { id: 'v3', sku: 'SUG1', sellingPrice: 45, costPrice: 30, stockQty: 80 },
          ],
        },
      ],
    });
    const cats = db.listCategories(conn);
    const brands = db.listBrands(conn);
    const products = db.listProducts(conn, { limit: 50 });
    const billingPage = db.listProducts(conn, { limit: 280 });
    const byCat = db.listProducts(conn, { categoryId: 'cat-food', limit: 50 });
    assert(cats.find((c) => c.id === 'cat-food')?.name === 'Food & Grocery', 'category updated');
    assert(brands.find((b) => b.id === 'br-a')?.name === 'Brand A+', 'brand updated');
    assert(products.find((p) => p.id === 'p2'), 'p2 preserved after upsert');
    assert(products.find((p) => p.id === 'p3'), 'p3 inserted');
    assert(products.find((p) => p.id === 'p1')?.name === 'Rice 1kg Premium', 'p1 updated');
    assert(billingPage.length >= 3, 'billing page has products');
    assert(byCat.every((p) => (p.categoryId || p.category_id) === 'cat-food' || p.id === 'p1' || p.id === 'p3'), 'category filter');
    ok('3. Catalog upsert + billing page', `products=${products.length} cats=${cats.length}`);
  } catch (e) {
    fail('3. Catalog upsert + billing page', e);
  }

  // ========== 4. Product local CRUD ==========
  try {
    db.upsertProductLocal(conn, {
      id: 'p-local',
      name: 'Local Snack',
      category_id: 'cat-food',
      status: 'active',
      variants: [{ id: 'v-local', sku: 'SNK1', selling_price: 20, cost_price: 10, stock_qty: 25 }],
    });
    assert(db.listProducts(conn, { search: 'Local Snack' }).some((p) => p.id === 'p-local'), 'created');
    db.upsertProductLocal(conn, {
      id: 'p-local',
      name: 'Local Snack Updated',
      status: 'active',
      variants: [{ id: 'v-local', sku: 'SNK1', selling_price: 22, cost_price: 10, stock_qty: 25 }],
    });
    assert(
      db.listProducts(conn, { search: 'Local Snack Updated' }).some((p) => p.id === 'p-local'),
      'updated',
    );
    db.deleteProductLocal(conn, 'p-local');
    assert(!db.listProducts(conn, { search: 'Local Snack' }).some((p) => p.id === 'p-local'), 'deleted');
    ok('4. Product create/update/delete');
  } catch (e) {
    fail('4. Product create/update/delete', e);
  }

  // ========== 5. Customers ==========
  try {
    db.replaceCustomers(conn, [
      { id: 'cu-e2e', name: 'Ramesh', phone: '9000000001' },
      { id: 'cu-2', name: 'Sita', phone: '9000000002' },
    ]);
    db.replaceCustomers(conn, [
      { id: 'cu-e2e', name: 'Ramesh Patil', phone: '9000000001' },
      { id: 'cu-3', name: 'Asha', phone: '9000000003' },
    ]);
    const customers = db.listCustomers(conn, { limit: 100 });
    assert(customers.find((c) => c.id === 'cu-2'), 'cu-2 kept');
    assert(customers.find((c) => c.id === 'cu-e2e')?.name === 'Ramesh Patil', 'updated');
    db.upsertCustomer(conn, { id: 'cu-walkin', name: 'Walk-in', phone: null, sync_status: 'pending' });
    ok('5. Customers upsert', `count=${db.listCustomers(conn, { limit: 100 }).length}`);
  } catch (e) {
    fail('5. Customers upsert', e);
  }

  // ========== 6. Suppliers ==========
  try {
    db.replaceSuppliers(conn, [
      { id: 'sup-1', name: 'Wholesale Mart', phone: '8000000001' },
      { id: 'sup-2', name: 'Distributors Co' },
    ]);
    db.replaceSuppliers(conn, [{ id: 'sup-1', name: 'Wholesale Mart Pvt' }, { id: 'sup-3', name: 'New Supplier' }]);
    const suppliers = db.listSuppliers(conn);
    assert(suppliers.find((s) => s.id === 'sup-2'), 'sup-2 kept');
    assert(suppliers.find((s) => s.id === 'sup-1')?.name === 'Wholesale Mart Pvt', 'updated');
    ok('6. Suppliers upsert', `count=${suppliers.length}`);
  } catch (e) {
    fail('6. Suppliers upsert', e);
  }

  // ========== 7. Billing — two sales + legacy id collision ==========
  try {
    const bill1Id = 'e2e-bill-aaaa-1111-2222-333333333331';
    const bill2Id = 'e2e-bill-bbbb-1111-2222-333333333332';
    const bill1 = buildUiBill(bill1Id, {
      total: 120,
      customerName: 'Ramesh Patil',
      items: [{ name: 'Tea 250g', variantId: 'v2', qty: 1, price: 120 }],
    });
    const bill2 = buildUiBill(bill2Id, {
      total: 130,
      customerName: 'Ramesh Patil',
      items: [
        { name: 'Rice 1kg Premium', variantId: 'v1', qty: 1, price: 65 },
        { name: 'Sugar 1kg', variantId: 'v3', qty: 1, price: 45 },
        { name: 'Tea 250g', variantId: 'v2', qty: 0.166, price: 120 },
      ],
    });
    // Force line totals for bill2 simplicity
    bill2.items = [
      { id: `${bill2Id}-i0`, product_name: 'Rice 1kg Premium', variant_id: 'v1', quantity: 1, unit_price: 65, line_total: 65 },
      { id: `${bill2Id}-i1`, product_name: 'Sugar 1kg', variant_id: 'v3', quantity: 1, unit_price: 45, line_total: 45 },
    ];
    bill2.total_amount = 110;
    bill2.paid_amount = 110;
    bill2.payments = [{ id: `${bill2Id}-p0`, payment_mode: 'cash', amount: 110 }];

    db.saveSale(conn, {
      clientBillId: bill1Id,
      syncStatus: 'pending',
      createdAt: new Date().toISOString(),
      bill: bill1,
      payload: { customerId: 'cu-e2e', payments: [{ mode: 'cash', amount: 120 }] },
    });
    db.saveSale(conn, {
      clientBillId: bill2Id,
      syncStatus: 'pending',
      createdAt: new Date().toISOString(),
      bill: bill2,
      payload: { customerId: 'cu-e2e', payments: [{ mode: 'cash', amount: 110 }] },
    });

    // Legacy colliding ids — saveSale must rewrite to bill-scoped ids
    const bug1 = 'e2e-bug-bill-1';
    const bug2 = 'e2e-bug-bill-2';
    db.saveSale(conn, {
      clientBillId: bug1,
      syncStatus: 'pending',
      createdAt: new Date().toISOString(),
      bill: buildLegacyBuggyBill(bug1, 50),
      payload: {},
      skipStock: true,
    });
    db.saveSale(conn, {
      clientBillId: bug2,
      syncStatus: 'pending',
      createdAt: new Date().toISOString(),
      bill: buildLegacyBuggyBill(bug2, 75),
      payload: {},
      skipStock: true,
    });

    const pending = db.listPendingSales(conn);
    assert(pending.length >= 4, `pending expected >=4 got ${pending.length}`);
    assert(db.getSale(conn, bill1Id), 'getSale bill1');
    assert(db.getSale(conn, bill2Id), 'getSale bill2');
    ok('7. Billing save 2+ bills (incl. colliding item ids)', `pending=${pending.length}`);
  } catch (e) {
    fail('7. Billing save 2+ bills (incl. colliding item ids)', e);
  }

  // ========== 8. Sales list with UI month date filter ==========
  try {
    const from = monthFromYmd();
    const to = todayYmd();
    const listed = db.listSales(conn, { from, to, limit: 500 });
    const ids = listed.items.map((b) => b.client_bill_id || b.id);
    assert(
      ids.some((id) => String(id).includes('e2e-bill-aaaa')),
      `bill1 missing in list for ${from}..${to}; got ${ids.slice(0, 5).join(',')}`,
    );
    assert(
      ids.some((id) => String(id).includes('e2e-bill-bbbb')),
      'bill2 missing in month list',
    );
    // Regression: date-only `to` must not hide today's timed bills
    const dayOnly = db.listSales(conn, { from: to, to, limit: 500 });
    assert(dayOnly.items.length >= 2, `day filter returned ${dayOnly.items.length}`);
    ok('8. Sales list (UI YYYY-MM-DD filter)', `month=${listed.items.length} today=${dayOnly.items.length}`);
  } catch (e) {
    fail('8. Sales list (UI YYYY-MM-DD filter)', e);
  }

  // ========== 9. Held bills ==========
  try {
    db.saveHeldBill(conn, {
      id: 'hold-e2e',
      name: 'Counter hold',
      customerId: 'cu-e2e',
      cartData: { items: [{ variantId: 'v1', qty: 2 }] },
    });
    assert(db.listHeldBills(conn).some((h) => h.id === 'hold-e2e'), 'listed');
    db.deleteHeldBill(conn, 'hold-e2e');
    assert(!db.listHeldBills(conn).some((h) => h.id === 'hold-e2e'), 'deleted');
    ok('9. Held bills');
  } catch (e) {
    fail('9. Held bills', e);
  }

  // ========== 10. Expenses ==========
  try {
    db.saveExpense(conn, {
      id: 'exp-e2e',
      amount: 200,
      category: 'Rent',
      notes: 'shop rent',
      expense_date: todayYmd(),
    });
    db.saveExpense(conn, {
      id: 'exp-e2e-2',
      amount: 40,
      category: 'Tea',
      expense_date: todayYmd(),
    });
    const expenses = db.listExpenses(conn, { from: todayYmd(), to: todayYmd(), limit: 50 });
    assert(expenses.some((e) => e.id === 'exp-e2e'), 'expense listed');
    ok('10. Expenses', `count=${expenses.length}`);
  } catch (e) {
    fail('10. Expenses', e);
  }

  // ========== 11. Returns ==========
  try {
    db.saveReturn(conn, {
      id: 'ret-e2e',
      sales_order_id: 'e2e-bill-aaaa-1111-2222-333333333331',
      return_number: 'CN-E2E-1',
      total_amount: 60,
      syncStatus: 'pending',
      items: [{ variantId: 'v2', quantity: 0.5, product_name: 'Tea 250g' }],
    });
    // Pull-style synced return must not double-restock
    db.saveReturn(conn, {
      id: 'ret-pulled',
      sales_order_id: 'srv-x',
      total_amount: 10,
      syncStatus: 'synced',
      skipStock: true,
      items: [{ variantId: 'v1', quantity: 1 }],
    });
    const returns = db.listReturns(conn, { limit: 20 });
    assert(returns.some((r) => r.id === 'ret-e2e'), 'return listed');
    ok('11. Returns', `count=${returns.length}`);
  } catch (e) {
    fail('11. Returns', e);
  }

  // ========== 12. Purchases ==========
  try {
    db.savePurchase(conn, {
      id: 'pur-e2e',
      supplier_id: 'sup-1',
      supplier_name: 'Wholesale Mart Pvt',
      bill_number: 'PUR-1',
      total_amount: 1000,
      items: [{ product_name: 'Rice 1kg Premium', quantity: 10, cost: 40 }],
    });
    assert(db.listPurchases(conn).some((p) => p.id === 'pur-e2e'), 'listed');
    assert(db.getPurchase(conn, 'pur-e2e')?.id === 'pur-e2e', 'get');
    ok('12. Purchase bills');
  } catch (e) {
    fail('12. Purchase bills', e);
  }

  // ========== 13. Stock ==========
  try {
    const before = db.listProducts(conn, { search: 'Rice' }).find((p) => p.id === 'p1');
    db.saveStockMovement(conn, {
      id: 'stk-e2e',
      variantId: 'v1',
      qtyDelta: 5,
      reason: 'in',
      notes: 'purchase in',
    });
    const moves = db.listStockMovements(conn, { limit: 20 });
    assert(moves.some((m) => m.id === 'stk-e2e'), 'movement listed');
    ok('13. Stock movements', `moves=${moves.length}`);
    void before;
  } catch (e) {
    fail('13. Stock movements', e);
  }

  // ========== 14. Customer ledger ==========
  try {
    db.addCustomerLedger(conn, {
      id: 'led-e2e-1',
      customer_id: 'cu-e2e',
      type: 'credit',
      amount: 500,
      notes: 'advance',
    });
    db.addCustomerLedger(conn, {
      id: 'led-e2e-2',
      customerId: 'cu-e2e',
      entryType: 'sale',
      amount: 120,
      referenceId: 'e2e-bill-aaaa-1111-2222-333333333331',
    });
    const ledger = db.listCustomerLedger(conn, 'cu-e2e');
    assert(ledger.length >= 1, 'ledger entries');
    ok('14. Customer ledger', `entries=${ledger.length}`);
  } catch (e) {
    fail('14. Customer ledger', e);
  }

  // ========== 14a. Delete pending local sale ==========
  try {
    const deleteId = 'e2e-local-delete-sale';
    const stockBefore = db.listProducts(conn, { limit: 50 })
      .find((p) => p.id === 'p1').variants.find((v) => v.id === 'v1').stockQty;
    const bill = buildUiBill(deleteId, {
      total: 130,
      customerName: 'Ramesh Patil',
      items: [{ name: 'Rice 1kg Premium', variantId: 'v1', qty: 2, price: 65 }],
    });
    db.saveSale(conn, {
      clientBillId: deleteId,
      syncStatus: 'pending',
      createdAt: new Date().toISOString(),
      bill,
      payload: {},
    });
    const balanceBefore = db.listCustomers(conn).find((c) => c.id === 'cu-e2e')
      .store_credit_balance;
    db.addCustomerLedger(conn, {
      id: `${deleteId}-store_credit`,
      customerId: 'cu-e2e',
      entryType: 'store_credit_use',
      amount: 20,
      referenceType: 'sale',
      referenceId: deleteId,
      syncStatus: 'pending',
    });
    db.enqueueSync(conn, {
      entityType: 'customer_ledger',
      entityId: `${deleteId}-store_credit`,
      op: 'create',
      payload: { id: `${deleteId}-store_credit` },
    });

    const deleted = db.deletePendingSale(conn, deleteId);
    const stockAfter = db.listProducts(conn, { limit: 50 })
      .find((p) => p.id === 'p1').variants.find((v) => v.id === 'v1').stockQty;
    const balanceAfter = db.listCustomers(conn).find((c) => c.id === 'cu-e2e')
      .store_credit_balance;
    const queuedLedger = db.listPendingSyncQueue(conn)
      .some((row) => row.entityId === `${deleteId}-store_credit`);
    assert(deleted.deleted, 'sale deleted');
    assert(!db.getSale(conn, deleteId), 'sale removed');
    assert(stockAfter === stockBefore, `stock restored: ${stockBefore} -> ${stockAfter}`);
    assert(balanceAfter === balanceBefore, `wallet balance restored: ${balanceBefore} -> ${balanceAfter}`);
    assert(!queuedLedger, 'pending ledger sync removed');
    ok('14a. Delete pending local sale', `stock=${stockAfter} wallet=${balanceAfter}`);
  } catch (e) {
    fail('14a. Delete pending local sale', e);
  }

  // ========== 15. Daily closing ==========
  try {
    const preview = db.previewDailyClosingLocal(conn, todayYmd());
    assert(preview && typeof preview.totalSales === 'number', 'preview');
    assert(preview.totalSales > 0, `expected sales in preview, got ${preview.totalSales}`);
    db.saveDailyClosing(conn, {
      id: 'dc-e2e',
      closing_date: todayYmd(),
      opening_cash: 0,
      closing_cash: preview.totalSales,
      total_sales: preview.totalSales,
    });
    assert(db.listDailyClosings(conn).some((c) => c.id === 'dc-e2e'), 'saved');
    ok('15. Daily closing', `totalSales=${preview.totalSales}`);
  } catch (e) {
    fail('15. Daily closing', e);
  }

  // ========== 16. Dashboard + reports ==========
  try {
    const dash = db.buildDashboard(conn);
    assert(dash, 'dashboard');
    const from = monthFromYmd();
    const to = todayYmd();
    const salesR = db.buildSalesReport(conn, { from, to });
    assert(salesR, 'sales report');
    const profit = db.buildProfitReport(conn, { from, to });
    assert(profit && typeof profit.revenue === 'number', 'profit');
    const gst = db.buildGstReport(conn, { from, to });
    assert(gst && gst.bills >= 1, `gst bills=${gst?.bills}`);
    const cash = db.buildCashFlowReport(conn, { from, to });
    assert(cash, 'cashflow');
    ok('16. Dashboard + reports', `gst.bills=${gst.bills} profit.rev=${profit.revenue}`);
  } catch (e) {
    fail('16. Dashboard + reports', e);
  }

  // ========== 17. Sync queue ==========
  try {
    db.enqueueSync(conn, {
      entityType: 'customer',
      entityId: 'cu-walkin',
      op: 'create',
      payload: { name: 'Walk-in' },
    });
    db.enqueueSync(conn, {
      entityType: 'product',
      entityId: 'p3',
      op: 'update',
      payload: { id: 'p3', name: 'Sugar 1kg' },
    });
    db.enqueueSync(conn, {
      entityType: 'expense',
      entityId: 'exp-e2e',
      op: 'create',
      payload: { id: 'exp-e2e', amount: 200 },
    });
    const queue = db.listPendingSyncQueue(conn);
    assert(queue.length >= 3, `queue ${queue.length}`);
    db.markSyncQueueDone(conn, queue[0].id);
    db.setMeta(conn, 'last_sync_at', new Date().toISOString());
    assert(db.getMeta(conn, 'last_sync_at'), 'meta');
    ok('17. Sync queue + meta', `queued=${queue.length}`);
  } catch (e) {
    fail('17. Sync queue + meta', e);
  }

  // ========== 18. Mark sale synced (push path) ==========
  try {
    const pendingBefore = db.pendingSaleCount(conn);
    const one = db.listPendingSales(conn)[0];
    assert(one, 'has pending');
    const serverBill = {
      ...one.bill,
      id: 'server-e2e-1',
      items: one.bill.items.map((item) => ({
        ...item,
        product_name: 'Server product detail',
        unit_price: 89,
        line_total: 89,
      })),
    };
    db.saveSale(conn, {
      clientBillId: one.clientBillId,
      serverBillId: serverBill.id,
      syncStatus: 'synced',
      skipStock: true,
      createdAt: one.createdAt,
      payload: one.payload,
      bill: serverBill,
    });
    db.markSaleSynced(conn, one.clientBillId, serverBill.id);
    assert(db.pendingSaleCount(conn) === pendingBefore - 1, 'pending decreased');
    assert(db.getSale(conn, one.clientBillId).items[0].product_name === 'Server product detail', 'server item details saved');
    assert(Number(db.getSale(conn, one.clientBillId).items[0].unit_price) === 89, 'server item price saved');
    let syncedDeleteRejected = false;
    try {
      db.deletePendingSale(conn, one.clientBillId);
    } catch (err) {
      syncedDeleteRejected = /only unsynced local sales/i.test(err.message);
    }
    assert(syncedDeleteRejected, 'synced sale cannot be deleted');
    ok('18. Mark sale synced', `pending ${pendingBefore}→${db.pendingSaleCount(conn)}`);
  } catch (e) {
    fail('18. Mark sale synced', e);
  }

  // ========== 19. JSON masters (expense categories) ==========
  try {
    db.replaceJsonTable(conn, 'expense_categories', [
      { id: 'ec1', name: 'Rent' },
      { id: 'ec2', name: 'Tea' },
    ]);
    db.replaceJsonTable(conn, 'expense_categories', [
      { id: 'ec1', name: 'Rent/Lease' },
      { id: 'ec3', name: 'Misc' },
    ]);
    const rows = db.listJsonTable(conn, 'expense_categories');
    assert(rows.length >= 3, 'upsert kept rows');
    ok('19. Expense categories upsert', `count=${rows.length}`);
  } catch (e) {
    fail('19. Expense categories upsert', e);
  }

  // ========== 20. Search products (billing search) ==========
  try {
    const found = db.listProducts(conn, { search: '890001', limit: 20 });
    assert(found.some((p) => p.id === 'p1'), 'barcode search');
    const byName = db.listProducts(conn, { search: 'Sugar', limit: 20 });
    assert(byName.some((p) => p.id === 'p3'), 'name search');
    ok('20. Product search (name/barcode)', `barcode=${found.length} name=${byName.length}`);
  } catch (e) {
    fail('20. Product search (name/barcode)', e);
  }

  // ========== 21. Locally generated barcodes in billing ==========
  try {
    db.upsertProductLocal(conn, {
      id: 'barcode-product', name: 'Local barcode product', category_id: 'barcode-cat',
      variants: [{ id: 'barcode-variant', sku: 'LOCAL', sellingPrice: 25 }],
    });
    const oldJson = conn.prepare(`SELECT json FROM products WHERE id = ?`).get('barcode-product').json;
    const unit = db.generateBarcodesLocal(conn, ['barcode-variant'])[0];
    const pack = db.ensureQuantityBarcodesLocal(conn, [{ variantId: 'barcode-variant', quantity: 2.5 }])[0];
    assert(unit?.barcode && pack?.barcode, 'barcodes generated');

    // Simulate older/stale product JSON; the barcode table is the authoritative source.
    conn.prepare(`UPDATE products SET json = ? WHERE id = ?`).run(oldJson, 'barcode-product');
    db.upsertProductLocal(conn, {
      id: 'barcode-decoy', name: unit.barcode, category_id: 'barcode-cat',
      variants: [{ id: 'barcode-decoy-variant', sku: 'DECOY' }],
    });
    const unitResult = db.listProducts(conn, { search: unit.barcode, limit: 1, categoryId: 'barcode-cat' })[0];
    assert(unitResult?.id === 'barcode-product', 'exact barcode wins over a name match');
    assert(unitResult.variants[0].barcode === unit.barcode, 'generated unit barcode hydrated');
    const packResult = db.listProducts(conn, { search: pack.barcode, limit: 1 })[0];
    assert(packResult?.id === 'barcode-product', 'generated pack barcode found');
    assert(
      packResult.variants[0].quantityBarcodes.some((b) => b.barcode === pack.barcode && b.quantity === 2.5),
      'pack quantity hydrated',
    );
    ok('21. Local barcode search');
  } catch (e) {
    fail('21. Local barcode search', e);
  }

  // ========== 22. Product changes remain local until sync ==========
  try {
    db.upsertProductLocal(conn, {
      id: 'existing-barcode-product', name: 'Existing barcode product',
      variants: [{ id: 'existing-barcode-variant', sku: 'EXISTING', sellingPrice: 10 }],
    });
    const generated = db.generateBarcodesAndQueue(conn, ['existing-barcode-variant']);
    const pack = db.generateBarcodesAndQueue(conn, [{ variantId: 'existing-barcode-variant', quantity: 3 }], true);
    const queued = db.listPendingSyncQueue(conn).filter((row) => row.entityId === 'existing-barcode-product');
    assert(queued.length === 2, 'generated barcodes queued for manual sync');
    assert(queued[1].payload.variants[0].quantityBarcodes.some((b) => b.barcode === pack[0].barcode), 'pack code queued');
    assert(generated[0].barcode, 'unit code generated');
    const before = db.getProduct(conn, 'existing-barcode-product');
    try {
      db.generateBarcodesAndQueue(conn, ['missing-variant']);
      throw new Error('missing variant was accepted');
    } catch (err) {
      assert(/not found/.test(err.message), 'missing variant reports an error');
    }
    assert(db.getProduct(conn, 'existing-barcode-product').variants[0].barcode === before.variants[0].barcode, 'failed generation rolled back');

    db.upsertProductLocal(conn, {
      id: 'local-only-delete', name: 'Unsynced', variants: [{ id: 'local-only-variant', sku: 'LOCAL-DELETE' }],
    });
    db.enqueueSync(conn, { entityType: 'product', entityId: 'local-only-delete', op: 'create', payload: {} });
    db.deleteProductAndQueue(conn, 'local-only-delete');
    assert(!db.listPendingSyncQueue(conn).some((row) => row.entityId === 'local-only-delete'), 'unsynced create cancelled');
    db.deleteProductAndQueue(conn, 'existing-barcode-product');
    const pending = db.listPendingSyncQueue(conn).filter((row) => row.entityId === 'existing-barcode-product');
    assert(pending.length === 1 && pending[0].op === 'delete', 'existing product deletion queued');
    db.upsertProductLocal(conn, {
      id: 'pending-stock-product', name: 'Pending stock',
      variants: [{ id: 'pending-stock-variant', sku: 'PENDING-STOCK' }],
    });
    const stockQueue = db.enqueueSync(conn, {
      entityType: 'stock_movement', entityId: 'move-pending', op: 'adjust',
      payload: { item: { variantId: 'pending-stock-variant' } },
    });
    try {
      db.deleteProductAndQueue(conn, 'pending-stock-product');
      throw new Error('pending stock movement was ignored');
    } catch (err) {
      assert(/pending transactions/.test(err.message), 'pending stock movement blocks deletion');
    }
    assert(db.getProduct(conn, 'pending-stock-product'), 'blocked deletion retains product');
    db.markSyncQueueDone(conn, stockQueue.id);
    db.deleteProductAndQueue(conn, 'pending-stock-product');
    db.upsertProductLocal(conn, {
      id: 'mapped-create', name: 'Mapped product', variants: [{ id: 'mapped-variant' }],
    });
    db.enqueueSync(conn, { entityType: 'product', entityId: 'mapped-create', op: 'create', payload: {} });
    db.setMeta(conn, 'product_sync_id_map', JSON.stringify({ 'mapped-create': 'remote-product' }));
    db.deleteProductAndQueue(conn, 'mapped-create');
    assert(db.listPendingSyncQueue(conn).some((row) => row.entityId === 'mapped-create' && row.op === 'delete'),
      'partially synced creation queues deletion');
    db.upsertProductLocal(conn, {
      id: 'filter-product', name: 'Filter product', brandId: 'filter-brand',
      status: 'inactive', variants: [{ id: 'filter-variant', sku: 'FILTER-SKU' }],
    });
    const filter = { status: 'inactive', brandId: 'filter-brand', search: 'FILTER-SKU' };
    assert(db.countProducts(conn, filter) === 1, 'filtered total matches search');
    assert(db.listProducts(conn, filter)[0].id === 'filter-product', 'filtered page matches total');
    try {
      db.upsertProductsAndQueue(conn, [
        { id: 'atomic-product', name: 'Atomic', variants: [] },
        { name: 'Missing ID' },
      ], { entityType: 'product', entityId: 'atomic-product', op: 'create', payload: {} });
      throw new Error('invalid product was accepted');
    } catch (err) {
      assert(/product.id required/.test(err.message), 'invalid product reports an error');
    }
    assert(!db.getProduct(conn, 'atomic-product'), 'failed batch rolls back product writes');
    assert(!db.listPendingSyncQueue(conn).some((row) => row.entityId === 'atomic-product'),
      'failed batch does not queue sync');
    ok('22. Local barcode and delete queue');
  } catch (e) {
    fail('22. Local barcode and delete queue', e);
  }

  try {
    const id = 'local-only-bill';
    const bill = buildUiBill(id, {
      total: 10, items: [{ name: 'Rice', variantId: 'v1', qty: 1, price: 10 }],
    });
    db.saveSale(conn, { clientBillId: id, bill, payload: { items: [] }, syncStatus: 'pending', skipStock: true });
    db.markSaleSyncError(conn, id, 'missing variant', 1, true);
    const queued = db.enqueueSync(conn, { entityType: 'expense', entityId: 'local-only-expense', op: 'create', payload: {} });
    db.markSyncQueueError(conn, queued.id, 'invalid expense', 1, true);
    assert(!db.listPendingSales(conn).some((row) => row.clientBillId === id), 'local-only sale is not retried');
    assert(!db.listPendingSyncQueue(conn).some((row) => row.id === queued.id), 'local-only queue record is not retried');
    assert(db.getStatus(conn).localOnlyCount === 2, 'local-only records counted');
    assert(conn.prepare('SELECT last_error FROM sales WHERE client_bill_id = ?').get(id).last_error === 'missing variant', 'sale error preserved');
    db.saveSale(conn, { clientBillId: id, bill: { ...bill, total_amount: 999 }, syncStatus: 'synced', skipStock: true, insertOnly: true });
    assert(Number(db.getSale(conn, id).total_amount) === 10, 'pull cannot overwrite local-only bill');
    ok('23. Local-only records persist');
  } catch (e) {
    fail('23. Local-only records persist', e);
  }

  try {
    const bill = buildUiBill('retry-missing-product', {
      total: 10, items: [{ name: 'Rice', variantId: 'v1', qty: 1, price: 10 }],
    });
    for (const id of ['retry-missing-product', 'retry-conflict', 'retry-ambiguous', 'retry-no-client-id', 'retry-other-error']) {
      db.saveSale(conn, {
        clientBillId: id,
        bill: { ...bill, id },
        payload: id === 'retry-no-client-id' ? {} : { clientBillId: id },
        syncStatus: 'pending',
        skipStock: true,
      });
      const error = id === 'retry-other-error' ? 'Invalid customer'
        : id === 'retry-conflict'
          ? 'Cannot safely sync product: SKU, barcode or product identity conflicts with the live catalog'
          : id === 'retry-ambiguous'
            ? 'Cannot safely match local variant v1 to the live catalog. The bill is still pending; verify the product and stock before resolving it.'
            : 'Variant not found: v1';
      db.markSaleSyncError(conn, id, error, 1, true);
    }
    assert(db.retryMissingVariantSales(conn) === 1, 'only missing-variant bills with a retry ID are requeued');
    const pending = db.listPendingSales(conn).map((row) => row.clientBillId);
    assert(pending.includes('retry-missing-product'), 'missing-variant bill retried');
    assert(!pending.includes('retry-conflict') && !pending.includes('retry-ambiguous'), 'identity conflicts remain local-only');
    assert(!pending.includes('retry-no-client-id') && !pending.includes('retry-other-error'), 'unrelated local-only bills retained');
    assert(db.retryMissingVariantSales(conn) === 0, 'pending bill is not requeued twice');
    ok('23a. Retry missing-variant bills');
  } catch (e) {
    fail('23a. Retry missing-variant bills', e);
  }

  try {
    const before = db.getProduct(conn, 'p1');
    const result = db.replaceCatalog(conn, {
      insertOnly: true,
      products: [
        { id: 'p1', name: 'Overwritten', variants: [
          { id: 'v1', stockQty: 999, quantityBarcodes: [{ barcode: '9876500000001', quantity: 2 }] },
          { id: 'v1-new', sku: 'RICE-NEW', barcode: '9876500000002', stockQty: 4 },
        ] },
        { id: 'pull-new', name: 'New live product', variants: [{ id: 'pull-new-v', barcode: '9876543210987', stockQty: 3 }] },
      ],
    });
    assert(result.products === 2, 'new product and missing variants counted');
    assert(db.getProduct(conn, 'p1').name === before.name, 'existing product preserved');
    assert(db.getProduct(conn, 'p1').variants[0].stockQty === before.variants[0].stockQty, 'local stock preserved');
    assert(db.getProduct(conn, 'p1').variants.some((v) => v.id === 'v1-new'), 'missing live variant added');
    assert(db.getProduct(conn, 'p1').variants[0].quantityBarcodes.some((v) => v.barcode === '9876500000001'), 'missing live pack barcode added');
    assert(db.getProduct(conn, 'pull-new'), 'missing product added');
    try {
      db.replaceCatalog(conn, { insertOnly: true, products: [
        { id: 'collision', name: 'Conflict', variants: [{ id: 'collision-v', barcode: '9876543210987' }] },
      ] });
      throw new Error('conflicting barcode was accepted');
    } catch (err) {
      assert(/barcode belongs/.test(err.message), 'barcode conflict reported');
    }
    assert(!db.getProduct(conn, 'collision'), 'conflicting import rolled back');
    try {
      db.replaceCatalog(conn, { insertOnly: true, products: [
        { id: 'duplicate-codes', name: 'Conflict', variants: [
          { id: 'duplicate-a', barcode: '9876500000003' },
          { id: 'duplicate-b', barcode: '9876500000003' },
        ] },
      ] });
      throw new Error('duplicate incoming barcodes were accepted');
    } catch (err) {
      assert(/barcode belongs/.test(err.message), 'duplicate incoming barcodes reported');
    }
    assert(!db.getProduct(conn, 'duplicate-codes'), 'duplicate incoming barcode import rolled back');
    db.replaceCustomers(conn, [{ id: 'cu-e2e', name: 'Overwrite' }, { id: 'new-customer', name: 'New' }], true);
    assert(db.listCustomers(conn).find((c) => c.id === 'cu-e2e').name !== 'Overwrite', 'existing customer preserved');
    assert(db.listCustomers(conn).some((c) => c.id === 'new-customer'), 'missing customer added');
    ok('24. Add-only pull preserves local data');
  } catch (e) {
    fail('24. Add-only pull preserves local data', e);
  }
} finally {
  try {
    db.closeAll();
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;
console.log('\n=== E2E RESULT ===');
console.log(`${passed} passed, ${failed} failed, ${results.length} total`);
if (failed) {
  console.log('Failed:');
  for (const r of results.filter((x) => !x.pass)) console.log(`  - ${r.name}: ${r.detail}`);
}
process.exit(failed ? 1 : 0);
