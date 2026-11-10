const { Op } = require('sequelize');
const { SOLD_BILL_STATUSES, SOLD_BILL_STATUS_SQL } = require('../constants/billStatuses');

function dateRangeClause(alias, { from, to }) {
  let clause = '';
  if (from) clause += ` AND ${alias}.created_at >= :from`;
  if (to) clause += ` AND ${alias}.created_at <= :to`;
  return clause;
}

function dateReplacements({ from, to }) {
  return {
    from: from ? new Date(from) : null,
    to: to ? new Date(to + 'T23:59:59') : null,
  };
}

/** Remaining qty after returns. */
const SQL_NET_QTY = `GREATEST(soi.quantity - COALESCE(soi.returned_quantity, 0), 0)`;

/** Sum of line totals on the parent bill (for allocating bill-level discount/round-off). */
const SQL_BILL_LINES_SUM = `(SELECT SUM(x.line_total) FROM sales_order_items x WHERE x.sales_order_id = so.id)`;

/** Pre-tax line value after line discount. */
const SQL_LINE_PRETAX = `GREATEST(soi.unit_price * soi.quantity - COALESCE(soi.discount_amount, 0), 0)`;

/** Pre-tax share of line_total (taxable). */
const SQL_LINE_PRETAX_SHARE = `GREATEST(soi.line_total - COALESCE(soi.tax_amount, 0), 0)`;

/**
 * Net pre-tax revenue after line + bill discounts (+ round-off), scaled for returns.
 * Bill discount/round-off are allocated by line_total share, then applied to the pre-tax portion.
 */
const SQL_NET_PRETAX = `(
  (
    ${SQL_LINE_PRETAX}
    - COALESCE(so.discount_amount, 0) * ${SQL_LINE_PRETAX_SHARE} / NULLIF(${SQL_BILL_LINES_SUM}, 0)
    + COALESCE(so.round_off_amount, 0) * ${SQL_LINE_PRETAX_SHARE} / NULLIF(${SQL_BILL_LINES_SUM}, 0)
  ) * ${SQL_NET_QTY} / NULLIF(soi.quantity, 0)
)`;

const SQL_COST = `(soi.cost_price * ${SQL_NET_QTY})`;

/** Gross profit after discounts and returns (ex-tax net sales − COGS). */
const SQL_PROFIT = `(${SQL_NET_PRETAX} - ${SQL_COST})`;

/** Net received revenue (incl tax) after bill discount/round-off and returns. */
const SQL_NET_REVENUE = `(
  (
    soi.line_total
    - COALESCE(so.discount_amount, 0) * soi.line_total / NULLIF(${SQL_BILL_LINES_SUM}, 0)
    + COALESCE(so.round_off_amount, 0) * soi.line_total / NULLIF(${SQL_BILL_LINES_SUM}, 0)
  ) * ${SQL_NET_QTY} / NULLIF(soi.quantity, 0)
)`;

const SOLD_STATUS_IN = SOLD_BILL_STATUS_SQL || `'completed', 'partially_returned', 'fully_returned'`;


async function sumNetRevenue(db, branchId, since) {
  const rows = await db.sequelize.query(`
    SELECT COALESCE(SUM(${SQL_NET_REVENUE}), 0) AS revenue
    FROM sales_order_items soi
    JOIN sales_orders so ON soi.sales_order_id = so.id
    WHERE so.branch_id = :branchId
      AND so.status IN (${SOLD_STATUS_IN})
      AND so.created_at >= :since
  `, {
    replacements: { branchId, since },
    type: db.sequelize.QueryTypes.SELECT,
  });
  return parseFloat(rows[0]?.revenue || 0);
}

