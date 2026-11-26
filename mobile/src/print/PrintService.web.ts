/// <reference lib="dom" />
import indicFontUrl from '../assets/NotoSansDevanagari-Regular.ttf';
import { getDesktopBridge } from '../desktop/bridge';
import {
  buildEscPosBytes,
  buildThermalHtml,
  bytesToBase64,
  sanitizeEscPosText,
  type ThermalHtmlPaper,
} from './escpos';
import { hasDevanagari } from './indicText';
import { insertPaymentQr } from './qrCodeGenerator';

let indicFontTask: Promise<void> | null = null;

/** Load the bundled Devanagari face before the receipt canvas draws a name. */
async function ensureIndicFont(text: string): Promise<void> {
  if (!hasDevanagari(text)) return;
  await prewarmIndicFont();
}

/** Start loading Devanagari early so the first MR print is not stalled on FontFace. */
export function prewarmIndicFont(): Promise<void> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') {
    return Promise.resolve();
  }
  if (!indicFontTask) {
    const face = new FontFace('KdsDevanagari', `url(${JSON.stringify(indicFontUrl)})`, {
      weight: '400',
      style: 'normal',
    });
    indicFontTask = face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        (globalThis as { __kdsIndicFont?: boolean }).__kdsIndicFont = true;
      })
      .catch(() => undefined);
  }
  return indicFontTask ?? Promise.resolve();
}

async function thermalBytes(
  text: string,
  charsPerLine: number,
  paper?: ThermalHtmlPaper,
  qrData = '',
): Promise<number[]> {
  await ensureIndicFont(text);
  // Prefer explicit paper from Settings so 58mm cannot encode as 80mm page width.
  const bytes = buildEscPosBytes(text, charsPerLine, paper);
  return qrData ? insertPaymentQr(bytes, qrData, paper === '58' ? 32 : charsPerLine) : bytes;
}

export { buildEscPosBytes, sanitizeEscPosText, toPlainReceipt } from './escpos';
export type { ThermalPrintPayload } from './escpos';

const DESKTOP_ONLY = 'This printer type needs the KDSPOZ desktop app.';

/**
 * Browser system print. Prefer a real window so Chrome applies @page width;
 * fall back to an off-screen iframe (must not use opacity:0 — prints blank).
 * `paperMm` sizes the popup/iframe to the roll width so layout matches 58/80.
 */
