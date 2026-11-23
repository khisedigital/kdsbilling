'use strict';

/**
 * Offline module smoke test — exercises every local SQLite module path.
 * Uses a temp DB so the live shop DB is never mutated.
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kdspoz-smoke-'));
const shop = 'smoke_test';
let conn;

try {
  conn = db.openShopDb(root, shop);

  // --- Auth / shop ---
  try {
    db.saveAuthSession(conn, {
      shopCode: shop,
      mobile: '9999999999',
      passwordHash: 'hash',
      salt: 'salt',
      accessToken: 'tok',
      refreshToken: 'ref',
      user: { id: 'u1', name: 'Tester' },
      tenant: { id: 't1', name: 'Smoke Shop', slug: shop },
    });
    const auth = db.readAuthSession(conn);
    assert(auth?.mobile === '9999999999', 'auth mobile');
    assert(auth?.user?.name === 'Tester', 'auth user');
    ok('Login / auth_session', `mobile=${auth.mobile}`);
  } catch (e) {
    fail('Login / auth_session', e);
  }

  try {
    db.saveShopSettings(conn, { shopName: 'Smoke Shop', phone: '9999999999', gstin: '27AAAAA0000A1Z5' });
    const shopSet = db.readShopSettings(conn);
    assert(shopSet?.shopName === 'Smoke Shop', 'shop name');
    ok('Shop settings', shopSet.shopName);
  } catch (e) {
    fail('Shop settings', e);
  }

  // --- Catalog upsert (no wipe) ---
  try {
    db.replaceCatalog(conn, {
      clearProducts: false,
      categories: [
        { id: 'c1', name: 'Cat A', nameMr: 'कॅट अ', status: 'active' },
        { id: 'c2', name: 'Cat B', status: 'active' },
      ],
      brands: [
        { id: 'b1', name: 'Brand X', status: 'active' },
        { id: 'b2', name: 'Brand Y', status: 'active' },
      ],
      products: [
        {
          id: 'p1',
          name: 'Product One',
          categoryId: 'c1',
          brandId: 'b1',
          status: 'active',
          variants: [
            { id: 'v1', sku: 'SKU1', barcode: '111', sellingPrice: 100, costPrice: 60, stockQty: 10 },
          ],
        },
        {
          id: 'p2',
          name: 'Product Two',
          categoryId: 'c2',
          brandId: 'b2',
          status: 'active',
          variants: [
            { id: 'v2', sku: 'SKU2', barcode: '222', sellingPrice: 200, costPrice: 120, stockQty: 5 },
          ],
        },
      ],
    });
    // Second pull: update p1, add p3 — must keep p2
    db.replaceCatalog(conn, {
      clearProducts: false,
      categories: [{ id: 'c1', name: 'Cat A Updated', status: 'active' }],
      brands: [{ id: 'b1', name: 'Brand X Updated', status: 'active' }],
      products: [
        {
          id: 'p1',
          name: 'Product One Updated',
          categoryId: 'c1',
          brandId: 'b1',
          status: 'active',
          variants: [
            { id: 'v1', sku: 'SKU1', barcode: '111', sellingPrice: 110, costPrice: 60, stockQty: 12 },
          ],
        },
        {
          id: 'p3',
          name: 'Product Three',
          categoryId: 'c1',
          brandId: 'b1',
          status: 'active',
          variants: [
            { id: 'v3', sku: 'SKU3', sellingPrice: 50, costPrice: 30, stockQty: 3 },
          ],
        },
      ],
    });
    const cats = db.listCategories(conn);
    const brands = db.listBrands(conn);
    const products = db.listProducts(conn, { limit: 100 });
    assert(cats.length >= 2, `categories expected >=2 got ${cats.length}`);
    assert(brands.length >= 2, `brands expected >=2 got ${brands.length}`);
    assert(products.length >= 3, `products expected >=3 got ${products.length}`);
    const p1 = products.find((p) => p.id === 'p1');
    const p2 = products.find((p) => p.id === 'p2');
    assert(p1?.name === 'Product One Updated', 'p1 updated');
    assert(p1?.variants?.[0]?.stockQty === 12, `p1 variant stock expected 12 got ${p1?.variants?.[0]?.stockQty}`);
    assert(p1?.stockQty === 12, `p1 total stock expected 12 got ${p1?.stockQty}`);
    assert(p2, 'p2 preserved after upsert pull');
    const catA = cats.find((c) => c.id === 'c1');
    assert(catA?.name === 'Cat A Updated', 'category updated');
    ok(
      'Catalog upsert (products/brands/categories)',
      `cats=${cats.length} brands=${brands.length} products=${products.length}`,
    );
  } catch (e) {
    fail('Catalog upsert (products/brands/categories)', e);
  }

  // --- Customers upsert (no wipe) ---
  try {
    db.replaceCustomers(conn, [
      { id: 'cu1', name: 'Ram', phone: '9000000001' },
      { id: 'cu2', name: 'Shyam', phone: '9000000002' },
    ]);
    db.replaceCustomers(conn, [{ id: 'cu1', name: 'Ram Updated', phone: '9000000001' }, { id: 'cu3', name: 'Sita', phone: '9000000003' }]);
    const customers = db.listCustomers(conn, { limit: 100 });
    assert(customers.length >= 3, `customers expected >=3 got ${customers.length}`);
    assert(customers.find((c) => c.id === 'cu1')?.name === 'Ram Updated', 'customer updated');
    assert(customers.find((c) => c.id === 'cu2'), 'cu2 preserved');
    db.upsertCustomer(conn, { id: 'cu4', name: 'Local New', phone: '9000000004', sync_status: 'pending' });
    ok('Customers upsert', `count=${db.listCustomers(conn, { limit: 100 }).length}`);
  } catch (e) {
    fail('Customers upsert', e);
  }

  // --- Suppliers upsert ---
  try {
    db.replaceSuppliers(conn, [
      { id: 's1', name: 'Supplier A', phone: '8000000001' },
      { id: 's2', name: 'Supplier B' },
    ]);
    db.replaceSuppliers(conn, [{ id: 's1', name: 'Supplier A Updated' }, { id: 's3', name: 'Supplier C' }]);
    const suppliers = db.listSuppliers(conn);
    assert(suppliers.length >= 3, `suppliers expected >=3 got ${suppliers.length}`);
    assert(suppliers.find((s) => s.id === 's1')?.name === 'Supplier A Updated', 'supplier updated');
    assert(suppliers.find((s) => s.id === 's2'), 's2 preserved');
    ok('Suppliers upsert', `count=${suppliers.length}`);
  } catch (e) {
    fail('Suppliers upsert', e);
  }

  // --- Product local CRUD ---
  try {
    db.upsertProductLocal(conn, {
      id: 'p-local',
      name: 'Local Product',
      status: 'active',
      variants: [{ id: 'v-local', sku: 'LOC1', selling_price: 99, cost_price: 50, stock_qty: 7 }],
    });
    const listed = db.listProducts(conn, { search: 'Local Product', limit: 10 });
    assert(listed.some((p) => p.id === 'p-local'), 'local product listed');
    db.deleteProductLocal(conn, 'p-local');
    const after = db.listProducts(conn, { search: 'Local Product', limit: 10 });
    assert(!after.some((p) => p.id === 'p-local'), 'local product deleted');
    ok('Product create/edit/delete (local)');
  } catch (e) {
    fail('Product create/edit/delete (local)', e);
  }

  // --- Product barcode status & generation (local) ---
  try {
    db.upsertProductLocal(conn, {
      id: 'p-barcode-test',
      name: 'Barcode Test Item',
      status: 'active',
      variants: [{ id: 'v-b1', sku: 'BAR1', selling_price: 150, cost_price: 100, stock_qty: 10 }],
    });
    const status1 = db.getProductBarcodeStatusLocal(conn, 'p-barcode-test');
    assert(status1?.productId === 'p-barcode-test', 'barcode status product id');
    assert(status1?.variants?.[0]?.status === 'missing', 'barcode initial status missing');

    const gen = db.generateBarcodesLocal(conn, ['v-b1']);
    assert(gen?.[0]?.barcode && gen[0].generated === true, 'barcode generated');

    const status2 = db.getProductBarcodeStatusLocal(conn, 'p-barcode-test');
    assert(status2?.variants?.[0]?.status === 'available', 'barcode now available');
    assert(status2?.variants?.[0]?.barcode === gen[0].barcode, 'barcode matched');

    const pack = db.ensureQuantityBarcodesLocal(conn, [{ variantId: 'v-b1', quantity: 5 }]);
    assert(pack?.[0]?.barcode && pack[0].quantity === 5, 'pack barcode generated');

    const status3 = db.getProductBarcodeStatusLocal(conn, 'p-barcode-test');
    assert(status3?.variants?.[0]?.quantityBarcodes?.length === 1, 'quantity barcode attached');
    assert(status3?.variants?.[0]?.quantityBarcodes?.[0]?.quantity === 5, 'quantity barcode qty 5');

    db.deleteProductLocal(conn, 'p-barcode-test');
    ok('Product barcode status & generation (local)');
  } catch (e) {
    fail('Product barcode status & generation (local)', e);
  }

  // --- Billing / sales ---
  try {
    const clientBillId = `smoke-bill-${Date.now()}`;
    db.saveSale(conn, {
      clientBillId,
      syncStatus: 'pending',
      bill: {
        bill_number: 'SMOKE-1',
        status: 'completed',
        customer: { id: 'cu1', name: 'Ram Updated' },
        subtotal: 110,
        discount_amount: 0,
        tax_amount: 0,
        total_amount: 110,
        paid_amount: 110,
        items: [
          {
            id: 'li1',
            variant_id: 'v1',
            product_name: 'Product One Updated',
            sku: 'SKU1',
            quantity: 1,
            unit_price: 110,
            line_total: 110,
          },
        ],
        payments: [{ id: 'pay1', mode: 'cash', amount: 110 }],
      },
      payload: {
        customerId: 'cu1',
        payments: [{ mode: 'cash', amount: 110 }],
        items: [{ variantId: 'v1', quantity: 1, unitPrice: 110 }],
      },
    });
    const pending = db.listPendingSales(conn);
    assert(pending.some((r) => r.clientBillId === clientBillId), 'sale pending');
    const sales = db.listSales(conn, { limit: 50 });
    assert(sales.items.some((s) => s.client_bill_id === clientBillId || s.id === clientBillId || s.bill_number === 'SMOKE-1'), 'sale listed');
    const got = db.getSale(conn, clientBillId);
    assert(got, 'getSale');
    db.markSaleSynced(conn, clientBillId, 'server-1');
    assert(db.pendingSaleCount(conn) === 0 || !db.listPendingSales(conn).some((r) => r.clientBillId === clientBillId), 'marked synced');
    ok('Billing / sales save+list+sync mark', `bill=${clientBillId}`);
  } catch (e) {
    fail('Billing / sales save+list+sync mark', e);
  }

  // --- Held bills ---
  try {
    db.saveHeldBill(conn, {
      id: 'hold1',
      name: 'Table 1',
      customerId: 'cu1',
      cartData: { items: [{ variantId: 'v1', qty: 2 }] },
    });
    const held = db.listHeldBills(conn);
    assert(held.some((h) => h.id === 'hold1'), 'held listed');
    db.deleteHeldBill(conn, 'hold1');
    assert(!db.listHeldBills(conn).some((h) => h.id === 'hold1'), 'held deleted');
    ok('Held bills');
  } catch (e) {
    fail('Held bills', e);
  }

  // --- Expenses ---
  try {
    db.saveExpense(conn, {
      id: 'ex1',
      amount: 50,
      category: 'Tea',
      notes: 'staff tea',
      expense_date: new Date().toISOString().slice(0, 10),
    });
    const expenses = db.listExpenses(conn, { limit: 20 });
    assert(expenses.some((e) => e.id === 'ex1'), 'expense listed');
    ok('Expenses', `count=${expenses.length}`);
  } catch (e) {
    fail('Expenses', e);
  }

  // --- Returns ---
  try {
    db.saveReturn(conn, {
      id: 'ret1',
      bill_id: 'server-1',
      total_amount: 20,
      items: [{ product_name: 'Product One Updated', quantity: 1 }],
    });
    const returns = db.listReturns(conn, { limit: 20 });
    assert(returns.some((r) => r.id === 'ret1'), 'return listed');
    ok('Returns', `count=${returns.length}`);
  } catch (e) {
    fail('Returns', e);
  }

  // --- Purchases ---
  try {
    db.savePurchase(conn, {
      id: 'pur1',
      supplier_id: 's1',
      supplier_name: 'Supplier A Updated',
      total_amount: 500,
      items: [{ product_name: 'Product One Updated', quantity: 5, cost: 60 }],
    });
    const purchases = db.listPurchases(conn, { limit: 20 });
    assert(purchases.some((p) => p.id === 'pur1'), 'purchase listed');
    assert(db.getPurchase(conn, 'pur1')?.id === 'pur1', 'getPurchase');
    ok('Purchase bills', `count=${purchases.length}`);
  } catch (e) {
    fail('Purchase bills', e);
  }

  // --- Stock movements ---
  try {
    db.saveStockMovement(conn, {
      id: 'sm1',
      variant_id: 'v1',
      type: 'in',
      quantity: 2,
      notes: 'opening',
    });
    db.adjustVariantStock(conn, 'v1', 2);
    const moves = db.listStockMovements(conn, { limit: 20 });
    assert(moves.some((m) => m.id === 'sm1'), 'stock movement listed');
    ok('Stock movements', `count=${moves.length}`);
  } catch (e) {
    fail('Stock movements', e);
  }

  // --- Customer ledger ---
  try {
    db.addCustomerLedger(conn, {
      id: 'led1',
      customer_id: 'cu1',
      type: 'credit',
      amount: 100,
      notes: 'advance',
    });
    const ledger = db.listCustomerLedger(conn, 'cu1');
    assert(ledger.length >= 1, 'ledger entry');
    ok('Customer ledger', `entries=${ledger.length}`);
  } catch (e) {
    fail('Customer ledger', e);
  }

  // --- Daily closing ---
  try {
    const preview = db.previewDailyClosingLocal(conn, new Date().toISOString().slice(0, 10));
    assert(preview && typeof preview.totalSales === 'number', 'preview has totalSales');
    db.saveDailyClosing(conn, {
      id: 'dc1',
      closing_date: new Date().toISOString().slice(0, 10),
      opening_cash: 0,
      closing_cash: 110,
      total_sales: preview.totalSales,
    });
    const closings = db.listDailyClosings(conn);
    assert(closings.some((c) => c.id === 'dc1'), 'closing saved');
    ok('Daily closing', `sales=${preview.totalSales}`);
  } catch (e) {
    fail('Daily closing', e);
  }

  // --- Dashboard + reports ---
  try {
    const dash = db.buildDashboard(conn);
    assert(dash, 'dashboard');
    const salesR = db.buildSalesReport(conn, {});
    assert(salesR, 'sales report');
    const profit = db.buildProfitReport(conn, {});
    assert(profit, 'profit report');
    const gst = db.buildGstReport(conn, {});
    assert(gst, 'gst report');
    const cash = db.buildCashFlowReport(conn, {});
    assert(cash, 'cashflow report');
    ok('Dashboard + reports', `dash keys=${Object.keys(dash || {}).length}`);
  } catch (e) {
    fail('Dashboard + reports', e);
  }

  // --- Sync queue + meta ---
  try {
    const q = db.enqueueSync(conn, {
      entityType: 'customer',
      entityId: 'cu4',
      op: 'create',
      payload: { name: 'Local New', phone: '9000000004' },
    });
    const pendingQ = db.listPendingSyncQueue(conn);
    assert(pendingQ.length >= 1, 'sync queue has item');
    const id = pendingQ[0].id;
    db.markSyncQueueDone(conn, id);
    db.setMeta(conn, 'last_sync_at', new Date().toISOString());
    assert(db.getMeta(conn, 'last_sync_at'), 'last_sync_at set');
    ok('Sync queue + last_sync meta', `queued then done; enqueue=${JSON.stringify(q)}`);
  } catch (e) {
    fail('Sync queue + last_sync meta', e);
  }

  // --- JSON table upsert (no wipe) ---
  try {
    db.replaceJsonTable(conn, 'expense_categories', [
      { id: 'ec1', name: 'Tea' },
      { id: 'ec2', name: 'Rent' },
    ]);
    db.replaceJsonTable(conn, 'expense_categories', [{ id: 'ec1', name: 'Tea/Coffee' }, { id: 'ec3', name: 'Misc' }]);
    const rows = db.listJsonTable(conn, 'expense_categories');
    assert(rows.length >= 3, `expense_categories expected >=3 got ${rows.length}`);

    db.replaceJsonTable(conn, 'tax_groups', [
      { id: 'tg-0', name: 'GST 0%', total_rate: 0 },
      { id: 'tg-18', name: 'GST 18%', total_rate: 18 },
    ]);
    const taxRows = db.listJsonTable(conn, 'tax_groups');
    assert(taxRows.length >= 2, `tax_groups expected >=2 got ${taxRows.length}`);
    ok('JSON masters upsert (expense_categories + tax_groups)', `count=${rows.length}, taxes=${taxRows.length}`);
  } catch (e) {
    fail('JSON masters upsert (expense_categories)', e);
  }

  // --- Local Deletes & Favorites ---
  try {
    // Product favorite toggle
    const favResult = db.setProductFavoriteLocal(conn, 'p1', true);
    assert(favResult.isFavorite === true, 'p1 set favorite');
    const p1AfterFav = db.getProduct(conn, 'p1');
    assert(p1AfterFav?.is_favorite === true || p1AfterFav?.isFavorite === true, 'p1 is favorite in db');

    // Bulk favorite by category
    const bulkFavResult = db.setProductsFavoriteBulkLocal(conn, 'c1', false);
    assert(bulkFavResult.isFavorite === false, 'bulk favorite reset');
    const p1AfterBulk = db.getProduct(conn, 'p1');
    assert(!p1AfterBulk?.is_favorite && !p1AfterBulk?.isFavorite, 'p1 is no longer favorite');

    // Delete category
    const delCat = db.deleteCategoryLocal(conn, 'c2');
    assert(delCat.deleted, 'category c2 deleted');
    const catList = db.listCategories(conn);
    assert(!catList.some((c) => c.id === 'c2'), 'c2 gone from list');

    // Delete brand
    const delBrand = db.deleteBrandLocal(conn, 'b2');
    assert(delBrand.deleted, 'brand b2 deleted');
    const brandList = db.listBrands(conn);
    assert(!brandList.some((b) => b.id === 'b2'), 'b2 gone from list');

    // Delete customer
    const delCust = db.deleteCustomerLocal(conn, 'cu1');
    assert(delCust.deleted, 'customer cu1 deleted');
    const custList = db.listCustomers(conn);
    assert(!custList.some((c) => c.id === 'cu1'), 'cu1 gone from list');

    // Delete supplier
    const delSup = db.deleteSupplierLocal(conn, 's1');
    assert(delSup.deleted, 'supplier s1 deleted');
    const supList = db.listSuppliers(conn);
    assert(!supList.some((s) => s.id === 's1'), 's1 gone from list');

    ok('Local Deletes & Favorites', 'category, brand, customer, supplier, product favorite tested');
  } catch (e) {
    fail('Local Deletes & Favorites', e);
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
console.log('\n---');
console.log(`Result: ${passed} passed, ${failed} failed, ${results.length} total`);
process.exit(failed ? 1 : 0);
