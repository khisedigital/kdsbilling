'use strict';

function nowIso() {
  return new Date().toISOString();
}

function dayBoundStart(value) {
  const s = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00`);
    if (!isNaN(d.getTime())) return d.toISOString();
    return `${s}T00:00:00.000Z`;
  }
  return s;
}
function dayBoundEnd(value) {
  const s = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T23:59:59.999`);
    if (!isNaN(d.getTime())) return d.toISOString();
    return `${s}T23:59:59.999Z`;
  }
  return s;
}

/** Keep products.json variants[].stockQty aligned after column updates. */
function syncVariantStockIntoProductJson(db, variantId, stockQty) {
  const id = String(variantId || '').trim();
  if (!id) return;
  const row = db.prepare(`SELECT product_id FROM product_variants WHERE id = ?`).get(id);
  if (!row?.product_id) return;
  const prod = db.prepare(`SELECT json FROM products WHERE id = ?`).get(String(row.product_id));
  if (!prod?.json) return;
  try {
    const parsed = JSON.parse(prod.json);
    const qty = Number(stockQty) || 0;
    if (!Array.isArray(parsed.variants)) return;
    let touched = false;
    parsed.variants = parsed.variants.map((v) => {
      if (String(v?.id) !== id) return v;
      touched = true;
      return { ...v, stockQty: qty, stock_qty: qty };
    });
    if (!touched) return;
    const total = parsed.variants.reduce(
      (s, v) => s + (Number(v.stockQty ?? v.stock_qty) || 0),
      0,
    );
    parsed.stockQty = total;
    parsed.stock_qty = total;
    db.prepare(`UPDATE products SET json = ?, updated_at = ? WHERE id = ?`).run(
      JSON.stringify(parsed),
      nowIso(),
      String(row.product_id),
    );
  } catch {
    /* ignore corrupt json */
  }
}

function saveReturn(db, row) {
  const id = String(row.id || '').trim();
  if (!id) throw new Error('return.id required');
  db.prepare(
    `INSERT INTO returns (id, sales_order_id, return_number, total_amount, json, sync_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       sales_order_id = excluded.sales_order_id,
       return_number = excluded.return_number,
       total_amount = excluded.total_amount,
       json = excluded.json,
       sync_status = excluded.sync_status`,
  ).run(
    id,
    row.salesOrderId || row.sales_order_id || null,
    row.return_number || row.returnNumber || null,
    Number(row.total_amount ?? row.totalAmount) || 0,
    JSON.stringify(row),
    row.syncStatus || 'pending',
    row.created_at || row.createdAt || nowIso(),
  );
  // Restock only for new local returns — not when pulling already-synced server rows
  // (server stock is refreshed via product pull).
  const isPull = String(row.syncStatus || '') === 'synced' || row.skipStock === true;
  if (!isPull) {
    for (const item of row.items || row.returnItems || []) {
      const vid = item.variantId || item.variant_id;
      const qty = Number(item.quantity) || 0;
      if (!vid || qty <= 0) continue;
      const vidStr = String(vid);
      db.prepare(
        `UPDATE product_variants SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ?`,
      ).run(qty, nowIso(), vidStr);
      const after = db.prepare(`SELECT stock_qty FROM product_variants WHERE id = ?`).get(vidStr);
      if (after) syncVariantStockIntoProductJson(db, vidStr, after.stock_qty);
    }
  }
  // Mark related sale status if requested.
  const saleId = row.salesOrderId || row.sales_order_id;
  if (saleId && row.billStatus) {
    db.prepare(`UPDATE sales SET status = ? WHERE client_bill_id = ? OR server_bill_id = ?`).run(
      String(row.billStatus),
      String(saleId),
      String(saleId),
    );
  }
  return { id };
}

