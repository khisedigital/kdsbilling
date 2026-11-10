import api from '../services/api';
import { fetchBill, type BillDetail } from '../services/businessService';
import { getShopSettings, shopTextForBill } from '../services/shopSettingsService';
import { getPrinterSettings, IS_DESKTOP, type PrinterSettings } from '../store/printerStore';
import { APP_DISPLAY_NAME } from '../constants/branding';
import { billT } from '../i18n';
import { useLanguageStore } from '../i18n/languageStore';
import { A4_CHARS_PER_LINE, buildReceiptPayload } from './buildReceipt';
import { receiptCharsForPaper } from './escpos';
import { printViaA4, printViaBluetooth, printViaNetwork, printViaSystem } from './PrintService';

export type PrintReceiptResult = {
  ok: true;
  mode: 'bluetooth' | 'network' | 'server' | 'system';
};

function paperFormat(settings: PrinterSettings): '58' | '80' | 'a4' {
  if (settings.paperSize === '58') return '58';
  return settings.paperSize === 'a4' && IS_DESKTOP ? 'a4' : '80';
}

/**
 * Paper drives the command path:
 * - 58 / 80 mm → POS thermal ESC/POS (mobile BLE, desktop raw queue, or Wi‑Fi :9100)
 * - A4 → normal printer HTML (never ESC/POS roll layout)
 */
async function sendPayloadToPrinter(
  billId: string | null,
  bill: BillDetail,
): Promise<PrintReceiptResult> {
  const settings = await getPrinterSettings();
  const format = paperFormat(settings);
  const shop = await getShopSettings().catch(() => null);
  const payload = buildReceiptPayload(bill, shop, format);
  const text = payload.raw || payload.lines?.join('\n') || '';
  const width = payload.charsPerLine || (format === '58' ? 30 : 48);

  // A4 → office / inkjet / laser via HTML (system dialog or named printer).
  if (format === 'a4') {
    if (!payload.html) throw new Error('A4 print data was empty.');
    await printViaA4(payload.html, `Receipt-${billId || 'draft'}`, {
      printerName: settings.type === 'system' ? settings.systemPrinterName : undefined,
    });
    return { ok: true, mode: 'system' };
  }

  const roll: '58' | '80' = format === '58' ? '58' : '80';

  if (settings.type === 'bluetooth') {
    if (!settings.bluetoothAddress) {
      throw new Error('Select a Bluetooth printer in Printer Settings first.');
    }
    if (!text.trim()) throw new Error('Print data was empty. Try again.');
    await printViaBluetooth(settings.bluetoothAddress, text, width);
    return { ok: true, mode: 'bluetooth' };
  }

  if (settings.type === 'system') {
    if (!text.trim()) throw new Error('Print data was empty. Try again.');
    // Desktop: raw ESC/POS to the POS queue. Browser: HTML fallback.
    await printViaSystem(settings.systemPrinterName || '', text, width, roll);
    return { ok: true, mode: 'system' };
  }

  if (settings.type === 'network') {
    if (settings.networkHost) {
      if (!text.trim()) throw new Error('Print data was empty. Try again.');
      await printViaNetwork(settings.networkHost, settings.networkPort || 9100, text, width);
      return { ok: true, mode: 'network' };
    }
    if (settings.serverPrinterId) {
      if (!billId) {
        throw new Error('Server printer needs a saved bill. Use Bluetooth/Network IP or Complete first.');
      }
      await api.post(`/bills/${billId}/print-network`, {
        printerId: settings.serverPrinterId,
        language: useLanguageStore.getState().bill,
      });
      return { ok: true, mode: 'server' };
    }
    throw new Error('Configure network printer IP in Printer Settings.');
  }

  throw new Error('Configure a printer in Printer Settings first.');
}

/**
 * Builds an attractive tabular receipt on-device (shop header + item table),
 * then sends it to the configured printer.
 * Throws on failure — caller handles UX.
 */
export async function printReceipt(billId: string): Promise<PrintReceiptResult> {
  if (!billId) throw new Error('Missing bill id');
  const bill = await fetchBill(billId);
  return sendPayloadToPrinter(billId, bill);
}

/**
 * Print current payment preview without creating/closing the sale.
 */
export async function printDraftReceipt(bill: BillDetail): Promise<PrintReceiptResult> {
  return sendPayloadToPrinter(null, bill);
}

