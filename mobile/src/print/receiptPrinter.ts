import api from '../services/api';
import { fetchBill, type BillDetail } from '../services/businessService';
import { getShopSettingsForPrint } from '../offline/shopCache';
import { getShopSettings, shopTextForBill } from '../services/shopSettingsService';
import {
  getPrinterSettings,
  IS_DESKTOP,
  peekPrinterSettings,
  resolvePaperSize,
  type PrinterSettings,
} from '../store/printerStore';
import { APP_DISPLAY_NAME } from '../constants/branding';
import { billT } from '../i18n';
import { useLanguageStore } from '../i18n/languageStore';
import { A4_CHARS_PER_LINE, buildReceiptPayload } from './buildReceipt';
import { delay, estimatePrintFlushMs, receiptCharsForPaper } from './escpos';
import {
  printViaA4,
  printViaBluetooth,
  printViaNetwork,
  printViaSystem,
  primeSystemPrinter,
  prewarmIndicFont,
} from './PrintService';

/** Wake the configured system printer as soon as the user taps Print. */
export function wakePrinterOnClick(): void {
  void prewarmIndicFont();
  const peek = peekPrinterSettings();
  if (peek?.type === 'system' && peek.systemPrinterName) {
    primeSystemPrinter(peek.systemPrinterName);
  }
}

export type PrintReceiptResult = {
  ok: true;
  mode: 'bluetooth' | 'network' | 'server' | 'system';
};

/** One POS job at a time — overlapping sends look like “prints header, stops, starts over”. */
let printChain: Promise<unknown> = Promise.resolve();

async function withPrintLock<T>(fn: () => Promise<T>, holdMs = 0): Promise<T> {
  const previous = printChain;
  let release!: () => void;
  printChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous.catch(() => null);
  try {
    const result = await fn();
    // Keep the lock until the head finishes — a second send's "clear jobs" used to
    // kill the first slip mid-header, then reprint from the shop name.
    if (holdMs > 0) await delay(holdMs);
    return result;
  } finally {
    release();
  }
}

