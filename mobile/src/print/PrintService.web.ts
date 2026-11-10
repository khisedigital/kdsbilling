/// <reference lib="dom" />
import indicFontUrl from '../assets/NotoSansDevanagari-Bold.ttf';
import { getDesktopBridge } from '../desktop/bridge';
import {
  buildEscPosBytes,
  buildThermalHtml,
  bytesToBase64,
  sanitizeEscPosText,
  type ThermalHtmlPaper,
} from './escpos';
import { hasDevanagari } from './indicText';

let indicFontTask: Promise<void> | null = null;

/** Load the bundled Devanagari face before the receipt canvas draws a name. */
async function ensureIndicFont(text: string): Promise<void> {
  if (!hasDevanagari(text)) return;
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return;
  if (!indicFontTask) {
    const face = new FontFace('KdsDevanagari', `url(${JSON.stringify(indicFontUrl)})`, {
      weight: '700',
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
  await indicFontTask;
}

async function thermalBytes(text: string, charsPerLine: number): Promise<number[]> {
  await ensureIndicFont(text);
  return buildEscPosBytes(text, charsPerLine);
}

export { buildEscPosBytes, sanitizeEscPosText, toPlainReceipt } from './escpos';
export type { ThermalPrintPayload } from './escpos';

const DESKTOP_ONLY = 'This printer type needs the KDSPOZ desktop app.';

/**
 * Browser system print. Prefer a real window so Chrome applies @page width;
 * fall back to an off-screen iframe (must not use opacity:0 — prints blank).
 * `paperMm` sizes the popup/iframe to the roll width so layout matches 58/80.
 */
function printHtmlInBrowser(html: string, paperMm = 80): Promise<void> {
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

    // ~3.8 CSS px/mm — keep popup near roll width so preview matches print.
    const popupW = Math.max(220, Math.round(paperMm * 3.8 + 48));
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
    frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${paperMm}mm;min-height:100vh;border:0;`;
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
 * 58/80 mm POS receipts.
 * Desktop app → raw ESC/POS to the OS printer (same as mobile — correct paper width).
 * Browser-only → HTML fallback (drivers often ignore roll size; prefer desktop or Wi‑Fi IP).
 */
export async function printViaSystem(
  printerName: string,
  text: string,
  charsPerLine = 32,
  paper?: ThermalHtmlPaper,
): Promise<void> {
  const source = String(text || '').trim();
  if (!source) throw new Error('Nothing to print.');
  const paperSize: ThermalHtmlPaper = paper ?? (charsPerLine <= 32 ? '58' : '80');
  const bridge = getDesktopBridge();

  if (bridge?.printRawSystem) {
    const bytes = await thermalBytes(sanitizeEscPosText(source), charsPerLine);
    await bridge.printRawSystem({
      printerName: printerName || '',
      base64: bytesToBase64(bytes),
    });
    return;
  }

  // Browser: no raw queue access — last-resort HTML strip.
  const { html, paperMm } = buildThermalHtml(source, charsPerLine, paperSize);
  await printHtmlInBrowser(html, paperMm);
}

export async function printViaNetwork(
  host: string,
  port: number,
  text: string,
  charsPerLine = 32,
): Promise<void> {
  if (!host?.trim()) throw new Error('No network printer IP configured.');
  const payload = sanitizeEscPosText(String(text || '').trim());
  if (!payload.trim()) throw new Error('Nothing to print.');

  const bridge = getDesktopBridge();
  if (!bridge) throw new Error(DESKTOP_ONLY);
  const bytes = await thermalBytes(payload, charsPerLine);
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
    await printHtmlInBrowser(html);
    return;
  }
  const printerName = target?.printerName;
  await bridge.printHtml({ html, printerName, silent: Boolean(printerName), a4: true });
}

/** Sends ready-made ESC/POS commands to a Wi-Fi / LAN printer. */
export async function printBytesViaNetwork(
  host: string,
  port: number,
  bytes: number[],
  copies = 1,
  batchSize = 0,
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
  });
}

export async function printBytesViaBluetooth(
  address: string,
  bytes: number[],
  copies = 1,
  batchSize = 0,
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
): Promise<void> {
  if (!address?.trim()) throw new Error('No Bluetooth printer selected.');
  const payload = sanitizeEscPosText(String(text || '').trim());
  if (!payload.trim()) throw new Error('Nothing to print.');
  const bytes = await thermalBytes(payload, charsPerLine);
  await printBytesViaBluetooth(address, bytes);
}