async function sumGrossProfit(db, branchId, since) {
  const rows = await db.sequelize.query(`
    SELECT COALESCE(SUM(${SQL_PROFIT}), 0) AS profit
    FROM sales_order_items soi
    JOIN sales_orders so ON soi.sales_order_id = so.id
    WHERE so.branch_id = :branchId
      AND so.status IN (${SOLD_STATUS_IN})
      AND so.created_at >= :since
  `, {
    replacements: { branchId, since },
    type: db.sequelize.QueryTypes.SELECT,
  });
  return parseFloat(rows[0]?.profit || 0);
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

async function getDashboard(db, branchId) {
  const { SalesOrder, ProductVariant, StockBalance, Expense, HeldBill, Customer } = db;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 6);

  const todayKey = dayKey(today);

  const [
    todaySales,
    yesterdaySalesOnly,
    monthSales,
    todayGrossProfit,
    monthGrossProfit,
    ordersCount,
    yesterdayOrdersCount,
    monthOrdersCount,
    recent,
    balances,
    bestSellers,
    todayExpenses,
    monthExpenses,
    heldCount,
    customersCount,
    paymentBreakdown,
    hourlySales,
    weekTrend,
    returnsToday,
  ] = await Promise.all([
    sumNetRevenue(db, branchId, today),
    db.sequelize.query(`
      SELECT COALESCE(SUM(${SQL_NET_REVENUE}), 0) AS revenue
      FROM sales_order_items soi
      JOIN sales_orders so ON soi.sales_order_id = so.id
      WHERE so.branch_id = :branchId
        AND so.status IN (${SOLD_STATUS_IN})
        AND so.created_at >= :yesterday
        AND so.created_at < :today
    `, {
      replacements: { branchId, yesterday, today },
      type: db.sequelize.QueryTypes.SELECT,
    }).then((rows) => parseFloat(rows[0]?.revenue || 0)),
    sumNetRevenue(db, branchId, monthStart),
    sumGrossProfit(db, branchId, today),
    sumGrossProfit(db, branchId, monthStart),
    SalesOrder.count({
      where: {
        branch_id: branchId,
        status: { [Op.in]: ['completed', 'partially_returned'] },
        created_at: { [Op.gte]: today },
      },
    }),
    SalesOrder.count({
      where: {
        branch_id: branchId,
        status: { [Op.in]: ['completed', 'partially_returned'] },
        created_at: { [Op.gte]: yesterday, [Op.lt]: today },
      },
    }),
    SalesOrder.count({
      where: {
        branch_id: branchId,
        status: { [Op.in]: ['completed', 'partially_returned'] },
        created_at: { [Op.gte]: monthStart },
      },
    }),
    SalesOrder.findAll({
      where: { branch_id: branchId, status: { [Op.in]: SOLD_BILL_STATUSES } },
      order: [['created_at', 'DESC']],
      limit: 8,
      attributes: ['id', 'bill_number', 'total_amount', 'created_at', 'status'],
      include: [{ model: db.Customer, as: 'customer', attributes: ['name'] }],
    }),
    StockBalance.findAll({
      where: { branch_id: branchId },
      include: [{
        model: ProductVariant,
        as: 'variant',
        attributes: ['reorder_level', 'sku'],
        include: [{ model: db.Product, as: 'product', attributes: ['name'] }],
      }],
    }),
    db.sequelize.query(`
      SELECT soi.product_name,
        SUM(${SQL_NET_QTY}) as totalQty,
        SUM(${SQL_NET_REVENUE}) as revenue
      FROM sales_order_items soi
      JOIN sales_orders so ON soi.sales_order_id = so.id
      WHERE so.branch_id = :branchId AND so.status IN (${SOLD_STATUS_IN}) AND so.created_at >= :monthStart
      GROUP BY soi.product_name ORDER BY revenue DESC LIMIT 5
    `, { replacements: { branchId, monthStart }, type: db.sequelize.QueryTypes.SELECT }),
    Expense.sum('amount', {
      where: { branch_id: branchId, expense_date: todayKey },
    }).then((v) => parseFloat(v || 0)),
    Expense.sum('amount', {
      where: {
        branch_id: branchId,
        expense_date: { [Op.gte]: dayKey(monthStart), [Op.lte]: todayKey },
      },
    }).then((v) => parseFloat(v || 0)),
    HeldBill
      ? HeldBill.count({ where: { branch_id: branchId } }).catch(() => 0)
      : Promise.resolve(0),
    Customer
      ? Customer.count().catch(() => 0)
      : Promise.resolve(0),
    db.sequelize.query(`
      SELECT sp.payment_mode AS mode, COALESCE(SUM(sp.amount), 0) AS amount, COUNT(*) AS count
      FROM sales_payments sp
      JOIN sales_orders so ON sp.sales_order_id = so.id
      WHERE so.branch_id = :branchId
        AND so.status IN (${SOLD_STATUS_IN})
        AND so.created_at >= :today
      GROUP BY sp.payment_mode
      ORDER BY amount DESC
    `, { replacements: { branchId, today }, type: db.sequelize.QueryTypes.SELECT }),
    db.sequelize.query(`
      SELECT HOUR(so.created_at) AS hour,
        COALESCE(SUM(${SQL_NET_REVENUE}), 0) AS revenue,
        COUNT(DISTINCT so.id) AS orders
      FROM sales_orders so
      JOIN sales_order_items soi ON soi.sales_order_id = so.id
      WHERE so.branch_id = :branchId
        AND so.status IN (${SOLD_STATUS_IN})
        AND so.created_at >= :today
      GROUP BY HOUR(so.created_at)
      ORDER BY hour ASC
    `, { replacements: { branchId, today }, type: db.sequelize.QueryTypes.SELECT }),
    db.sequelize.query(`
      SELECT DATE(so.created_at) AS day,
        COALESCE(SUM(${SQL_NET_REVENUE}), 0) AS revenue,
        COUNT(DISTINCT so.id) AS orders
      FROM sales_orders so
      JOIN sales_order_items soi ON soi.sales_order_id = so.id
      WHERE so.branch_id = :branchId
        AND so.status IN (${SOLD_STATUS_IN})
        AND so.created_at >= :weekStart
      GROUP BY DATE(so.created_at)
      ORDER BY day ASC
    `, { replacements: { branchId, weekStart }, type: db.sequelize.QueryTypes.SELECT }),
    SalesOrder.count({
      where: {
        branch_id: branchId,
        status: { [Op.in]: ['partially_returned', 'fully_returned'] },
        updated_at: { [Op.gte]: today },
      },
    }).catch(() => 0),
  ]);

  const lowStock = balances.filter((b) => {
    const reorder = parseFloat(b.variant?.reorder_level || 0);
    return reorder > 0 && parseFloat(b.quantity) <= reorder;
  }).slice(0, 10);

  const outOfStock = balances.filter((b) => parseFloat(b.quantity) <= 0).length;

  const hourMap = new Map(hourlySales.map((row) => [Number(row.hour), {
    hour: Number(row.hour),
    revenue: parseFloat(row.revenue || 0),
    orders: Number(row.orders || 0),
  }]));
  const hours = [];
  for (let h = 8; h <= 22; h += 1) {
    hours.push(hourMap.get(h) || { hour: h, revenue: 0, orders: 0 });
  }

  const weekMap = new Map(weekTrend.map((row) => [String(row.day).slice(0, 10), {
    day: String(row.day).slice(0, 10),
    revenue: parseFloat(row.revenue || 0),
    orders: Number(row.orders || 0),
  }]));
  const week = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const key = dayKey(d);
    week.push(weekMap.get(key) || { day: key, revenue: 0, orders: 0 });
  }

  const salesDeltaPct = yesterdaySalesOnly > 0
    ? ((todaySales - yesterdaySalesOnly) / yesterdaySalesOnly) * 100
    : (todaySales > 0 ? 100 : 0);

  const avgTicket = ordersCount > 0 ? todaySales / ordersCount : 0;

  return {
    todaySales,
    yesterdaySales: yesterdaySalesOnly,
    salesDeltaPct: Math.round(salesDeltaPct * 10) / 10,
    monthSales,
    ordersCount,
    yesterdayOrdersCount,
    monthOrdersCount,
    avgTicket,
    todayProfit: todayGrossProfit - todayExpenses,
    monthProfit: monthGrossProfit - monthExpenses,
    todayExpenses,
    monthExpenses,
    heldCount: Number(heldCount || 0),
    customersCount: Number(customersCount || 0),
    returnsToday: Number(returnsToday || 0),
    outOfStockCount: outOfStock,
    lowStockCount: lowStock.length,
    lowStock: lowStock.map((b) => ({
      id: b.variant_id || b.variant?.id,
      sku: b.variant?.sku || null,
      name: b.variant?.product?.name || 'Item',
      quantity: parseFloat(b.quantity || 0),
      reorderLevel: parseFloat(b.variant?.reorder_level || 0),
    })),
    bestSellers: bestSellers.map((row) => ({
      product_name: row.product_name,
      totalQty: parseFloat(row.totalQty || 0),
      revenue: parseFloat(row.revenue || 0),
    })),
    paymentBreakdown: paymentBreakdown.map((row) => ({
      mode: row.mode,
      amount: parseFloat(row.amount || 0),
      count: Number(row.count || 0),
    })),
    hourlySales: hours,
    weekTrend: week,
    recentTransactions: recent.map((tx) => {
      const r = tx.toJSON ? tx.toJSON() : tx;
      return {
        id: r.id,
        bill_number: r.bill_number,
        total_amount: Number(r.total_amount || 0),
        created_at: r.created_at,
        status: r.status,
        customerName: r.customer?.name || null,
      };
    }),
  };
}