function listReturns(db, { limit = 100 } = {}) {
  return db
    .prepare(`SELECT json FROM returns ORDER BY created_at DESC LIMIT ?`)
    .all(Math.max(1, Math.min(2000, Number(limit) || 100)))
    .map((r) => {
      try {
        return JSON.parse(r.json);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function savePurchase(db, row) {
  const id = String(row.id || '').trim();
  if (!id) throw new Error('purchase.id required');
  const total =
    Number(row.total_amount ?? row.totalAmount) ||
    (row.items || []).reduce(
      (s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitCost ?? it.unit_cost) || 0),
      0,
    );
  db.prepare(
    `INSERT INTO purchases (id, supplier_id, bill_number, total_amount, json, sync_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       supplier_id = excluded.supplier_id,
       bill_number = excluded.bill_number,
       total_amount = excluded.total_amount,
       json = excluded.json,
       sync_status = excluded.sync_status`,
  ).run(
    id,
    row.supplierId || row.supplier_id || null,
    row.bill_number || row.billNumber || `PUR-${id.slice(0, 8)}`,
    total,
    JSON.stringify(row),
    row.syncStatus || 'pending',
    row.created_at || row.createdAt || nowIso(),
  );
  for (const item of row.items || []) {
    const vid = item.variantId || item.variant_id;
    const qty = Number(item.quantity) || 0;
    if (!vid || qty <= 0) continue;
    const vidStr = String(vid);
    db.prepare(
      `UPDATE product_variants SET stock_qty = stock_qty + ?, cost_price = CASE WHEN ? > 0 THEN ? ELSE cost_price END, updated_at = ? WHERE id = ?`,
    ).run(
      qty,
      Number(item.unitCost ?? item.unit_cost) || 0,
      Number(item.unitCost ?? item.unit_cost) || 0,
      nowIso(),
      vidStr,
    );
    const after = db.prepare(`SELECT stock_qty FROM product_variants WHERE id = ?`).get(vidStr);
    if (after) syncVariantStockIntoProductJson(db, vidStr, after.stock_qty);
  }
  return { id };
}

function listPurchases(db, { search = '', limit = 200 } = {}) {
  const lim = Math.max(1, Math.min(2000, Number(limit) || 200));
  let rows;
  if (search && String(search).trim()) {
    const like = `%${String(search).trim().replace(/[%_]/g, '')}%`;
    rows = db
      .prepare(
        `SELECT json FROM purchases
         WHERE bill_number LIKE ? COLLATE NOCASE OR IFNULL(supplier_id,'') LIKE ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(like, like, lim);
  } else {
    rows = db
      .prepare(`SELECT json FROM purchases ORDER BY created_at DESC LIMIT ?`)
      .all(lim);
  }
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.json);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function getPurchase(db, id) {
  const row = db.prepare(`SELECT json FROM purchases WHERE id = ?`).get(String(id));
  if (!row?.json) return null;
  try {
    return JSON.parse(row.json);
  } catch {
    return null;
  }
}

function replaceSuppliers(db, suppliers = []) {
  const ts = nowIso();
  db.exec('BEGIN');
  try {
    // Upsert only: update existing suppliers, insert new ones. Never wipe local rows.
    const stmt = db.prepare(
      `INSERT INTO suppliers (id, name, phone, json, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, 'synced')
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         phone = excluded.phone,
         json = excluded.json,
         updated_at = excluded.updated_at,
         sync_status = 'synced'`,
    );
    for (const s of suppliers) {
      if (!s?.id) continue;
      stmt.run(
        String(s.id),
        String(s.name || ''),
        s.phone != null ? String(s.phone) : null,
        JSON.stringify(s),
        ts,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
  return { suppliers: suppliers.length };
}

function listSuppliers(db, { search = '' } = {}) {
  const q = String(search || '').trim();
  let rows;
  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    rows = db
      .prepare(
        `SELECT json FROM suppliers
         WHERE name LIKE ? COLLATE NOCASE OR IFNULL(phone,'') LIKE ?
         ORDER BY name COLLATE NOCASE`,
      )
      .all(like, like);
  } else {
    rows = db.prepare(`SELECT json FROM suppliers ORDER BY name COLLATE NOCASE`).all();
  }
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.json);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function upsertSupplier(db, supplier) {
  if (!supplier?.id) throw new Error('supplier.id required');
  db.prepare(
    `INSERT INTO suppliers (id, name, phone, json, updated_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, phone = excluded.phone, json = excluded.json,
       updated_at = excluded.updated_at, sync_status = excluded.sync_status`,
  ).run(
    String(supplier.id),
    String(supplier.name || ''),
    supplier.phone != null ? String(supplier.phone) : null,
    JSON.stringify(supplier),
    nowIso(),
    supplier.syncStatus || 'pending',
  );
  return { id: String(supplier.id) };
}

function saveDailyClosing(db, row) {
  const id = String(row.id || '').trim();
  if (!id) throw new Error('closing.id required');
  db.prepare(
    `INSERT INTO daily_closings (id, closing_date, json, sync_status, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       closing_date = excluded.closing_date,
       json = excluded.json,
       sync_status = excluded.sync_status`,
  ).run(
    id,
    String(row.closing_date || row.closingDate || nowIso().slice(0, 10)),
    JSON.stringify(row),
    row.syncStatus || 'pending',
    row.created_at || nowIso(),
  );
  return { id };
}

function listDailyClosings(db) {
  return db
    .prepare(`SELECT json FROM daily_closings ORDER BY closing_date DESC, created_at DESC`)
    .all()
    .map((r) => {
      try {
        return JSON.parse(r.json);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function previewDailyClosingLocal(db, closingDate) {
  const day = String(closingDate || nowIso().slice(0, 10));
  const start = dayBoundStart(day);
  const end = dayBoundEnd(day);
  const sales = db
    .prepare(
      `SELECT IFNULL(SUM(total_amount),0) AS total FROM sales
       WHERE status = 'completed' AND (created_at LIKE ? OR (created_at >= ? AND created_at <= ?))`,
    )
    .get(`${day}%`, start, end);
  const payments = db
    .prepare(
      `SELECT mode, IFNULL(SUM(amount),0) AS amount
       FROM sale_payments sp
       JOIN sales s ON s.client_bill_id = sp.client_bill_id
       WHERE s.status = 'completed' AND (s.created_at LIKE ? OR (s.created_at >= ? AND s.created_at <= ?))
       GROUP BY mode`,
    )
    .all(`${day}%`, start, end);
  const byMode = { cash: 0, upi: 0, card: 0, other: 0 };
  for (const p of payments) {
    const m = String(p.mode || '').toLowerCase();
    if (m === 'cash') byMode.cash += Number(p.amount) || 0;
    else if (m === 'upi') byMode.upi += Number(p.amount) || 0;
    else if (m === 'card') byMode.card += Number(p.amount) || 0;
    else byMode.other += Number(p.amount) || 0;
  }
  const expenses = db
    .prepare(`SELECT IFNULL(SUM(amount),0) AS n FROM expenses WHERE expense_date = ?`)
    .get(day);
  const existing = db
    .prepare(`SELECT json FROM daily_closings WHERE closing_date = ? LIMIT 1`)
    .get(day);
  let existingClosing = null;
  if (existing?.json) {
    try {
      existingClosing = JSON.parse(existing.json);
    } catch {
      existingClosing = null;
    }
  }
  const cashSales = byMode.cash;
  const cashExpenses = Number(expenses?.n) || 0;
  return {
    closingDate: day,
    alreadyClosed: Boolean(existingClosing),
    existingClosing,
    suggestedOpeningCash: 0,
    previousClosingDate: null,
    totalSales: Number(sales?.total) || 0,
    payments: byMode,
    cashSales,
    cashRefunds: 0,
    cashExpenses,
    formula: 'opening + cash sales - cash expenses',
  };
}

function upsertProductLocal(db, product) {
  if (!product?.id) throw new Error('product.id required');
  const ts = nowIso();

  // Remember existing variant stock so updating product details doesn't wipe local stock if omitted
  const existingStockRows = db.prepare(`SELECT id, stock_qty FROM product_variants WHERE product_id = ?`).all(String(product.id));
  const existingStockMap = new Map(existingStockRows.map((r) => [String(r.id), Number(r.stock_qty) || 0]));

  const variants = (product.variants || []).map((v) => {
    if (!v || typeof v !== 'object') return v;
    const selling = Number(v.selling_price ?? v.sellingPrice) || 0;
    const cost = Number(v.cost_price ?? v.costPrice) || 0;
    const mrp = v.mrp != null && v.mrp !== '' ? Number(v.mrp) : null;
    const stockIn = v.stockQty ?? v.stock_qty;
    const stock = (stockIn !== undefined && stockIn !== null && stockIn !== '')
      ? (Number(stockIn) || 0)
      : (existingStockMap.get(String(v.id)) || 0);
    const barcode =
      v.barcode ||
      (Array.isArray(v.barcodes) && v.barcodes[0] && (typeof v.barcodes[0] === 'string' ? v.barcodes[0] : v.barcodes[0].code || v.barcodes[0].barcode)) ||
      null;
    return {
      ...v,
      selling_price: selling,
      sellingPrice: selling,
      cost_price: cost,
      costPrice: cost,
      mrp,
      stock_qty: stock,
      stockQty: stock,
      barcode,
    };
  });

  const totalStock = variants.reduce((s, v) => s + (Number(v?.stockQty ?? v?.stock_qty) || 0), 0);
  const normalizedProduct = {
    ...product,
    name: String(product.name || ''),
    name_mr: product.name_mr ?? product.nameMr ?? null,
    nameMr: product.nameMr ?? product.name_mr ?? null,
    category_id: product.category_id ?? product.categoryId ?? null,
    categoryId: product.categoryId ?? product.category_id ?? null,
    brand_id: product.brand_id ?? product.brandId ?? null,
    brandId: product.brandId ?? product.brandId ?? null,
    status: String(product.status || 'active'),
    is_favorite: product.is_favorite || product.isFavorite ? 1 : 0,
    isFavorite: Boolean(product.is_favorite || product.isFavorite),
    stockQty: totalStock,
    stock_qty: totalStock,
    variants,
  };

  db.prepare(
    `INSERT INTO products (id, name, name_mr, category_id, brand_id, is_favorite, status, json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, name_mr = excluded.name_mr, category_id = excluded.category_id,
       brand_id = excluded.brand_id, is_favorite = excluded.is_favorite, status = excluded.status,
       json = excluded.json, updated_at = excluded.updated_at`,
  ).run(
    String(normalizedProduct.id),
    normalizedProduct.name,
    normalizedProduct.name_mr,
    normalizedProduct.category_id,
    normalizedProduct.brand_id,
    normalizedProduct.is_favorite,
    normalizedProduct.status,
    JSON.stringify(normalizedProduct),
    ts,
  );
  db.prepare(`DELETE FROM product_variants WHERE product_id = ?`).run(String(product.id));
  const insertV = db.prepare(
    `INSERT INTO product_variants
      (id, product_id, sku, barcode, selling_price, cost_price, mrp, stock_qty, unit, json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const v of variants) {
    if (!v?.id) continue;
    insertV.run(
      String(v.id),
      String(product.id),
      String(v.sku || ''),
      v.barcode || null,
      v.selling_price,
      v.cost_price,
      v.mrp != null ? Number(v.mrp) : null,
      v.stock_qty,
      v.unit || null,
      JSON.stringify(v),
      ts,
    );
  }
  return { id: String(product.id) };
}

function deleteProductLocal(db, id) {
  db.prepare(`DELETE FROM product_variants WHERE product_id = ?`).run(String(id));
  db.prepare(`DELETE FROM products WHERE id = ?`).run(String(id));
  return { deleted: true };
}

function addCustomerLedger(db, entry) {
  const id = String(
    entry.id || `led-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  );
  const customerId = String(entry.customerId || entry.customer_id || '');
  if (!customerId) throw new Error('customerId required');
  const amount = Number(entry.amount) || 0;
  const cust = db.prepare(`SELECT json FROM customers WHERE id = ?`).get(customerId);
  let customer = { id: customerId, store_credit_balance: 0, loyalty_points: 0 };
  if (cust?.json) {
    try {
      customer = { ...customer, ...JSON.parse(cust.json) };
    } catch {
      /* ignore */
    }
  }
  let balance = Number(customer.store_credit_balance ?? customer.storeCreditBalance) || 0;
  const type = String(entry.entryType || entry.entry_type || 'sale');
  if (type === 'store_credit_add' || type === 'payment') balance += Math.abs(amount);
  else balance -= Math.abs(amount);
  balance = Math.round(balance * 100) / 100;
  customer.store_credit_balance = balance;
  customer.storeCreditBalance = balance;
  db.prepare(
    `INSERT INTO customer_ledger
      (id, customer_id, entry_type, amount, balance_after, reference_type, reference_id, notes, sync_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    customerId,
    type,
    amount,
    balance,
    entry.referenceType || entry.reference_type || null,
    entry.referenceId || entry.reference_id || null,
    entry.notes || null,
    entry.syncStatus || 'pending',
    nowIso(),
  );
  db.prepare(
    `INSERT INTO customers (id, name, phone, json, updated_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at, sync_status = excluded.sync_status`,
  ).run(
    customerId,
    String(customer.name || 'Customer'),
    customer.phone || null,
    JSON.stringify(customer),
    nowIso(),
    'pending',
  );
  return { id, balanceAfter: balance, customer };
}

function listCustomerLedger(db, customerId) {
  return db
    .prepare(
      `SELECT * FROM customer_ledger WHERE customer_id = ? ORDER BY created_at DESC LIMIT 200`,
    )
    .all(String(customerId))
    .map((r) => ({
      id: r.id,
      customerId: r.customer_id,
      entryType: r.entry_type,
      amount: r.amount,
      balanceAfter: r.balance_after,
      referenceType: r.reference_type,
      referenceId: r.reference_id,
      notes: r.notes,
      createdAt: r.created_at,
      syncStatus: r.sync_status,
    }));
}

function saveStockMovement(db, row) {
  const id = String(row.id || `stk-${Date.now()}`);
  const vid = String(row.variantId || row.variant_id || '');
  const delta = Number(row.qtyDelta ?? row.quantity_change ?? row.quantity) || 0;
  db.prepare(
    `INSERT INTO stock_movements (id, variant_id, qty_delta, reason, json, sync_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    vid || null,
    delta,
    row.reason || row.movement_type || null,
    JSON.stringify(row),
    row.syncStatus || 'pending',
    nowIso(),
  );
  let stockQty = null;
  if (vid && delta !== 0) {
    db.prepare(
      `UPDATE product_variants SET stock_qty = MAX(0, stock_qty + ?), updated_at = ? WHERE id = ?`,
    ).run(delta, nowIso(), vid);
    const after = db.prepare(`SELECT stock_qty FROM product_variants WHERE id = ?`).get(vid);
    stockQty = after ? Number(after.stock_qty) || 0 : null;
    if (stockQty != null) syncVariantStockIntoProductJson(db, vid, stockQty);
  }
  return { id, variantId: vid || null, stockQty };
}

function listStockMovements(db, { limit = 200 } = {}) {
  return db
    .prepare(`SELECT json FROM stock_movements ORDER BY created_at DESC LIMIT ?`)
    .all(Math.max(1, Math.min(2000, Number(limit) || 200)))
    .map((r) => {
      try {
        return JSON.parse(r.json);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function buildProfitReport(db, { from, to } = {}) {
  const where = [`s.status = 'completed'`];
  const params = [];
  if (from) {
    where.push('s.created_at >= ?');
    params.push(dayBoundStart(from));
  }
  if (to) {
    where.push('s.created_at <= ?');
    params.push(dayBoundEnd(to));
  }
  const rows = db
    .prepare(
      `SELECT si.product_name AS name,
              IFNULL(SUM(si.quantity),0) AS qty,
              IFNULL(SUM(si.line_total),0) AS revenue,
              IFNULL(SUM(si.quantity * IFNULL(v.cost_price,0)),0) AS cost
       FROM sale_items si
       JOIN sales s ON s.client_bill_id = si.client_bill_id
       LEFT JOIN product_variants v ON v.id = si.variant_id
       WHERE ${where.join(' AND ')}
       GROUP BY si.product_name
       ORDER BY revenue DESC`,
    )
    .all(...params);
  const items = rows.map((r) => ({
    name: r.name,
    product_name: r.name,
    qty: Number(r.qty) || 0,
    revenue: Number(r.revenue) || 0,
    cost: Number(r.cost) || 0,
    profit: (Number(r.revenue) || 0) - (Number(r.cost) || 0),
  }));
  const revenue = items.reduce((s, i) => s + i.revenue, 0);
  const cost = items.reduce((s, i) => s + i.cost, 0);
  const grossProfit = revenue - cost;

  const expWhere = [];
  const expParams = [];
  if (from) {
    expWhere.push('expense_date >= ?');
    expParams.push(String(from).slice(0, 10));
  }
  if (to) {
    expWhere.push('expense_date <= ?');
    expParams.push(String(to).slice(0, 10));
  }
  const expRow = db.prepare(
    `SELECT IFNULL(SUM(amount), 0) AS total FROM expenses
     ${expWhere.length ? `WHERE ${expWhere.join(' AND ')}` : ''}`
  ).get(...expParams);
  const expenses = Number(expRow?.total) || 0;
  const netProfit = grossProfit - expenses;

  return {
    revenue,
    cost,
    profit: netProfit,
    grossProfit,
    expenses,
    netProfit,
    summary: {
      revenue,
      cost,
      grossProfit,
      expenses,
      netProfit,
    },
    items,
  };
}

function buildGstReport(db, { from, to } = {}) {
  const where = [`status = 'completed'`];
  const params = [];
  if (from) {
    where.push('created_at >= ?');
    params.push(dayBoundStart(from));
  }
  if (to) {
    where.push('created_at <= ?');
    params.push(dayBoundEnd(to));
  }
  const row = db
    .prepare(
      `SELECT IFNULL(SUM(subtotal),0) AS taxable,
              IFNULL(SUM(tax_amount),0) AS tax,
              IFNULL(SUM(total_amount),0) AS total,
              COUNT(*) AS bills
       FROM sales WHERE ${where.join(' AND ')}`,
    )
    .get(...params);
  const tax = Number(row?.tax) || 0;
  const taxable = Number(row?.taxable) || 0;
  const total = Number(row?.total) || 0;
  return {
    taxable,
    tax,
    total,
    bills: Number(row?.bills) || 0,
    items: [
      { tax_name: 'GST Total Tax Collected', totalTax: tax },
      { tax_name: 'Taxable Turnover', totalTax: taxable },
      { tax_name: 'Gross Turnover', totalTax: total },
    ],
    note: 'Local GST summary from saved bill tax fields (detailed HSN needs server tax lines).',
  };
}

function buildCashFlowReport(db, { from, to } = {}) {
  const sales = buildProfitReport(db, { from, to });
  const expWhere = [];
  const expParams = [];
  if (from) {
    expWhere.push('expense_date >= ?');
    expParams.push(String(from).slice(0, 10));
  }
  if (to) {
    expWhere.push('expense_date <= ?');
    expParams.push(String(to).slice(0, 10));
  }
  const exp = db
    .prepare(
      `SELECT IFNULL(SUM(amount),0) AS n FROM expenses
       ${expWhere.length ? `WHERE ${expWhere.join(' AND ')}` : ''}`,
    )
    .get(...expParams);
  const expenses = Number(exp?.n) || 0;

  const purWhere = [];
  const purParams = [];
  if (from) {
    purWhere.push('created_at >= ?');
    purParams.push(dayBoundStart(from));
  }
  if (to) {
    purWhere.push('created_at <= ?');
    purParams.push(dayBoundEnd(to));
  }
  const purRow = db.prepare(
    `SELECT IFNULL(SUM(total_amount), 0) AS total FROM purchases
     ${purWhere.length ? `WHERE ${purWhere.join(' AND ')}` : ''}`
  ).get(...purParams);
  const purchases = Number(purRow?.total) || 0;

  const salesWhere = [`s.status = 'completed'`];
  const salesParams = [];
  if (from) {
    salesWhere.push('s.created_at >= ?');
    salesParams.push(dayBoundStart(from));
  }
  if (to) {
    salesWhere.push('s.created_at <= ?');
    salesParams.push(dayBoundEnd(to));
  }
  const paymentRows = db.prepare(
    `SELECT LOWER(TRIM(sp.mode)) AS payment_mode, IFNULL(SUM(sp.amount), 0) AS total
     FROM sale_payments sp
     JOIN sales s ON s.client_bill_id = sp.client_bill_id
     WHERE ${salesWhere.join(' AND ')}
     GROUP BY LOWER(TRIM(sp.mode))`
  ).all(...salesParams);

  const cashIn = paymentRows.length
    ? paymentRows.reduce((s, r) => s + (Number(r.total) || 0), 0)
    : sales.revenue;
  const cashOut = expenses + purchases;
  const netFlow = cashIn - cashOut;

  const inflows = paymentRows.length
    ? paymentRows.map((r) => ({ payment_mode: r.payment_mode || 'cash', total: Number(r.total) || 0 }))
    : [{ payment_mode: 'cash', total: cashIn }];

  return {
    inflow: cashIn,
    outflow: cashOut,
    net: netFlow,
    profit: sales.profit,
    expenses,
    purchases,
    inflows,
    summary: {
      cashIn,
      cashOut,
      netFlow,
      expenses,
      purchases,
    },
  };
}

module.exports = {
  saveReturn,
  listReturns,
  savePurchase,
  listPurchases,
  getPurchase,
  replaceSuppliers,
  listSuppliers,
  upsertSupplier,
  saveDailyClosing,
  listDailyClosings,
  previewDailyClosingLocal,
  upsertProductLocal,
  deleteProductLocal,
  addCustomerLedger,
  listCustomerLedger,
  saveStockMovement,
  listStockMovements,
  buildProfitReport,
  buildGstReport,
  buildCashFlowReport,
};
