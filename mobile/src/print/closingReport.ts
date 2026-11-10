import type { DailyClosingRecord } from '../services/businessService';
import { printViaA4 } from './PrintService';

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

export async function printClosingReport(opts: {
  shopName: string;
  branchName?: string;
  closing: DailyClosingRecord;
}) {
  const html = buildClosingReportHtml(opts);
  await printViaA4(html, `Close-Register-${opts.closing.closing_date}`);
}