async function salesReport(db, branchId, { from, to }) {
  const { SalesOrder, sequelize } = db;
  const where = { branch_id: branchId, status: { [Op.in]: SOLD_BILL_STATUSES } };
  if (from || to) {
    where.created_at = {};
    if (from) where.created_at[Op.gte] = new Date(from);
    if (to) where.created_at[Op.lte] = new Date(to + 'T23:59:59');
  }

  const bills = await SalesOrder.findAll({
    where,
    attributes: ['id', 'bill_number', 'total_amount', 'tax_amount', 'discount_amount', 'created_at'],
    include: [
      { model: db.Customer, as: 'customer', attributes: ['name'] },
      { model: db.SalesPayment, as: 'payments' },
    ],
    order: [['created_at', 'DESC']],
  });

  const replacements = {
    branchId,
    from: from ? new Date(from) : null,
    to: to ? new Date(to + 'T23:59:59') : null,
  };

  const [topProducts] = await sequelize.query(`
    SELECT soi.product_name, soi.sku,
      SUM(${SQL_NET_QTY}) as total_qty,
      SUM(${SQL_NET_REVENUE}) as revenue,
      SUM(${SQL_PROFIT}) as profit
    FROM sales_order_items soi
    JOIN sales_orders so ON soi.sales_order_id = so.id
    WHERE so.branch_id = :branchId AND so.status IN (${SOLD_STATUS_IN})
      ${from ? 'AND so.created_at >= :from' : ''}
      ${to ? 'AND so.created_at <= :to' : ''}
    GROUP BY soi.product_name, soi.sku
    ORDER BY SUM(${SQL_NET_QTY}) DESC, SUM(${SQL_NET_REVENUE}) DESC
    LIMIT 10
  `, { replacements });

  const [netRows] = await sequelize.query(`
    SELECT
      COALESCE(SUM(${SQL_NET_REVENUE}), 0) AS total,
      COALESCE(SUM(
        (
          COALESCE(soi.tax_amount, 0)
          * ${SQL_NET_QTY} / NULLIF(soi.quantity, 0)
        )
      ), 0) AS tax
    FROM sales_order_items soi
    JOIN sales_orders so ON soi.sales_order_id = so.id
    WHERE so.branch_id = :branchId AND so.status IN (${SOLD_STATUS_IN})
      ${from ? 'AND so.created_at >= :from' : ''}
      ${to ? 'AND so.created_at <= :to' : ''}
  `, { replacements });

  const total = parseFloat(netRows[0]?.total || 0);
  const tax = parseFloat(netRows[0]?.tax || 0);
  const discount = bills.reduce((s, b) => s + parseFloat(b.discount_amount || 0), 0);
  const mostSold = topProducts[0]
    ? {
        product_name: topProducts[0].product_name,
        sku: topProducts[0].sku,
        total_qty: parseFloat(topProducts[0].total_qty || 0),
        revenue: parseFloat(topProducts[0].revenue || 0),
        profit: parseFloat(topProducts[0].profit || 0),
      }
    : null;

  return {
    bills,
    topProducts: topProducts.map((row) => ({
      product_name: row.product_name,
      sku: row.sku,
      total_qty: parseFloat(row.total_qty || 0),
      revenue: parseFloat(row.revenue || 0),
      profit: parseFloat(row.profit || 0),
    })),
    mostSold,
    summary: {
      count: bills.length,
      total,
      tax,
      discount,
    },
  };
}