function buildTestThermalSample(opts: {
  shopName: string;
  address: string;
  city: string;
  phone: string;
  width: number;
}): string {
  const { shopName, address, city, phone, width } = opts;
  const star = '*'.repeat(width);
  const dash = '-'.repeat(width);
  const eq = '='.repeat(width);
  const addr = [address, city].filter(Boolean).join(', ');
  const mrBill = useLanguageStore.getState().bill === 'mr';
  const stamp = new Date().toLocaleString(mrBill ? 'mr-IN' : 'en-IN');
  const wide = width >= A4_CHARS_PER_LINE;
  const itemW = width <= 30 ? 10 : width <= 32 ? 12 : wide ? 51 : 18;
  const qtyW = width <= 32 ? 3 : wide ? 6 : 4;
  const rateW = width <= 32 ? 7 : wide ? 10 : 8;
  const amtW = width <= 32 ? 7 : wide ? 10 : 9;
  const pad = (t: string, w: number, right = false) => {
    const b = t.slice(0, w);
    return right ? b.padStart(w) : b.padEnd(w);
  };
  const word = (english: string, printed = english) => (mrBill ? billT(english) : printed);
  const header =
    pad(word('Item', 'ITEM'), itemW) + ' ' + pad(word('Qty', 'QTY'), qtyW, true) + ' ' + pad(word('Rate', 'RATE'), rateW, true) + ' ' + pad(word('Amount', 'AMT'), amtW, true);
  const row =
    pad(word('Sample Item'), itemW) + ' ' + pad('1', qtyW, true) + ' ' + pad('10.00', rateW, true) + ' ' + pad('10.00', amtW, true);

  const lines = [
    eq,
    `<CB>${(shopName || APP_DISPLAY_NAME).slice(0, width)}</CB>`,
    eq,
  ];
  if (addr) lines.push(`<C>${addr}</C>`);
  if (phone) lines.push(`<C>${word('Ph')}: ${phone}</C>`);
  lines.push(dash);
  lines.push(`<C>${word('TEST PRINT')}</C>`);
  lines.push(dash);
  lines.push(`${word('Date')}: ${stamp}`);
  lines.push(eq);
  lines.push(header.slice(0, width));
  lines.push(dash);
  lines.push(row.slice(0, width));
  lines.push(eq);
  lines.push(`<C>${word('Printer check OK')}</C>`);
  lines.push(star);
  return lines.join('\n');
}

function buildTestA4Html(opts: {
  shopName: string;
  address: string;
  city: string;
  phone: string;
}): string {
  const { shopName, address, city, phone } = opts;
  const mr = useLanguageStore.getState().bill === 'mr';
  const word = (english: string) => (mr ? billT(english) : english);
  const stamp = new Date().toLocaleString(mr ? 'mr-IN' : 'en-IN');
  const addr = [address, city].filter(Boolean).join(', ');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Test Print</title>
<style>
  body{font-family:Arial,sans-serif;padding:28px;color:#000;font-weight:400;max-width:640px;margin:0 auto;
    -webkit-print-color-adjust:exact;print-color-adjust:exact}
  h1,th,strong,b{font-weight:700}
  .head{text-align:center;border:1px solid #000;padding:16px;margin-bottom:16px}
  .shop{font-size:28px;margin:0;letter-spacing:.02em;text-transform:uppercase;text-align:center}
  .meta{font-size:13px;color:#000;margin:4px 0}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}
  th{color:#000;padding:8px;text-align:left;border-top:1px solid #000;border-bottom:1px solid #000}
  td{padding:8px;border-bottom:0.5px solid #000}
  th.r,td.r{text-align:right}
</style></head>
<body>
  <div class="head">
    <h1 class="shop">${shopName || APP_DISPLAY_NAME}</h1>
    ${addr ? `<p class="meta">${addr}</p>` : ''}
    ${phone ? `<p class="meta">${word('Ph')}: ${phone}</p>` : ''}
    <p class="meta" style="letter-spacing:.16em;margin-top:8px">${word('TEST PRINT')}</p>
  </div>
  <p>${stamp}</p>
  <table>
    <thead><tr><th>${word('Item')}</th><th class="r">${word('Qty')}</th><th class="r">${word('Rate')}</th><th class="r">${word('Amount')}</th></tr></thead>
    <tbody><tr><td>${word('Sample Item')}</td><td class="r">1</td><td class="r">10.00</td><td class="r">10.00</td></tr></tbody>
  </table>
  <p style="text-align:center;margin-top:20px"><strong>${word('Printer check OK')}</strong></p>
</body></html>`;
}

export async function testPrint(): Promise<void> {
  const settings = await getPrinterSettings();
  let shopName = APP_DISPLAY_NAME;
  let address = '';
  let city = '';
  let phone = '';
  try {
    const shop = await getShopSettings();
    const bill = useLanguageStore.getState().bill;
    const text = shopTextForBill(shop, bill);
    shopName = text.shopName || shopName;
    address = text.address || '';
    city = bill === 'mr' && shop.addressMr?.trim() ? '' : shop.city || '';
    phone = shop.phone || '';
  } catch {
    // Fall back to app name if shop settings unavailable
  }

  const format = paperFormat(settings);

  if (format === 'a4') {
    const sampleHtml = buildTestA4Html({ shopName, address, city, phone });
    await printViaA4(sampleHtml, `${shopName}-Test`, {
      printerName: settings.type === 'system' ? settings.systemPrinterName : undefined,
    });
    return;
  }

  const width = receiptCharsForPaper(format);
  const sample = buildTestThermalSample({ shopName, address, city, phone, width });
  const paper = format === '58' ? ('58' as const) : ('80' as const);

  if (settings.type === 'bluetooth') {
    if (!settings.bluetoothAddress) {
      throw new Error('Select a Bluetooth printer first, then try Test Print.');
    }
    await printViaBluetooth(settings.bluetoothAddress, sample, width);
    return;
  }

  if (settings.type === 'system') {
    await printViaSystem(settings.systemPrinterName || '', sample, width, paper);
    return;
  }

  if (settings.type === 'network') {
    if (!settings.networkHost) {
      throw new Error('Enter the network printer IP first, then try Test Print.');
    }
    await printViaNetwork(settings.networkHost, settings.networkPort || 9100, sample, width);
    return;
  }

  throw new Error('Configure printer in settings first');
}
