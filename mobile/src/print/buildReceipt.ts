import type { BillDetail } from '../services/businessService';
import { shopTextForBill, type ShopSettings } from '../services/shopSettingsService';
import { APP_DISPLAY_NAME } from '../constants/branding';
import { billT, paymentLabel } from '../i18n';
import { useLanguageStore } from '../i18n/languageStore';
import { totalSaving } from '../utils/billSaving';
import { billItemUom, formatBillQuantity, formatReceiptQuantity } from '../utils/quantity';
import type { ThermalPrintPayload } from './PrintService';
import { buildThermalHtml, receiptCharsForPaper } from './escpos';
import { clipCols, colLength, DEVANAGARI_FONTS, graphemes, hasDevanagari } from './indicText';

/** English bills keep their current words. Marathi bills use the bill-language dictionary. */
function L(english: string, englishPrint = english): string {
  return useLanguageStore.getState().bill === 'mr' ? billT(english) : englishPrint;
}

function payName(mode: string | null | undefined): string {
  if (useLanguageStore.getState().bill !== 'mr') {
    return ascii(mode).toUpperCase() || 'PAID';
  }
  return paymentLabel(mode, billT);
}

/** Uppercase Latin shop names; leave Marathi as typed (toUpperCase mangles display). */
function shopTitleDisplay(name: string): string {
  const body = String(name || '').trim();
  if (!body) return body;
  if (hasDevanagari(body)) return body;
  return body.toUpperCase();
}

function n(v: string | number | null | undefined): number {
  const x = parseFloat(String(v ?? 0));
  return Number.isFinite(x) ? x : 0;
}

function money(v: string | number | null | undefined): string {
  return n(v).toFixed(2);
}

function ascii(v: unknown): string {
  return String(v ?? '')
    .replace(/₹/g, 'Rs.')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[<>]/g, '')
    .replace(/[^\x20-\x7E\n\u0900-\u097F\u200C\u200D]/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
}

function pad(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const body = clipCols(text, width);
  const gap = width - colLength(body);
  if (gap <= 0) return body;
  return align === 'right' ? `${' '.repeat(gap)}${body}` : `${body}${' '.repeat(gap)}`;
}

function rule(width: number, char = '-'): string {
  return char.repeat(width);
}