async function productSalesReport(db, branchId, { from, to }) {
  const { sequelize } = db;
  const [results] = await sequelize.query(`
    SELECT soi.product_name, soi.sku,
      SUM(${SQL_NET_QTY}) as total_qty,
      SUM(${SQL_NET_REVENUE}) as revenue,
      SUM(${SQL_PROFIT}) as profit
    FROM sales_order_items soi
    JOIN sales_orders so ON soi.sales_order_id = so.id
    WHERE so.branch_id = :branchId AND so.status IN (${SOLD_STATUS_IN})
      ${from ? 'AND so.created_at >= :from' : ''}
      ${to ? 'AND so.created_at <= :to' : ''}
    GROUP BY soi.product_name, soi.sku
    ORDER BY SUM(${SQL_NET_QTY}) DESC, SUM(${SQL_NET_REVENUE}) DESC
    LIMIT 50
  `, {
    replacements: { branchId, from: from ? new Date(from) : null, to: to ? new Date(to + 'T23:59:59') : null },
  });

  const items = results.map((row) => ({
    product_name: row.product_name,
    sku: row.sku,
    total_qty: parseFloat(row.total_qty || 0),
    revenue: parseFloat(row.revenue || 0),
    profit: parseFloat(row.profit || 0),
  }));

  return {
    items,
    mostSold: items[0] || null,
    summary: {
      products: items.length,
      totalQty: items.reduce((s, i) => s + i.total_qty, 0),
      revenue: items.reduce((s, i) => s + i.revenue, 0),
    },
  };
}