function paperFormat(settings: PrinterSettings): '58' | '80' | 'a4' {
  const size = resolvePaperSize(settings.paperSize);
  if (size === 'a4') return IS_DESKTOP ? 'a4' : '80';
  return size;
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
  // Start CUPS revive + shop load in parallel with settings — don't wait serially.
  wakePrinterOnClick();
  const settingsPromise = getPrinterSettings();
  const shopPromise = getShopSettingsForPrint().catch(() => null);
  const [settings, shop] = await Promise.all([settingsPromise, shopPromise]);
  if (settings.type === 'system') primeSystemPrinter(settings.systemPrinterName);
  const format = paperFormat(settings);
  const payload = buildReceiptPayload(bill, shop, format);
  const text = payload.raw || payload.lines?.join('\n') || '';
  // Desktop system/network raw already serializes in main; don't hold the Print
  // button for several seconds after the job is accepted.
  const holdMs =
    format === 'a4' || settings.type === 'system' || settings.type === 'network'
      ? 0
      : estimatePrintFlushMs(text);

  const run = async (): Promise<PrintReceiptResult> => {
    // A4 → office / inkjet / laser via HTML (system dialog or named printer).
    if (format === 'a4') {
      if (!payload.html) throw new Error('A4 print data was empty.');
      await printViaA4(payload.html, `Receipt-${billId || 'draft'}`, {
        printerName: settings.type === 'system' ? settings.systemPrinterName : undefined,
      });
      return { ok: true, mode: 'system' };
    }

    const roll: '58' | '80' = format === '58' ? '58' : '80';
    // Force width from the chosen roll (32 for 58mm, 48 for 80mm) — never a stale value.
    const rollWidth = receiptCharsForPaper(roll);

    if (settings.type === 'bluetooth') {
      if (!settings.bluetoothAddress) {
        throw new Error('Select a Bluetooth printer in Printer Settings first.');
      }
      if (!text.trim()) throw new Error('Print data was empty. Try again.');
      await printViaBluetooth(settings.bluetoothAddress, text, rollWidth, roll, payload.paymentQrData);
      return { ok: true, mode: 'bluetooth' };
    }

    if (settings.type === 'system') {
      if (!text.trim()) throw new Error('Print data was empty. Try again.');
      // Desktop: raw ESC/POS — main-process FIFO prints every click in order.
      await printViaSystem(settings.systemPrinterName || '', text, rollWidth, roll, payload.paymentQrData);
      return { ok: true, mode: 'system' };
    }

    if (settings.type === 'network') {
      if (settings.networkHost) {
        if (!text.trim()) throw new Error('Print data was empty. Try again.');
        await printViaNetwork(settings.networkHost, settings.networkPort || 9100, text, rollWidth, roll, payload.paymentQrData);
        return { ok: true, mode: 'network' };
      }
      if (settings.serverPrinterId) {
        if (!billId) {
          throw new Error('Server printer needs a saved bill. Use Bluetooth/Network IP or Complete first.');
        }
        await api.post(`/bills/${billId}/print-network`, {
          printerId: settings.serverPrinterId,
          language: useLanguageStore.getState().bill,
          format,
        });
        return { ok: true, mode: 'server' };
      }
      throw new Error('Configure network printer IP in Printer Settings.');
    }

    throw new Error('Configure a printer in Printer Settings first.');
  };

  // Desktop system/network: do not hold the renderer lock across the whole USB
  // wait — every Print click must reach the main-process FIFO. BLE still locks.
  if (settings.type === 'system' || settings.type === 'network') {
    return run();
  }
  return withPrintLock(run, holdMs);
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
  // Build stamp — if the slip still says "30 cols" the old app is still running.
  lines.push(`<C>${width <= 32 ? '58mm' : '80mm'} · ${width} cols · v28</C>`);
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
  body{font-family:Arial,sans-serif;padding:4px 16px 16px;color:#000;font-weight:400;width:100%;max-width:100%;
    -webkit-print-color-adjust:exact;print-color-adjust:exact}
  h1,th,strong,b{font-weight:700}
  .head{text-align:center;border:1px solid #000;padding:8px 12px;margin-bottom:8px;width:100%}
  .shop{font-size:26px;margin:0;letter-spacing:.02em;text-transform:uppercase;text-align:center;line-height:1.25}
  .meta{font-size:12px;color:#000;margin:2px 0;line-height:1.55}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
  th{color:#000;padding:9px 6px;text-align:left;line-height:1.55;border-top:1px solid #000;border-bottom:1px solid #000}
  td{padding:9px 6px;border-bottom:0.5px solid #000;line-height:1.55}
  th.r,td.r{text-align:right}
  .cut-space{height:16mm;width:100%}
  @media print {
    @page {
      size: A4 portrait;
      margin: 3mm 8mm 6mm;
    }
    html, body { width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; }
    .head, table { width: 100% !important; max-width: 100% !important; }
    .head { padding: 6px 10px !important; margin-bottom: 6px !important; }
    .cut-space { height: 16mm !important; }
  }
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
  <div class="cut-space"></div>
</body></html>`;
}

export async function testPrint(): Promise<void> {
  wakePrinterOnClick();
  const settingsPromise = getPrinterSettings();
  const shopPromise = getShopSettings().catch(() => null);
  const [settings, shop] = await Promise.all([settingsPromise, shopPromise]);
  if (settings.type === 'system') primeSystemPrinter(settings.systemPrinterName);
  let shopName = APP_DISPLAY_NAME;
  let address = '';
  let city = '';
  let phone = '';
  if (shop) {
    const bill = useLanguageStore.getState().bill;
    const text = shopTextForBill(shop, bill);
    shopName = text.shopName || shopName;
    address = text.address || '';
    city = bill === 'mr' && shop.addressMr?.trim() ? '' : shop.city || '';
    phone = shop.phone || '';
  }

  const format = paperFormat(settings);
  const paper = format === '58' ? ('58' as const) : format === '80' ? ('80' as const) : null;
  const width = paper ? receiptCharsForPaper(paper) : 32;
  const sample = paper
    ? buildTestThermalSample({ shopName, address, city, phone, width })
    : '';
  const holdMs =
    !paper || settings.type === 'system' || settings.type === 'network'
      ? 0
      : estimatePrintFlushMs(sample);

  return withPrintLock(async () => {
  if (format === 'a4') {
    const sampleHtml = buildTestA4Html({ shopName, address, city, phone });
    await printViaA4(sampleHtml, `${shopName}-Test`, {
      printerName: settings.type === 'system' ? settings.systemPrinterName : undefined,
    });
    return;
  }

  if (settings.type === 'bluetooth') {
    if (!settings.bluetoothAddress) {
      throw new Error('Select a Bluetooth printer first, then try Test Print.');
    }
    await printViaBluetooth(settings.bluetoothAddress, sample, width, paper!);
    return;
  }

  if (settings.type === 'system') {
    await printViaSystem(settings.systemPrinterName || '', sample, width, paper!);
    return;
  }

  if (settings.type === 'network') {
    if (!settings.networkHost) {
      throw new Error('Enter the network printer IP first, then try Test Print.');
    }
    await printViaNetwork(settings.networkHost, settings.networkPort || 9100, sample, width, paper!);
    return;
  }

  throw new Error('Configure printer in settings first');
  }, holdMs);
}
