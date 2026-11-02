import * as XLSX from 'xlsx';
import type { ReportType } from './reportConfig';
import { getReportConfig } from './reportConfig';
import { isShareCancelled, saveExportFile } from './saveExportFile';

export type ExportSheet = {
  name: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  summary?: Array<{ label: string; value: string | number }>;
};

function num(value: string | number | undefined | null) {
  return parseFloat(String(value ?? 0)) || 0;
}

export function buildReportExportSheets(
  reportType: ReportType,
  data: unknown,
  periodLabel?: string,
): ExportSheet[] {
  const config = getReportConfig(reportType);
  const title = config?.title || 'Report';

  switch (reportType) {
    case 'daily_sales': {
      const report = data as {
        bills: Array<{ bill_number: string; total_amount: number; created_at: string; customer?: { name?: string } }>;
        topProducts?: Array<{ product_name: string; sku?: string; total_qty: number; revenue: number }>;
        mostSold?: { product_name: string; total_qty: number; revenue: number } | null;
        summary: { count: number; total: number; tax?: number; discount?: number };
      };
      const sheets: ExportSheet[] = [{
        name: title,
        summary: [
          { label: 'Report', value: title },
          { label: 'Period', value: periodLabel || '' },
          { label: 'Bills', value: report.summary.count },
          { label: 'Revenue', value: num(report.summary.total) },
          { label: 'Tax', value: num(report.summary.tax) },
          { label: 'Discount', value: num(report.summary.discount) },
          { label: 'Most sold', value: report.mostSold?.product_name || '—' },
        ],
        headers: ['Bill No', 'Customer', 'Date', 'Time', 'Amount'],
        rows: report.bills.map((bill) => [
          bill.bill_number,
          bill.customer?.name || '',
          new Date(bill.created_at).toLocaleDateString(),
          new Date(bill.created_at).toLocaleTimeString(),
          num(bill.total_amount),
        ]),
      }];
      if (report.topProducts?.length) {
        sheets.push({
          name: 'Top Products',
          headers: ['Rank', 'Product', 'SKU', 'Qty', 'Revenue'],
          rows: report.topProducts.map((item, index) => [
            index + 1,
            item.product_name,
            item.sku || '',
            num(item.total_qty),
            num(item.revenue),
          ]),
        });
      }
      return sheets;
    }
    case 'product_sales': {
      const report = data as {
        items?: Array<{ product_name: string; sku?: string; total_qty: number; revenue: number; profit?: number }>;
        mostSold?: { product_name: string; total_qty: number; revenue: number } | null;
        summary?: { products: number; totalQty: number; revenue: number };
      };
      const items = Array.isArray(data)
        ? (data as Array<{ product_name: string; sku?: string; total_qty: number; revenue: number; profit?: number }>)
        : (report.items || []);
      return [{
        name: title,
        summary: [
          { label: 'Period', value: periodLabel || '' },
          { label: 'Most sold', value: report.mostSold?.product_name || items[0]?.product_name || '—' },
          { label: 'Products', value: report.summary?.products ?? items.length },
          { label: 'Qty sold', value: report.summary?.totalQty ?? items.reduce((s, i) => s + num(i.total_qty), 0) },
          { label: 'Revenue', value: report.summary?.revenue ?? items.reduce((s, i) => s + num(i.revenue), 0) },
        ],
        headers: ['Rank', 'Product', 'SKU', 'Quantity', 'Revenue', 'Profit'],
        rows: items.map((item, index) => [
          index + 1,
          item.product_name,
          item.sku || '',
          num(item.total_qty),
          num(item.revenue),
          num(item.profit),
        ]),
      }];
    }
    case 'category_sales': {
      const items = data as Array<{ category_name: string; total_qty: number; revenue: number; profit?: number }>;
      return [{
        name: title,
        summary: [{ label: 'Period', value: periodLabel || '' }],
        headers: ['Category', 'Quantity', 'Revenue', 'Profit'],
        rows: items.map((item) => [
          item.category_name,
          num(item.total_qty),
          num(item.revenue),
          num(item.profit),
        ]),
      }];
    }
    case 'brand_sales': {
      const items = data as Array<{ brand_name: string; total_qty: number; revenue: number; profit?: number }>;
      return [{
        name: title,
        summary: [{ label: 'Period', value: periodLabel || '' }],
        headers: ['Brand', 'Quantity', 'Revenue', 'Profit'],
        rows: items.map((item) => [
          item.brand_name,
          num(item.total_qty),
          num(item.revenue),
          num(item.profit),
        ]),
      }];
    }
    case 'profit': {
      const report = data as {
        summary: { revenue: number; cost: number; grossProfit: number; expenses: number; netProfit: number };
        items: Array<{ product_name: string; sku?: string; revenue: number; cost?: number; profit: number }>;
      };
      return [{
        name: title,
        summary: [
          { label: 'Period', value: periodLabel || '' },
          { label: 'Revenue', value: num(report.summary.revenue) },
          { label: 'Cost', value: num(report.summary.cost) },
          { label: 'Gross Profit', value: num(report.summary.grossProfit) },
          { label: 'Expenses', value: num(report.summary.expenses) },
          { label: 'Net Profit', value: num(report.summary.netProfit) },
        ],
        headers: ['Product', 'SKU', 'Revenue', 'Cost', 'Profit'],
        rows: report.items.map((item) => [
          item.product_name,
          item.sku || '',
          num(item.revenue),
          num(item.cost),
          num(item.profit),
        ]),
      }];
    }
    case 'purchase': {
      const report = data as {
        bills: Array<{ bill_number: string; bill_date: string; total_amount: number; supplier?: { name?: string } }>;
        summary: { count: number; total: number };
      };
      return [{
        name: title,
        summary: [
          { label: 'Period', value: periodLabel || '' },
          { label: 'Bills', value: report.summary.count },
          { label: 'Total', value: num(report.summary.total) },
        ],
        headers: ['Bill No', 'Supplier', 'Date', 'Amount'],
        rows: report.bills.map((bill) => [
          bill.bill_number,
          bill.supplier?.name || '',
          bill.bill_date,
          num(bill.total_amount),
        ]),
      }];
    }
    case 'stock': {
      const items = data as Array<{ quantity: number; variant?: { sku?: string; product?: { name?: string }; uom?: { code?: string } } }>;
      return [{
        name: title,
        headers: ['Product', 'SKU', 'Quantity', 'Unit'],
        rows: items.map((item) => [
          item.variant?.product?.name || 'Unknown',
          item.variant?.sku || '',
          num(item.quantity),
          item.variant?.uom?.code || '',
        ]),
      }];
    }
    case 'low_stock': {
      const report = data as {
        items: Array<{ quantity: number; reorder_level: number; variant?: { sku?: string; product?: { name?: string } } }>;
        summary: { count: number };
      };
      return [{
        name: title,
        summary: [{ label: 'Low stock items', value: report.summary.count }],
        headers: ['Product', 'SKU', 'Current Qty', 'Reorder Level'],
        rows: report.items.map((item) => [
          item.variant?.product?.name || 'Unknown',
          item.variant?.sku || '',
          num(item.quantity),
          num(item.reorder_level),
        ]),
      }];
    }
    case 'customer': {
      const items = data as Array<{ name: string; phone?: string; order_count: number; total_spent: number; last_purchase?: string }>;
      return [{
        name: title,
        summary: [{ label: 'Period', value: periodLabel || '' }],
        headers: ['Customer', 'Phone', 'Orders', 'Total Spent', 'Last Purchase'],
        rows: items.map((item) => [
          item.name,
          item.phone || '',
          item.order_count,
          num(item.total_spent),
          item.last_purchase ? new Date(item.last_purchase).toLocaleDateString() : '',
        ]),
      }];
    }
    case 'supplier': {
      const items = data as Array<{ name: string; phone?: string; bill_count: number; total_purchased: number; last_purchase?: string }>;
      return [{
        name: title,
        summary: [{ label: 'Period', value: periodLabel || '' }],
        headers: ['Supplier', 'Phone', 'Bills', 'Total Purchased', 'Last Purchase'],
        rows: items.map((item) => [
          item.name,
          item.phone || '',
          item.bill_count,
          num(item.total_purchased),
          item.last_purchase || '',
        ]),
      }];
    }
    case 'gst': {
      const items = data as Array<{ tax_name: string; tax_type_code?: string; totalTax: number }>;
      return [{
        name: title,
        summary: [{ label: 'Period', value: periodLabel || '' }],
        headers: ['Tax Name', 'Tax Code', 'Amount'],
        rows: items.map((item) => [
          item.tax_name,
          item.tax_type_code || '',
          num(item.totalTax),
        ]),
      }];
    }
    case 'expense': {
      const report = data as {
        expenses: Array<{ expense_date: string; amount: number; category?: { name?: string }; notes?: string }>;
        total: number;
      };
      return [{
        name: title,
        summary: [
          { label: 'Period', value: periodLabel || '' },
          { label: 'Total Expenses', value: num(report.total) },
        ],
        headers: ['Date', 'Category', 'Amount', 'Notes'],
        rows: report.expenses.map((item) => [
          item.expense_date,
          item.category?.name || '',
          num(item.amount),
          item.notes || '',
        ]),
      }];
    }
    case 'cash_flow': {
      const report = data as {
        summary: { cashIn: number; cashOut: number; netFlow: number; expenses: number; purchases: number };
        inflows: Array<{ payment_mode: string; total: number }>;
      };
      return [
        {
          name: 'Summary',
          headers: ['Metric', 'Amount'],
          rows: [
            ['Cash In', num(report.summary.cashIn)],
            ['Cash Out', num(report.summary.cashOut)],
            ['Expenses', num(report.summary.expenses)],
            ['Purchases', num(report.summary.purchases)],
            ['Net Flow', num(report.summary.netFlow)],
          ],
        },
        {
          name: 'Payment Modes',
          summary: [{ label: 'Period', value: periodLabel || '' }],
          headers: ['Payment Mode', 'Amount'],
          rows: report.inflows.map((item) => [item.payment_mode.toUpperCase(), num(item.total)]),
        },
      ];
    }
    default:
      return [];
  }
}

