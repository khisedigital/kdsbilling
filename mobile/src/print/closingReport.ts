import type { DailyClosingRecord } from '../services/businessService';
import { getPrinterSettings, IS_DESKTOP, resolvePaperSize } from '../store/printerStore';
import { printViaA4, printViaBluetooth, printViaNetwork, printViaSystem } from './PrintService';
import { receiptCharsForPaper } from './escpos';

function money(value: string | number | null | undefined) {
  const n = parseFloat(String(value ?? 0));
  return Number.isFinite(n) ? n : 0;
}

function rupee(value: string | number | null | undefined) {
  return `₹${money(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildClosingReportHtml(opts: {
  shopName: string;
  branchName?: string;
  closing: DailyClosingRecord;
}): string {
  const { shopName, branchName, closing } = opts;
  const details = closing.details || {};
  const payments = details.payments || { cash: 0, upi: 0, card: 0, other: 0 };
  const variance = money(closing.variance);
  const status =
    Math.abs(variance) < 0.01 ? 'Cash matched' : variance < 0 ? 'Cash shortage' : 'Cash excess';
  const statusColor =
    Math.abs(variance) < 0.01 ? '#15803d' : variance < 0 ? '#b91c1c' : '#b45309';

  const denomRows = Object.entries(details.denominations || {})
    .filter(([, qty]) => Number(qty) > 0)
    .map(([note, qty]) => {
      const q = Number(qty) || 0;
      const face = Number(note) || 0;
      return `<tr><td>₹${face}</td><td style="text-align:right">${q}</td><td style="text-align:right">${rupee(face * q)}</td></tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Close Register — ${escapeHtml(closing.closing_date)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; margin: 24px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    h2 { font-size: 15px; margin: 20px 0 8px; color: #334155; }
    .muted { color: #64748b; font-size: 13px; }
    .card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; margin-top: 12px; }
    .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
    .big { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; }
    .status { display: inline-block; padding: 6px 12px; border-radius: 999px; background: ${statusColor}18; color: ${statusColor}; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 6px 0; border-bottom: 1px solid #f1f5f9; }
    th { text-align: left; color: #64748b; font-size: 11px; text-transform: uppercase; }
    @media print { body { margin: 12mm; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(shopName)}</h1>
  <div class="muted">${escapeHtml(branchName || 'Branch')} · Close Register · ${escapeHtml(closing.closing_date)}</div>
  <div class="muted">Closed by ${escapeHtml(closing.creator?.name || 'Staff')}</div>

  <div class="card">
    <div class="status">${status}</div>
    <div class="row" style="margin-top:12px"><span>Expected in drawer</span><strong>${rupee(closing.expected_cash)}</strong></div>
    <div class="row"><span>Cash counted</span><strong>${rupee(closing.actual_cash)}</strong></div>
    <div class="row"><span>Difference</span><strong class="big" style="color:${statusColor}">${variance >= 0 ? '+' : ''}${rupee(variance)}</strong></div>
  </div>

  <h2>Today's sales</h2>
  <div class="card">
    <div class="row"><span>Total sales</span><strong>${rupee(closing.total_sales)}</strong></div>
    <div class="row"><span>Cash</span><strong>${rupee(payments.cash ?? details.cashSales)}</strong></div>
    <div class="row"><span>UPI</span><strong>${rupee(payments.upi)}</strong></div>
    <div class="row"><span>Card</span><strong>${rupee(payments.card)}</strong></div>
    <div class="row"><span>Other</span><strong>${rupee(payments.other)}</strong></div>
  </div>

  <h2>Cash calculation</h2>
  <div class="card">
    <div class="row"><span>Opening cash</span><strong>${rupee(closing.opening_cash)}</strong></div>
    <div class="row"><span>+ Cash sales</span><strong>${rupee(details.cashSales)}</strong></div>
    <div class="row"><span>+ Cash added</span><strong>${rupee(details.cashAdded)}</strong></div>
    <div class="row"><span>− Cash refunds</span><strong>${rupee(details.cashRefunds)}</strong></div>
    <div class="row"><span>− Cash expenses</span><strong>${rupee(details.cashExpenses ?? closing.total_expenses)}</strong></div>
    <div class="row"><span>Expected cash</span><strong>${rupee(closing.expected_cash)}</strong></div>
  </div>

  ${denomRows ? `<h2>Notes counted</h2><div class="card"><table><thead><tr><th>Note</th><th style="text-align:right">Qty</th><th style="text-align:right">Total</th></tr></thead><tbody>${denomRows}</tbody></table></div>` : ''}

  ${details.varianceReason ? `<h2>Why cash differed</h2><div class="card">${escapeHtml(details.varianceReason)}</div>` : ''}
  ${details.remarks || closing.notes ? `<h2>Remarks</h2><div class="card">${escapeHtml(details.remarks || closing.notes)}</div>` : ''}
</body>
</html>`;
}

function buildClosingReportThermal(opts: {
  shopName: string;
  branchName?: string;
  closing: DailyClosingRecord;
  width: number;
}): string {
  const { shopName, branchName, closing, width } = opts;
  const details = closing.details || {};
  const payments = details.payments || { cash: 0, upi: 0, card: 0, other: 0 };
  const variance = money(closing.variance);
  const status =
    Math.abs(variance) < 0.01 ? 'Cash matched' : variance < 0 ? 'Cash shortage' : 'Cash excess';
  const rule = '='.repeat(width);
  const dash = '-'.repeat(width);
  const line = (label: string, value: string) => {
    const left = label.slice(0, Math.max(8, width - value.length - 1));
    const gap = Math.max(1, width - left.length - value.length);
    return `${left}${' '.repeat(gap)}${value}`.slice(0, width);
  };

  const lines = [
    rule,
    `<CB>${shopName.slice(0, width)}</CB>`,
    rule,
    `Close Register`.slice(0, width),
    `${branchName || 'Branch'}`.slice(0, width),
    `${closing.closing_date}`.slice(0, width),
    `By ${closing.creator?.name || 'Staff'}`.slice(0, width),
    dash,
    status.slice(0, width),
    line('Expected', rupee(closing.expected_cash)),
    line('Counted', rupee(closing.actual_cash)),
    line('Diff', `${variance >= 0 ? '+' : ''}${rupee(variance)}`),
    dash,
    line('Total sales', rupee(closing.total_sales)),
    line('Cash sales', rupee(payments.cash ?? details.cashSales)),
    line('UPI', rupee(payments.upi)),
    line('Card', rupee(payments.card)),
    line('Other', rupee(payments.other)),
    dash,
    line('Opening', rupee(closing.opening_cash)),
    line('+ Cash sales', rupee(details.cashSales)),
    line('+ Cash added', rupee(details.cashAdded)),
    line('- Refunds', rupee(details.cashRefunds)),
    line('- Expenses', rupee(details.cashExpenses ?? closing.total_expenses)),
    line('Expected', rupee(closing.expected_cash)),
  ];

  if (details.varianceReason) {
    lines.push(dash, 'Why cash differed:', String(details.varianceReason).slice(0, width * 2));
  }
  const notes = details.remarks || closing.notes;
  if (notes) {
    lines.push(dash, 'Remarks:', String(notes).slice(0, width * 2));
  }
  lines.push(rule);
  return lines.join('\n');
}

export async function printClosingReport(opts: {
  shopName: string;
  branchName?: string;
  closing: DailyClosingRecord;
}) {
  const settings = await getPrinterSettings();
  const paper = resolvePaperSize(settings.paperSize);
  const preferA4 = paper === 'a4';

  if (preferA4 && IS_DESKTOP) {
    const html = buildClosingReportHtml(opts);
    await printViaA4(html, `Close-Register-${opts.closing.closing_date}`, {
      printerName: settings.type === 'system' ? settings.systemPrinterName : undefined,
    });
    return;
  }

  const roll: '58' | '80' = paper === '58' ? '58' : '80';
  const width = receiptCharsForPaper(roll);
  const text = buildClosingReportThermal({ ...opts, width });

  if (settings.type === 'bluetooth') {
    if (!settings.bluetoothAddress) {
      throw new Error('Select a Bluetooth printer in Printer Settings first.');
    }
    await printViaBluetooth(settings.bluetoothAddress, text, width, roll);
    return;
  }
  if (settings.type === 'network') {
    if (!settings.networkHost) {
      throw new Error('Configure network printer IP in Printer Settings.');
    }
    await printViaNetwork(settings.networkHost, settings.networkPort || 9100, text, width, roll);
    return;
  }
  if (settings.type === 'system' && IS_DESKTOP) {
    await printViaSystem(settings.systemPrinterName || '', text, width, roll);
    return;
  }

  throw new Error('Choose a Bluetooth or Wi-Fi printer for closing reports on this device.');
}