async function gstReport(db, branchId, { from, to }) {
  const { sequelize } = db;
  const [results] = await sequelize.query(`
    SELECT soit.tax_type_code, soit.tax_name, SUM(soit.tax_amount) as totalTax
    FROM sales_order_item_taxes soit
    JOIN sales_order_items soi ON soit.sales_order_item_id = soi.id
    JOIN sales_orders so ON soi.sales_order_id = so.id
    WHERE so.branch_id = :branchId AND so.status IN ('completed', 'partially_returned', 'fully_returned')
      ${from ? 'AND so.created_at >= :from' : ''}
      ${to ? 'AND so.created_at <= :to' : ''}
    GROUP BY soit.tax_type_code, soit.tax_name
  `, {
    replacements: {
      branchId,
      from: from ? new Date(from) : null,
      to: to ? new Date(to + 'T23:59:59') : null,
    },
  });
  return results;
}

async function stockReport(db, branchId) {
  const { StockBalance, ProductVariant, Product, UnitOfMeasure } = db;
  return StockBalance.findAll({
    where: { branch_id: branchId },
    include: [{
      model: ProductVariant,
      as: 'variant',
      attributes: ['id', 'sku', 'size', 'color', 'reorder_level', 'uom_id'],
      include: [
        { model: Product, as: 'product', attributes: ['id', 'name'] },
        { model: UnitOfMeasure, as: 'uom', attributes: ['id', 'code', 'name'] },
      ],
    }],
    order: [
      [{ model: ProductVariant, as: 'variant' }, { model: Product, as: 'product' }, 'name', 'ASC'],
    ],
  });
}

async function expenseReport(db, branchId, { from, to }) {
  const { Expense, ExpenseCategory } = db;
  const where = { branch_id: branchId };
  if (from || to) {
    where.expense_date = {};
    if (from) where.expense_date[Op.gte] = from;
    if (to) where.expense_date[Op.lte] = to;
  }
  const expenses = await Expense.findAll({
    where,
    include: [{ model: ExpenseCategory, as: 'category' }],
    order: [['expense_date', 'DESC']],
  });
  const total = expenses.reduce((s, e) => s + parseFloat(e.amount), 0);
  return { expenses, total };
}

async function monthlySalesReport(db, branchId, { from, to }) {
  const { sequelize } = db;
  const [results] = await sequelize.query(`
    SELECT DATE_FORMAT(so.created_at, '%Y-%m') as month,
      COUNT(DISTINCT so.id) as bill_count,
      COALESCE(SUM(${SQL_NET_REVENUE}), 0) as revenue,
      COALESCE(SUM(
        COALESCE(soi.tax_amount, 0) * ${SQL_NET_QTY} / NULLIF(soi.quantity, 0)
      ), 0) as tax_amount
    FROM sales_orders so
    JOIN sales_order_items soi ON soi.sales_order_id = so.id
    WHERE so.branch_id = :branchId AND so.status IN (${SOLD_STATUS_IN})
      ${dateRangeClause('so', { from, to })}
    GROUP BY DATE_FORMAT(so.created_at, '%Y-%m')
    ORDER BY month DESC
    LIMIT 24
  `, { replacements: { branchId, ...dateReplacements({ from, to }) } });

  const total = results.reduce((sum, row) => sum + parseFloat(row.revenue || 0), 0);
  const count = results.reduce((sum, row) => sum + parseInt(row.bill_count, 10), 0);
  return { items: results, summary: { count, total } };
}