function sanitizeFilename(name: string) {
  return name.replace(/[^\w-]+/g, '_').replace(/_+/g, '_').slice(0, 60) || 'report';
}

function csvEscape(value: string | number) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function sheetsToCsv(sheets: ExportSheet[]) {
  const blocks = sheets.map((sheet) => {
    const lines: string[] = [];
    lines.push(csvEscape(sheet.name));
    if (sheet.summary?.length) {
      sheet.summary.forEach((item) => lines.push([csvEscape(item.label), csvEscape(item.value)].join(',')));
      lines.push('');
    }
    lines.push(sheet.headers.map(csvEscape).join(','));
    sheet.rows.forEach((row) => lines.push(row.map(csvEscape).join(',')));
    return lines.join('\n');
  });
  return `\uFEFF${blocks.join('\n\n')}`;
}

export async function exportReportToExcel(
  reportType: ReportType,
  data: unknown,
  periodLabel?: string,
) {
  const config = getReportConfig(reportType);
  const sheets = buildReportExportSheets(reportType, data, periodLabel);
  if (!sheets.length) {
    throw new Error('Nothing to export');
  }

  const workbook = XLSX.utils.book_new();
  sheets.forEach((sheet, index) => {
    const rows: Array<Array<string | number>> = [];
    if (sheet.summary?.length) {
      rows.push(['Summary']);
      sheet.summary.forEach((item) => rows.push([item.label, item.value]));
      rows.push([]);
    }
    rows.push(sheet.headers);
    sheet.rows.forEach((row) => rows.push(row));

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const safeName = (sheet.name || `Sheet${index + 1}`).replace(/[\\/?*[\]]/g, '').slice(0, 31) || `Sheet${index + 1}`;
    XLSX.utils.book_append_sheet(workbook, worksheet, safeName);
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const baseName = sanitizeFilename(`${config?.title || reportType}_${stamp}`);
  const title = `${config?.title || 'Report'} export`;
  const xlsxName = `${baseName}.xlsx`;
  const base64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });

  try {
    await saveExportFile({
      filename: xlsxName,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      title,
      base64,
    });
    return;
  } catch (xlsxErr) {
    if (isShareCancelled(xlsxErr)) return;

    // Fallback: CSV opens in Excel and is accepted by more share targets
    try {
      await saveExportFile({ filename: `${baseName}.csv`, mime: 'text/csv', title, text: sheetsToCsv(sheets) });
    } catch (csvErr) {
      if (isShareCancelled(csvErr)) return;
      const message = csvErr instanceof Error ? csvErr.message : 'Could not export report';
      throw new Error(message);
    }
  }
}