function fmtDate(value: string | Date | null | undefined): string {
  const d = value instanceof Date ? value : new Date(String(value || ''));
  if (Number.isNaN(d.getTime())) return '-';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function wrapWords(text: string, width: number): string[] {
  const value = ascii(text);
  if (!value) return [];
  if (colLength(value) <= width) return [value];
  const out: string[] = [];
  let cur = '';
  for (const token of value.split(' ').filter(Boolean)) {
    if (colLength(token) > width) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      let rest = graphemes(token);
      while (rest.length > width) {
        out.push(rest.slice(0, width).join(''));
        rest = rest.slice(width);
      }
      cur = rest.join('');
      continue;
    }
    const next = cur ? `${cur} ${token}` : token;
    if (colLength(next) <= width) cur = next;
    else {
      out.push(cur);
      cur = token;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function kv(width: number, left: string, right: string): string {
  const l = ascii(left);
  const r = ascii(right);
  return `${l}${' '.repeat(Math.max(1, width - colLength(l) - colLength(r)))}${r}`;
}

type Cols = { item: number; qty: number; rate: number; amt: number };

/** A4 bills on Bluetooth / Wi-Fi printers are sent as text, 80 characters per line */
export const A4_CHARS_PER_LINE = 80;

/** Column widths always fill the paper (3 single spaces between columns). */
function colsFor(width: number): Cols {
  if (width <= 30) {
    // 58 mm with a left margin: 7+1+6+1+7+1+7 = 30. Qty fits "100g" / "1.5kg".
    return { item: 7, qty: 6, rate: 7, amt: 7 };
  }
  if (width <= 32) {
    // 9 + 1 + 6 + 1 + 7 + 1 + 7 = 32
    return { item: 9, qty: 6, rate: 7, amt: 7 };
  }
  if (width >= A4_CHARS_PER_LINE) {
    // 50 + 1 + 7 + 1 + 10 + 1 + 10 = 80
    return { item: 50, qty: 7, rate: 10, amt: 10 };
  }
  // 80mm Font A: 21 + 1 + 7 + 1 + 9 + 1 + 8 = 48
  return { item: 21, qty: 7, rate: 9, amt: 8 };
}

function tableHeader(width: number, cols: Cols): string {
  return (
    pad(L('Item', 'ITEM'), cols.item) +
    ' ' +
    pad(L('Qty', 'QTY'), cols.qty, 'right') +
    ' ' +
    pad(L('Rate', 'RATE'), cols.rate, 'right') +
    ' ' +
    pad(L('Amount', 'AMT'), cols.amt, 'right')
  );
}

function tableRows(
  width: number,
  cols: Cols,
  name: string,
  qty: string,
  rate: number,
  amt: number,
  taxLines: string[] = [],
): string[] {
  const qtyStr = qty || '0';
  const rateStr = money(rate);
  const amtStr = money(amt);
  const nameLines = wrapWords(name, cols.item);
  if (!nameLines.length) {
    return [
      (
        pad('-', cols.item) +
        ' ' +
        pad(qtyStr, cols.qty, 'right') +
        ' ' +
        pad(rateStr, cols.rate, 'right') +
        ' ' +
        pad(amtStr, cols.amt, 'right')
      ),
    ];
  }
  const result = nameLines.map((line, idx) => {
    if (idx === 0) {
      return (
        pad(line, cols.item) +
        ' ' +
        pad(qtyStr, cols.qty, 'right') +
        ' ' +
        pad(rateStr, cols.rate, 'right') +
        ' ' +
        pad(amtStr, cols.amt, 'right')
      );
    }
    return pad(line, cols.item);
  });
  
  // Add tax lines indented below product name
  if (taxLines.length > 0) {
    result.push(...taxLines);
  }
  
  return result;
}

function formatItemTaxLines(width: number, taxDetails: { label: string; amount: number }[]): string[] {
  const lines: string[] = [];
  for (const tax of taxDetails) {
    const taxLabel = tax.label ? `${tax.label} ` : '';
    const taxLine = `  Tax: ${taxLabel}${money(tax.amount)}`;
    lines.push(...wrapWords(taxLine, width));
  }
  return lines;
}

function itemTaxDetails(item: NonNullable<BillDetail['items']>[number]): { label: string; amount: number }[] {
  if (item.taxes?.length) {
    return item.taxes.map((tax) => {
      const rate = Number.parseFloat(String(tax.rate_percent));
      const rateLabel = Number.isFinite(rate) ? ` (${Number.parseFloat(rate.toFixed(4))}%)` : '';
      return {
        label: `${ascii(tax.tax_name || L('Tax'))}${rateLabel}`,
        amount: n(tax.tax_amount),
      };
    });
  }

  const taxAmount = n(item.tax_amount);
  return taxAmount > 0 ? [{ label: '', amount: taxAmount }] : [];
}

function pickShopName(shop: ShopSettings | null | undefined): string {
  const s = shop as (ShopSettings & {
    shop_name?: string;
    shop_name_mr?: string;
    name_mr?: string;
  }) | null | undefined;
  const text = shopTextForBill(
    {
      ...s,
      shopName: s?.shopName || s?.shop_name,
      shopNameMr: s?.shopNameMr || s?.shop_name_mr || s?.name_mr,
    },
    useLanguageStore.getState().bill,
  );
  return ascii(text.shopName || APP_DISPLAY_NAME);
}

function pickAddress(shop: ShopSettings | null | undefined): string {
  const mr = useLanguageStore.getState().bill === 'mr';
  const addressMr = ascii(shop?.addressMr || '');
  if (mr && addressMr) return addressMr;
  const address = ascii(shop?.address || '');
  const city = ascii(shop?.city || '');
  const state = ascii(shop?.state || '');
  const pincode = ascii(shop?.pincode || '');

  const parts: string[] = [];
  if (address) parts.push(address);
  if (city && !address.toLowerCase().includes(city.toLowerCase())) parts.push(city);
  if (state && !address.toLowerCase().includes(state.toLowerCase())) parts.push(state);
  if (pincode && !address.includes(pincode)) parts.push(pincode);

  return parts.join(', ') || address || city;
}

function pickTagline(shop: ShopSettings | null | undefined): string {
  if (shop?.showTagline === false) return '';
  const mr = useLanguageStore.getState().bill === 'mr';
  if (mr && shop?.taglineMr?.trim()) return ascii(shop.taglineMr);
  return ascii(shop?.tagline || '');
}

function pickInvoiceTitle(shop: ShopSettings | null | undefined): string {
  const mr = useLanguageStore.getState().bill === 'mr';
  if (mr && shop?.invoiceTitleMr?.trim()) return ascii(shop.invoiceTitleMr);
  if (shop?.invoiceTitle?.trim()) return ascii(shop.invoiceTitle);
  return L('TAX INVOICE');
}

function pickGstin(shop: ShopSettings | null | undefined): string {
  const s = shop as (ShopSettings & { gst_in?: string }) | null | undefined;
  return ascii(s?.gstin || s?.gst_in || '');
}

function pickRegistrations(shop: ShopSettings | null | undefined): { label: string; value: string }[] {
  const list: { label: string; value: string }[] = [];
  if (shop?.showGstin !== false) {
    const gstin = pickGstin(shop);
    if (gstin) list.push({ label: 'GSTIN', value: gstin });
  }
  if (shop?.showFssai !== false && shop?.fssai?.trim()) {
    list.push({ label: 'FSSAI', value: ascii(shop.fssai.trim()) });
  }
  if (shop?.showDrugLicense !== false && shop?.drugLicense?.trim()) {
    list.push({ label: 'D.L. No', value: ascii(shop.drugLicense.trim()) });
  }
  if (shop?.showTradeLicense !== false && shop?.tradeLicense?.trim()) {
    list.push({ label: 'Lic / Reg No', value: ascii(shop.tradeLicense.trim()) });
  }
  if (shop?.showPan !== false && shop?.pan?.trim()) {
    list.push({ label: 'PAN', value: ascii(shop.pan.trim().toUpperCase()) });
  }
  return list;
}

function pickTerms(shop: ShopSettings | null | undefined): string {
  if (shop?.showTerms === false) return '';
  const mr = useLanguageStore.getState().bill === 'mr';
  if (mr && shop?.termsMr?.trim()) return ascii(shop.termsMr);
  return ascii(shop?.terms || '');
}

function pickUpi(shop: ShopSettings | null | undefined): string {
  if (shop?.showUpi === false) return '';
  return ascii(shop?.upiId || '');
}

function pickFooter(shop: ShopSettings | null | undefined): string {
  const s = shop as (ShopSettings & { bill_footer?: string }) | null | undefined;
  return ascii(s?.billFooter || s?.bill_footer || '');
}

function pickBillNo(bill: BillDetail): string {
  const b = bill as BillDetail & { billNumber?: string };
  return ascii(b.bill_number || b.billNumber || '');
}

function formatPrintedName(base: string, size?: string | null, color?: string | null): string {
  const name = String(base || '').trim();
  const parts = [size, color].map((p) => String(p || '').trim()).filter(Boolean);
  if (!name) return parts.join(' · ') || '-';
  return parts.length ? `${name} (${parts.join(' · ')})` : name;
}

/** Bill language Marathi → Marathi product name when set; else English / saved line. */
function itemPrintName(item: NonNullable<BillDetail['items']>[number]): string {
  const mrBill = useLanguageStore.getState().bill === 'mr';
  const variant = item.variant;
  const product = variant?.product;
  const size = variant?.size;
  const color = variant?.color;
  const saved = String(item.product_name || '').trim();
  if (mrBill) {
    const marathi = String(
      product?.name_mr
      || item.product_name_mr
      || '',
    ).trim();
    if (marathi) return formatPrintedName(marathi, size, color);
    // Draft / createBill may already put Marathi (with size) on product_name.
    if (hasDevanagari(saved)) return saved;
  } else if (product?.name) {
    return formatPrintedName(product.name, size, color);
  }
  return saved || '-';
}

function pickBillDate(bill: BillDetail): string {
  return fmtDate(bill.created_at || bill.createdAt);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Attractive tabular thermal receipt built on the device
 * so layout changes show even when the app uses the live API.
 */
export function buildThermalReceipt(
  bill: BillDetail,
  shop: ShopSettings | null,
  width = 32,
): string {
  // 32 (58mm full width), 48 (80mm), or A4 — never 42 on 80mm.
  const w =
    width <= 36 ? 32 : width >= A4_CHARS_PER_LINE ? A4_CHARS_PER_LINE : 48;
  const cols = colsFor(w);
  const lines: string[] = [];
  const shopName = pickShopName(shop);
  const tagline = pickTagline(shop);
  const address = pickAddress(shop);
  const phone = ascii(shop?.phone || '');
  const secPhone = ascii(shop?.secondaryPhone || '');
  const regs = pickRegistrations(shop);
  const invoiceTitle = pickInvoiceTitle(shop);
  const upi = pickUpi(shop);
  const terms = pickTerms(shop);

  lines.push(rule(w, '='));
  // One CB block — ESC/POS raster wraps by pixels (clearer than several half titles).
  lines.push(`<CB>${shopTitleDisplay(shopName)}</CB>`);
  if (tagline) {
    for (const part of wrapWords(tagline, w)) lines.push(`<C>${part}</C>`);
  }
  lines.push(rule(w, '='));

  if (address) {
    for (const part of wrapWords(address, w)) lines.push(`<C>${part}</C>`);
  }
  if (phone) {
    const phoneLine = secPhone ? `${L('Ph')}: ${phone} / ${secPhone}` : `${L('Ph')}: ${phone}`;
    lines.push(`<C>${phoneLine}</C>`);
    if (w >= 48 && regs[0]?.label === 'GSTIN') lines.push('');
  }
  for (const reg of regs) {
    lines.push(`<C>${reg.label}: ${reg.value}</C>`);
  }

  lines.push(rule(w, '-'));
  lines.push(`<C>${invoiceTitle}</C>`);
  lines.push(rule(w, '-'));

  lines.push(kv(w, L('Date'), pickBillDate(bill)));
  if (w >= 48) lines.push('');
  lines.push(kv(w, L('Customer'), ascii(bill.customer?.name || L('Walk-in'))));
  lines.push(rule(w, '='));
  lines.push(tableHeader(w, cols));
  lines.push(rule(w, '-'));

  const items = bill.items || [];
  for (const [index, item] of items.entries()) {
    const taxDetails = itemTaxDetails(item);
    const taxLines = formatItemTaxLines(w, taxDetails);
    
    lines.push(
      ...tableRows(
        w,
        cols,
        ascii(itemPrintName(item)),
        formatReceiptQuantity(n(item.quantity), billItemUom(item)),
        n(item.unit_price),
        n(item.line_total),
        taxLines,
      ),
    );
    if (w >= 48 && index < items.length - 1) lines.push('');
  }

  lines.push(rule(w, '='));
  lines.push(kv(w, L('Subtotal'), money(bill.subtotal)));
  if (n(bill.discount_amount) > 0) {
    lines.push(kv(w, L('Discount'), `-${money(bill.discount_amount)}`));
  }
  lines.push(kv(w, L('Tax'), money(bill.tax_amount)));
  if (Math.abs(n(bill.round_off_amount)) >= 0.005) {
    const ro = n(bill.round_off_amount);
    lines.push(kv(w, L('Round off'), `${ro > 0 ? '+' : '-'}${money(Math.abs(ro))}`));
  }
  lines.push(kv(w, L('TOTAL'), money(bill.total_amount)));
  lines.push(rule(w, '-'));

  for (const p of bill.payments || []) {
    lines.push(kv(w, payName(p.payment_mode), money(p.amount)));
  }
  if (n(bill.change_amount) > 0) {
    lines.push(kv(w, L('Change'), money(bill.change_amount)));
  }

  const saved = totalSaving(bill.items || []);
  if (saved > 0) {
    lines.push(rule(w, '-'));
    lines.push(kv(w, L('Total saving'), money(saved)));
  }

  if (upi) {
    lines.push(rule(w, '-'));
    lines.push(`<C>UPI: ${upi}</C>`);
  }
  if (terms) {
    lines.push(rule(w, '-'));
    for (const part of wrapWords(terms, w)) lines.push(`<C>${part}</C>`);
  }

  lines.push(rule(w, '='));
  const footer = pickFooter(shop);
  if (footer && !/thank\s*you/i.test(footer)) {
    for (const part of wrapWords(footer, w)) lines.push(`<C>${part}</C>`);
  }
  lines.push(`<C>${L('Thank you! Visit Again')}</C>`);
  lines.push(rule(w, '='));

  return lines.join('\n');
}

/** Attractive A4 / share HTML with a real item table */
export function buildA4Receipt(bill: BillDetail, shop: ShopSettings | null): string {
  const shopName = pickShopName(shop);
  const tagline = pickTagline(shop);
  const address = pickAddress(shop);
  const phone = ascii(shop?.phone || '');
  const secPhone = ascii(shop?.secondaryPhone || '');
  const regs = pickRegistrations(shop);
  const invoiceTitle = pickInvoiceTitle(shop);
  const upi = pickUpi(shop);
  const terms = pickTerms(shop);
  const footer = pickFooter(shop);

  const rows = (bill.items || [])
    .map((item, idx) => {
      const name = itemPrintName(item);
      const taxRows = itemTaxDetails(item)
        .map((tax) => `<div class="itemTax">${tax.label ? `${escapeHtml(tax.label)}: ` : 'Tax: '}Rs.${escapeHtml(money(tax.amount))}</div>`)
        .join('');
      return `<tr>
        <td class="c">${idx + 1}</td>
        <td>${escapeHtml(name)}${item.sku ? `<div class="sku">${escapeHtml(item.sku)}</div>` : ''}${taxRows}</td>
        <td class="r">${escapeHtml(formatBillQuantity(n(item.quantity), billItemUom(item)))}</td>
        <td class="r">${escapeHtml(money(item.unit_price))}</td>
        <td class="r">${escapeHtml(money(item.line_total))}</td>
      </tr>`;
    })
    .join('');

  const payRows = (bill.payments || [])
    .map(
      (p) =>
        `<div class="pay"><span>${escapeHtml(payName(p.payment_mode))}</span><span>Rs.${escapeHtml(money(p.amount))}</span></div>`,
    )
    .join('');
  const upiRow = upi
    ? `<div class="pay"><span>UPI ID</span><span><strong>${escapeHtml(upi)}</strong></span></div>`
    : '';
  const saved = totalSaving(bill.items || []);

  const logoUrl = (shop?.logoUrl || '').trim();
  const showLogo = shop?.showLogo !== false;
  const logoBlock = logoUrl && showLogo
    ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="" />`
    : '';

  // Prepare payment QR code if enabled (actual rendering happens client-side)
  let paymentQrBlock = '';
  if (shop?.enablePaymentQr && shop?.paymentQrUpiId) {
    const shopName = shopTextForBill(shop, useLanguageStore.getState().bill).shopName;
    const qrData = `upi://pay?pa=${encodeURIComponent(shop.paymentQrUpiId)}&pn=${encodeURIComponent(shopName)}&am=${n(bill.total_amount)}&tn=${encodeURIComponent(bill.bill_number || 'Bill')}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrData)}`;
    paymentQrBlock = `<div style="text-align:center;margin:12px 0"><img src="${escapeHtml(qrUrl)}" alt="Payment QR" style="max-width:150px;border:1px solid #000;padding:4px"/><p style="font-size:11px;margin:4px 0">Pay Now</p></div>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>${escapeHtml(pickBillNo(bill))}</title>
<style>
  @page {
    size: A4 portrait;
    margin: 3mm 8mm 6mm;
  }
  *{box-sizing:border-box}
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    max-width: 100%;
  }
  body{font-family:Arial,Helvetica,${DEVANAGARI_FONTS},sans-serif;color:#000;font-weight:400;margin:0;padding:4px 16px 16px;width:100%;max-width:100%;
    -webkit-print-color-adjust:exact;print-color-adjust:exact}
  h1,th,strong,b,.totals .grand{font-weight:700}
  .head{text-align:center;border:1px solid #000;padding:8px 12px;margin-bottom:8px;width:100%}
  .logo{display:block;max-height:56px;max-width:200px;margin:0 auto 4px;object-fit:contain}
  .shop{margin:0;font-size:26px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;text-align:center;line-height:1.25}
  .meta{margin:2px 0 0;color:#000;font-size:12px;line-height:1.4}
  .title{margin:6px 0 0;font-size:12px;letter-spacing:.2em;line-height:1.4}
  .info{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;text-align:left;margin-bottom:8px;font-size:13px;line-height:1.4;width:100%}
  .customerInfo{flex:1;min-width:0}
  .billMeta{text-align:right;min-width:190px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{color:#000;padding:7px 6px;text-align:left;letter-spacing:.04em;font-size:11px;line-height:1.35;border-top:1px solid #000;border-bottom:1px solid #000}
  td{padding:7px 6px;border-bottom:0.5px solid #000;line-height:1.35}
  th.r,td.r{text-align:right}
  th.c,td.c{text-align:center;width:36px}
  .sku{color:#000;font-size:11px;margin-top:2px}
  .itemTax{font-size:10px;line-height:1.35;margin-top:2px}
  .totals{width:300px;margin:12px 0 0 auto;font-size:13px}
  .totals .row{display:flex;justify-content:space-between;padding:3px 0}
  .totals .grand{border-top:1px solid #000;margin-top:6px;padding-top:6px;font-size:16px}
  .totals .save{margin-top:6px;padding-top:6px;border-top:1px dashed #000;font-weight:700}
  .pay{display:flex;justify-content:space-between;width:300px;margin:3px 0 0 auto;font-size:13px}
  .foot{text-align:center;margin-top:18px;padding-top:10px;border-top:1px dashed #000;color:#000;font-size:13px;width:100%}
  .cut-space{height:16mm;width:100%}
  @media print {
    @page {
      size: A4 portrait;
      margin: 3mm 8mm 6mm;
    }
    html, body { width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; }
    .head, .info, table, .foot { width: 100% !important; max-width: 100% !important; }
    .head { padding: 6px 10px !important; margin-bottom: 6px !important; }
    .cut-space { height: 16mm !important; }
  }
</style></head><body>
  <div class="head">
    ${logoBlock}
    <h1 class="shop">${escapeHtml(shopName)}</h1>
    ${tagline ? `<p class="meta" style="font-style:italic;font-size:13px">${escapeHtml(tagline)}</p>` : ''}
    ${address ? `<p class="meta">${escapeHtml(address)}</p>` : ''}
    ${phone ? `<p class="meta">${escapeHtml(L('Ph'))}: ${escapeHtml(phone)}${secPhone ? ` / ${escapeHtml(secPhone)}` : ''}</p>` : ''}
    ${regs.map((r) => `<p class="meta">${escapeHtml(r.label)}: ${escapeHtml(r.value)}</p>`).join('')}
    <p class="title">${escapeHtml(invoiceTitle)}</p>
  </div>
  <div class="info">
    <div class="customerInfo">
      <div><strong>${escapeHtml(L('Customer'))}</strong></div>
      <div>${escapeHtml(bill.customer?.name || L('Walk-in'))}</div>
      ${bill.customer?.phone ? `<div><strong>${escapeHtml(L('Ph'))}</strong> ${escapeHtml(bill.customer.phone)}</div>` : ''}
    </div>
    <div class="billMeta">
      <div><strong>${escapeHtml(L('Date'))}</strong> ${escapeHtml(pickBillDate(bill))}</div>
      ${bill.bill_number ? `<div><strong>${escapeHtml(L('Bill number', 'Bill No'))}</strong> ${escapeHtml(bill.bill_number)}</div>` : ''}
    </div>
  </div>
  <table>
    <thead>
      <tr><th class="c">#</th><th>${escapeHtml(L('Item'))}</th><th class="r">${escapeHtml(L('Qty'))}</th><th class="r">${escapeHtml(L('Rate'))}</th><th class="r">${escapeHtml(L('Amount'))}</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div class="row"><span>${escapeHtml(L('Subtotal'))}</span><span>Rs.${escapeHtml(money(bill.subtotal))}</span></div>
    ${n(bill.discount_amount) > 0 ? `<div class="row"><span>${escapeHtml(L('Discount'))}</span><span>-Rs.${escapeHtml(money(bill.discount_amount))}</span></div>` : ''}
    <div class="row"><span>${escapeHtml(L('Tax'))}</span><span>Rs.${escapeHtml(money(bill.tax_amount))}</span></div>
    ${Math.abs(n(bill.round_off_amount)) >= 0.005 ? `<div class="row"><span>${escapeHtml(L('Round off'))}</span><span>${n(bill.round_off_amount) > 0 ? '+' : '-'}Rs.${escapeHtml(money(Math.abs(n(bill.round_off_amount))))}</span></div>` : ''}
    <div class="row grand"><span>${escapeHtml(L('TOTAL'))}</span><span>Rs.${escapeHtml(money(bill.total_amount))}</span></div>
    ${saved > 0 ? `<div class="row save"><span>${escapeHtml(L('Total saving'))}</span><span>Rs.${escapeHtml(money(saved))}</span></div>` : ''}
  </div>
  ${payRows}
  ${upiRow}
  ${paymentQrBlock}
  <div class="foot">
    ${terms ? `<p style="font-size:11px;margin-bottom:8px"><strong>${escapeHtml(L('Terms & Conditions'))}:</strong> ${escapeHtml(terms)}</p>` : ''}
    ${footer && !/^thank you!?$/i.test(footer) ? `<p>${escapeHtml(footer)}</p>` : ''}
    <p><strong>${escapeHtml(L('Thank you! Visit Again'))}</strong></p>
  </div>
  <div class="cut-space"></div>
</body></html>`;
}

export function buildReceiptPayload(
  bill: BillDetail,
  shop: ShopSettings | null,
  format: '58' | '80' | 'a4',
): ThermalPrintPayload {
  if (format === 'a4') {
    const raw = buildThermalReceipt(bill, shop, A4_CHARS_PER_LINE);
    return {
      format: 'a4',
      html: buildA4Receipt(bill, shop),
      mimeType: 'text/html',
      charsPerLine: A4_CHARS_PER_LINE,
      lines: raw.split('\n'),
      raw,
    };
  }
  const charsPerLine = receiptCharsForPaper(format);
  const raw = buildThermalReceipt(bill, shop, charsPerLine);
  const thermal = buildThermalHtml(raw, charsPerLine, format);
  return {
    format,
    charsPerLine,
    lines: raw.split('\n'),
    raw,
    html: thermal.html,
  };
}