async function categorySalesReport(db, branchId, { from, to }) {
  const { sequelize } = db;
  const [results] = await sequelize.query(`
    SELECT COALESCE(c.name, 'Uncategorised') as category_name,
      SUM(${SQL_NET_QTY}) as total_qty,
      SUM(${SQL_NET_REVENUE}) as revenue,
      SUM(${SQL_PROFIT}) as profit
    FROM sales_order_items soi
    JOIN sales_orders so ON soi.sales_order_id = so.id
    JOIN product_variants pv ON soi.variant_id = pv.id
    JOIN products p ON pv.product_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE so.branch_id = :branchId AND so.status IN (${SOLD_STATUS_IN})
      ${dateRangeClause('so', { from, to })}
    GROUP BY COALESCE(c.name, 'Uncategorised')
    ORDER BY revenue DESC
    LIMIT 50
  `, { replacements: { branchId, ...dateReplacements({ from, to }) } });
  return results;
}

async function brandSalesReport(db, branchId, { from, to }) {
  const { sequelize } = db;
  const [results] = await sequelize.query(`
    SELECT COALESCE(b.name, 'No brand') as brand_name,
      SUM(${SQL_NET_QTY}) as total_qty,
      SUM(${SQL_NET_REVENUE}) as revenue,
      SUM(${SQL_PROFIT}) as profit
    FROM sales_order_items soi
    JOIN sales_orders so ON soi.sales_order_id = so.id
    JOIN product_variants pv ON soi.variant_id = pv.id
    JOIN products p ON pv.product_id = p.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE so.branch_id = :branchId AND so.status IN (${SOLD_STATUS_IN})
      ${dateRangeClause('so', { from, to })}
    GROUP BY COALESCE(b.name, 'No brand')
    ORDER BY revenue DESC
    LIMIT 50
  `, { replacements: { branchId, ...dateReplacements({ from, to }) } });
  return results;
}

async function profitReport(db, branchId, { from, to }) {
  const { sequelize } = db;
  const [summaryRows] = await sequelize.query(`
    SELECT
      SUM(${SQL_NET_REVENUE}) as revenue,
      SUM(${SQL_COST}) as cost,
      SUM(${SQL_PROFIT}) as gross_profit,
      SUM(COALESCE(soi.tax_amount, 0) * ${SQL_NET_QTY} / NULLIF(soi.quantity, 0)) as tax_collected
    FROM sales_order_items soi
    JOIN sales_orders so ON soi.sales_order_id = so.id
    WHERE so.branch_id = :branchId AND so.status IN (${SOLD_STATUS_IN})
      ${dateRangeClause('so', { from, to })}
  `, { replacements: { branchId, ...dateReplacements({ from, to }) } });

  const [byProduct] = await sequelize.query(`
    SELECT soi.product_name, soi.sku,
      SUM(${SQL_NET_QTY}) as total_qty,
      SUM(${SQL_NET_REVENUE}) as revenue,
      SUM(${SQL_COST}) as cost,
      SUM(${SQL_PROFIT}) as profit
    FROM sales_order_items soi
    JOIN sales_orders so ON soi.sales_order_id = so.id
    WHERE so.branch_id = :branchId AND so.status IN (${SOLD_STATUS_IN})
      ${dateRangeClause('so', { from, to })}
    GROUP BY soi.product_name, soi.sku
    ORDER BY profit DESC
    LIMIT 30
  `, { replacements: { branchId, ...dateReplacements({ from, to }) } });

  const summary = summaryRows[0] || {};
  const expenses = await expenseReport(db, branchId, { from, to });
  const grossProfit = parseFloat(summary.gross_profit || 0);
  const netProfit = grossProfit - parseFloat(expenses.total || 0);

  return {
    summary: {
      revenue: parseFloat(summary.revenue || 0),
      cost: parseFloat(summary.cost || 0),
      grossProfit,
      taxCollected: parseFloat(summary.tax_collected || 0),
      expenses: parseFloat(expenses.total || 0),
      netProfit,
    },
    items: byProduct,
  };
}

async function purchaseReport(db, branchId, { from, to }) {
  const { PurchaseBill } = db;
  const where = { branch_id: branchId };
  if (from || to) {
    where.bill_date = {};
    if (from) where.bill_date[Op.gte] = from;
    if (to) where.bill_date[Op.lte] = to;
  }

  const bills = await PurchaseBill.findAll({
    where,
    include: [{ model: db.Supplier, as: 'supplier', attributes: ['id', 'name', 'phone'] }],
    order: [['bill_date', 'DESC'], ['created_at', 'DESC']],
    limit: 100,
  });

  const total = bills.reduce((sum, bill) => sum + parseFloat(bill.total_amount || 0), 0);
  return { bills, summary: { count: bills.length, total } };
}