function printHtmlInBrowser(html: string, paperMm = 80, isA4 = false): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (cleanup?: () => void) => {
      if (settled) return;
      settled = true;
      try {
        cleanup?.();
      } catch {
        /* ignore */
      }
      resolve();
    };

    const isFullWidth = isA4 || paperMm >= 210;
    // ~3.8 CSS px/mm for thermal rolls; wide desktop width for A4 so preview formats to 100% width.
    const popupW = isFullWidth ? 1024 : Math.max(220, Math.round(paperMm * 3.8 + 48));
    const tryPopup = (): boolean => {
      const popup = window.open('', '_blank', `noopener,noreferrer,width=${popupW},height=720`);
      if (!popup) return false;
      try {
        popup.document.open();
        popup.document.write(html);
        popup.document.close();
      } catch {
        try {
          popup.close();
        } catch {
          /* ignore */
        }
        return false;
      }
      const onAfterPrint = () => {
        popup.removeEventListener('afterprint', onAfterPrint);
        finish(() => {
          try {
            popup.close();
          } catch {
            /* ignore */
          }
        });
      };
      popup.addEventListener('afterprint', onAfterPrint);
      popup.onload = () => {
        try {
          popup.focus();
          popup.print();
        } catch (err) {
          popup.removeEventListener('afterprint', onAfterPrint);
          try {
            popup.close();
          } catch {
            /* ignore */
          }
          reject(err instanceof Error ? err : new Error('Print failed'));
        }
      };
      // document.write docs are often already loaded
      setTimeout(() => {
        if (settled) return;
        try {
          popup.focus();
          popup.print();
        } catch {
          /* afterprint / timeout handle settle */
        }
      }, 250);
      setTimeout(() => {
        finish(() => {
          try {
            popup.close();
          } catch {
            /* ignore */
          }
        });
      }, 60_000);
      return true;
    };

    if (tryPopup()) return;

    const frame = document.createElement('iframe');
    frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${isFullWidth ? '100%' : `${paperMm}mm`};min-height:100vh;border:0;`;
    frame.setAttribute('aria-hidden', 'true');
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) {
        finish(() => frame.remove());
        return;
      }
      const onAfterPrint = () => {
        win.removeEventListener('afterprint', onAfterPrint);
        finish(() => frame.remove());
      };
      win.addEventListener('afterprint', onAfterPrint);
      try {
        win.focus();
        win.print();
      } catch (err) {
        win.removeEventListener('afterprint', onAfterPrint);
        frame.remove();
        reject(err instanceof Error ? err : new Error('Print failed'));
        return;
      }
      setTimeout(() => finish(() => frame.remove()), 60_000);
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

export async function listSystemPrinters(): Promise<
  Array<{
    name: string;
    displayName: string;
    isDefault: boolean;
    driverName?: string;
    rawFriendly?: boolean;
  }>
> {
  const bridge = getDesktopBridge();
  if (!bridge) return [];
  const printers = await bridge.listPrinters();
  return printers.map((p) => ({
    name: p.name,
    displayName: p.displayName || p.name,
    isDefault: p.isDefault,
    driverName: p.driverName,
    rawFriendly: p.rawFriendly,
  }));
}

/**
 * Wake CUPS/Win queue on Print click — runs while receipt text is still building.
 * Fire-and-forget; never blocks the UI path.
 */
export function primeSystemPrinter(printerName?: string | null): void {
  const name = String(printerName || '').trim();
  if (!name) return;
  const bridge = getDesktopBridge();
  if (!bridge?.primePrinter) return;
  void bridge.primePrinter({ printerName: name }).catch(() => undefined);
}

/**
 * 58/80 mm POS receipts.
 * Desktop app → raw ESC/POS to the OS printer (same as mobile — correct paper width).
 * Browser-only → HTML fallback (drivers often ignore roll size; prefer desktop or Wi‑Fi IP).
 */
export async function printViaSystem(
  printerName: string,
  text: string,
  charsPerLine = 32,
  paper?: ThermalHtmlPaper,
  qrData = '',
): Promise<void> {
  const source = String(text || '').trim();
  if (!source) throw new Error('Nothing to print.');
  const paperSize: ThermalHtmlPaper = paper ?? (charsPerLine <= 32 ? '58' : '80');
  const bridge = getDesktopBridge();

  if (bridge?.printRawSystem) {
    // Do not cupsenable/prime between slips — that was cancelling the *next*
    // job in the OS queue after each success (1 ok, 2 skipped, 3 ok…).
    const bytes = await thermalBytes(sanitizeEscPosText(source), charsPerLine, paperSize, qrData);
    await bridge.printRawSystem({
      printerName: printerName || '',
      base64: bytesToBase64(bytes),
    });
    return;
  }

  // No raw queue: print HTML at the exact roll width from Paper size.
  const { html, paperMm, heightMm } = buildThermalHtml(source, charsPerLine, paperSize, qrData);
  if (bridge?.printHtml) {
    await bridge.printHtml({
      html,
      printerName: printerName || undefined,
      silent: Boolean(printerName),
      pageWidthMm: paperMm,
      pageHeightMm: Math.max(heightMm || 0, 60),
      noMargins: true,
      preferCssPageSize: true,
    });
    return;
  }
  await printHtmlInBrowser(html, paperMm);
}

export async function printViaNetwork(
  host: string,
  port: number,
  text: string,
  charsPerLine = 32,
  paper?: ThermalHtmlPaper,
  qrData = '',
): Promise<void> {
  if (!host?.trim()) throw new Error('No network printer IP configured.');
  const payload = sanitizeEscPosText(String(text || '').trim());
  if (!payload.trim()) throw new Error('Nothing to print.');

  const bridge = getDesktopBridge();
  if (!bridge) throw new Error(DESKTOP_ONLY);
  const roll: ThermalHtmlPaper = paper ?? (charsPerLine <= 32 ? '58' : '80');
  const bytes = await thermalBytes(payload, charsPerLine, roll, qrData);
  await bridge.printRaw({ host: host.trim(), port, base64: bytesToBase64(bytes) });
}

/** With a saved printer the page goes straight to it; otherwise the system print dialog opens */
export async function printViaA4(
  html: string,
  _title: string,
  target?: { printerName?: string },
): Promise<void> {
  const bridge = getDesktopBridge();
  if (!bridge) {
    await printHtmlInBrowser(html, 210, true);
    return;
  }
  const printerName = target?.printerName;
  await bridge.printHtml({
    html,
    printerName,
    silent: Boolean(printerName),
    a4: true,
    preferCssPageSize: true,
  });
}

/** Sends ready-made ESC/POS commands to a Wi-Fi / LAN printer. */
export async function printBytesViaNetwork(
  host: string,
  port: number,
  bytes: number[],
  copies = 1,
  batchSize = 0,
  jobKind?: 'label' | 'receipt',
): Promise<void> {
  if (!host?.trim()) throw new Error('No network printer IP configured.');
  if (!bytes.length) throw new Error('Nothing to print.');
  const bridge = getDesktopBridge();
  if (!bridge) throw new Error(DESKTOP_ONLY);
  await bridge.printRaw({
    host: host.trim(),
    port,
    base64: bytesToBase64(bytes),
    copies: Math.max(1, Math.min(999, Math.floor(copies) || 1)),
    batchSize: batchSize > 0 ? batchSize : undefined,
    jobKind,
  });
}

/**
 * Desktop: after pairing in OS Bluetooth, the POS printer appears as a queue.
 * `address` is that queue name — we send raw ESC/POS (same as mobile).
 */
/** Raw bytes (label / receipt job) to an OS printer queue. */
export async function printBytesViaSystem(
  printerName: string,
  bytes: number[],
  copies = 1,
  batchSize = 0,
  jobKind?: 'label' | 'receipt',
): Promise<void> {
  if (!printerName?.trim()) throw new Error('Select a printer in Printer Settings, then print.');
  if (!bytes.length) throw new Error('Nothing to print.');
  const bridge = getDesktopBridge();
  if (!bridge?.printRawSystem) throw new Error(DESKTOP_ONLY);
  await bridge.printRawSystem({
    printerName: printerName.trim(),
    base64: bytesToBase64(bytes),
    copies: Math.max(1, Math.min(999, Math.floor(copies) || 1)),
    batchSize: batchSize > 0 ? batchSize : undefined,
    jobKind,
  });
}

export async function printBytesViaBluetooth(
  address: string,
  bytes: number[],
  copies = 1,
  batchSize = 0,
  jobKind?: 'label' | 'receipt',
): Promise<void> {
  if (!address?.trim()) throw new Error('No Bluetooth printer selected.');
  if (!bytes.length) throw new Error('Nothing to print.');
  const bridge = getDesktopBridge();
  if (!bridge?.printRawSystem) {
    throw new Error(
      'Bluetooth POS printing needs the KDSPOZ desktop app. Pair the printer in system Bluetooth, then select it under Bluetooth.',
    );
  }
  await bridge.printRawSystem({
    printerName: address.trim(),
    base64: bytesToBase64(bytes),
    copies: Math.max(1, Math.min(999, Math.floor(copies) || 1)),
    batchSize: batchSize > 0 ? batchSize : undefined,
    jobKind,
  });
}

export async function isBluetoothAvailable(): Promise<boolean> {
  return Boolean(getDesktopBridge()?.printRawSystem);
}

/** Desktop: lists OS printers (pair the POS printer in Bluetooth settings first). */
export async function scanBluetoothPrinters(): Promise<Array<{ name: string; address: string }>> {
  const bridge = getDesktopBridge();
  if (!bridge) {
    throw new Error(
      'Bluetooth POS needs the desktop app. Pair the printer in macOS/Windows Bluetooth, open the desktop app, then select it here.',
    );
  }
  const printers = await listSystemPrinters();
  if (!printers.length) {
    throw new Error('No printers found. Pair the POS printer in system Bluetooth settings, then Refresh.');
  }
  return printers.map((p) => ({ name: p.displayName || p.name, address: p.name }));
}

export async function printViaBluetooth(
  address: string,
  text: string,
  charsPerLine = 32,
  paper?: ThermalHtmlPaper,
  qrData = '',
): Promise<void> {
  if (!address?.trim()) throw new Error('No Bluetooth printer selected.');
  const payload = sanitizeEscPosText(String(text || '').trim());
  if (!payload.trim()) throw new Error('Nothing to print.');
  const roll: ThermalHtmlPaper = paper ?? (charsPerLine <= 32 ? '58' : '80');
  const bytes = await thermalBytes(payload, charsPerLine, roll, qrData);
  await printBytesViaBluetooth(address, bytes);
}