async function lowStockReport(db, branchId) {
  const balances = await stockReport(db, branchId);
  const items = balances
    .map((balance) => {
      const qty = parseFloat(balance.quantity || 0);
      const reorder = parseFloat(balance.variant?.reorder_level || 0);
      return {
        id: balance.id,
        quantity: qty,
        reorder_level: reorder,
        variant: balance.variant,
      };
    })
    .filter((item) => {
      // Match inventory screen: zero/negative stock, or at/below reorder level
      if (item.quantity <= 0) return true;
      return item.reorder_level > 0 && item.quantity <= item.reorder_level;
    })
    .sort((a, b) => a.quantity - b.quantity);

  return { items, summary: { count: items.length } };
}

async function customerReport(db, branchId, { from, to }) {
  const { sequelize } = db;
  const [results] = await sequelize.query(`
    SELECT
      c.id,
      c.name,
      c.phone,
      COUNT(so.id) as order_count,
      SUM(so.total_amount) as total_spent,
      MAX(so.created_at) as last_purchase
    FROM customers c
    JOIN sales_orders so ON so.customer_id = c.id
    WHERE so.branch_id = :branchId
      AND so.status IN ('completed', 'partially_returned', 'fully_returned')
      AND c.deleted_at IS NULL
      ${dateRangeClause('so', { from, to })}
    GROUP BY c.id, c.name, c.phone
    ORDER BY total_spent DESC
    LIMIT 50
  `, { replacements: { branchId, ...dateReplacements({ from, to }) } });
  return results;
}

async function supplierReport(db, branchId, { from, to }) {
  const { sequelize } = db;
  const [results] = await sequelize.query(`
    SELECT
      s.id,
      s.name,
      s.phone,
      COUNT(pb.id) as bill_count,
      SUM(pb.total_amount) as total_purchased,
      MAX(pb.bill_date) as last_purchase
    FROM suppliers s
    JOIN purchase_bills pb ON pb.supplier_id = s.id
    WHERE pb.branch_id = :branchId
      AND s.deleted_at IS NULL
      ${from ? ' AND pb.bill_date >= :from' : ''}
      ${to ? ' AND pb.bill_date <= :to' : ''}
    GROUP BY s.id, s.name, s.phone
    ORDER BY total_purchased DESC
    LIMIT 50
  `, {
    replacements: {
      branchId,
      from: from || null,
      to: to || null,
    },
  });
  return results;
}

async function cashFlowReport(db, branchId, { from, to }) {
  const { sequelize } = db;
  const [inflows] = await sequelize.query(`
    SELECT sp.payment_mode, SUM(sp.amount) as total
    FROM sales_payments sp
    JOIN sales_orders so ON sp.sales_order_id = so.id
    WHERE so.branch_id = :branchId AND so.status IN ('completed', 'partially_returned', 'fully_returned')
      ${dateRangeClause('so', { from, to })}
    GROUP BY sp.payment_mode
    ORDER BY total DESC
  `, { replacements: { branchId, ...dateReplacements({ from, to }) } });

  const expenses = await expenseReport(db, branchId, { from, to });
  const purchases = await purchaseReport(db, branchId, { from, to });

  const cashIn = inflows.reduce((sum, row) => sum + parseFloat(row.total || 0), 0);
  const cashOut = parseFloat(expenses.total || 0) + parseFloat(purchases.summary.total || 0);
  const netFlow = cashIn - cashOut;

  return {
    inflows,
    expenses: expenses.expenses,
    purchases: purchases.bills,
    summary: {
      cashIn,
      expenses: parseFloat(expenses.total || 0),
      purchases: parseFloat(purchases.summary.total || 0),
      cashOut,
      netFlow,
    },
  };
}

module.exports = {
  getDashboard,
  salesReport,
  monthlySalesReport,
  productSalesReport,
  categorySalesReport,
  brandSalesReport,
  profitReport,
  purchaseReport,
  gstReport,
  stockReport,
  lowStockReport,
  customerReport,
  supplierReport,
  expenseReport,
  cashFlowReport,
};
