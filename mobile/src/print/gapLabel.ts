import { Platform } from 'react-native';
import { getDesktopBridge } from '../desktop/bridge';
import { getLabelPrinterSettings } from '../store/printerStore';
import {
  isNativeLabelPrinterAvailable,
  printNativeGapLabel,
} from './labelPrinterNative';
import {
  buildGapLabelEscPos,
  buildLabelCalibrateEscPos,
  LABEL_HEIGHT_MM as ESC_LABEL_HEIGHT_MM,
  LABEL_HEIGHT_OPTIONS as ESC_LABEL_HEIGHT_OPTIONS,
  LABEL_WIDTH_MM as ESC_LABEL_WIDTH_MM,
  normalizeLabelHeightMm,
  type GapLabelContent,
  type LabelHeightMm,
} from './labelEscPos';

/** Preview size shown on screen (thermal sticker layout). */
export const LABEL_WIDTH_MM = ESC_LABEL_WIDTH_MM;
export const LABEL_HEIGHT_MM = ESC_LABEL_HEIGHT_MM;
export const LABEL_HEIGHT_OPTIONS = ESC_LABEL_HEIGHT_OPTIONS;

export const DEMO_BARCODE = '2000000000008';

export type { GapLabelContent, LabelHeightMm };
export { normalizeLabelHeightMm };

/**
 * A small head (Seznik-class) holds about three full sticker pictures.
 * A fourth picture in the same burst is cut off. Two pictures, then a wait
 * long enough for those two to finish, stays inside that buffer on every platform.
 */
export const LABEL_PRINT_CHUNK = 2;
const LABEL_PAUSE_MS = 1200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Send every copy in bursts of two, waiting for each burst to print. */
async function sendPaced(count: number, send: (copies: number) => Promise<void>): Promise<void> {
  let sent = 0;
  while (sent < count) {
    const n = Math.min(LABEL_PRINT_CHUNK, count - sent);
    await send(n);
    sent += n;
    if (sent < count) await sleep(n * LABEL_PAUSE_MS);
  }
}

export function isDesktopLabelPrintAvailable(): boolean {
  return Platform.OS === 'web' && Boolean(getDesktopBridge()?.printRawSystem);
}

export function isGapLabelPrintAvailable(): boolean {
  return isNativeLabelPrinterAvailable() || isDesktopLabelPrintAvailable();
}

async function printDesktopGapLabel(label: GapLabelContent, copies: number): Promise<void> {
  // Label printer only — never reads billing / receipt printer settings.
  // ESC/POS is what these heads actually print. Each send is at most two stickers.
  const settings = await getLabelPrinterSettings();
  const heightMm = normalizeLabelHeightMm(settings.labelHeightMm);
  const count = Math.max(1, Math.min(999, Math.floor(copies) || 1));
  const { printBytesViaBluetooth, printBytesViaNetwork, printBytesViaSystem } = await import(
    './PrintService'
  );

  const deliver = async (bytes: number[]) => {
    if (settings.type === 'network') {
      const host = settings.networkHost?.trim();
      if (!host) throw new Error('Select a network label printer on the Barcode label screen.');
      await printBytesViaNetwork(host, settings.networkPort || 9100, bytes);
      return;
    }
    if (settings.type === 'bluetooth') {
      const address = settings.bluetoothAddress?.trim();
      if (!address) throw new Error('Select a Bluetooth label printer on the Barcode label screen.');
      await printBytesViaBluetooth(address, bytes);
      return;
    }
    const printerName = settings.systemPrinterName?.trim();
    if (!printerName) {
      throw new Error('Select your USB label printer on the Barcode label screen, then print.');
    }
    await printBytesViaSystem(printerName, bytes);
  };

  await sendPaced(count, async (n) => {
    await deliver(buildGapLabelEscPos(label, n, heightMm));
  });
}

/**
 * Prints 50×H mm labels on Mac, Windows, and Android.
 * Never queues more than two stickers. A small head cuts the label after the third
 * picture if they all arrive before the first ones have printed.
 */
export async function printGapLabel(label: GapLabelContent, copies: number): Promise<void> {
  const count = Math.max(1, Math.min(999, Math.floor(copies) || 1));

  if (isNativeLabelPrinterAvailable()) {
    const settings = await getLabelPrinterSettings();
    const heightMm = normalizeLabelHeightMm(settings.labelHeightMm);
    await sendPaced(count, (n) => printNativeGapLabel(label, n, heightMm));
    return;
  }

  if (isDesktopLabelPrintAvailable()) {
    await printDesktopGapLabel(label, count);
    return;
  }

  throw new Error(
    Platform.OS === 'web'
      ? 'Label printing needs the KDSPOZ desktop app with a USB label printer selected on the Barcode label screen.'
      : 'Gap-label printing needs the Android app. Open KDSPOZ on your phone, connect the Bluetooth label printer, then print.',
  );
}

/** Feed blank stickers so the gap sensor re-aligns (fixes cut/drift after a few prints). */
export async function calibrateGapLabelPrinter(): Promise<void> {
  if (isNativeLabelPrinterAvailable()) {
    const { calibrateNativeLabelPrinter } = await import('./labelPrinterNative');
    await calibrateNativeLabelPrinter();
    return;
  }
  if (!isDesktopLabelPrintAvailable()) {
    throw new Error('Connect the label printer first, then calibrate.');
  }
  const settings = await getLabelPrinterSettings();
  const bytes = buildLabelCalibrateEscPos();
  const { printBytesViaBluetooth, printBytesViaNetwork, printBytesViaSystem } = await import(
    './PrintService'
  );
  if (settings.type === 'network') {
    const host = settings.networkHost?.trim();
    if (!host) throw new Error('Select a network label printer first.');
    await printBytesViaNetwork(host, settings.networkPort || 9100, bytes);
    return;
  }
  if (settings.type === 'bluetooth') {
    const address = settings.bluetoothAddress?.trim();
    if (!address) throw new Error('Select a Bluetooth label printer first.');
    await printBytesViaBluetooth(address, bytes);
    return;
  }
  const printerName = settings.systemPrinterName?.trim();
  if (!printerName) throw new Error('Select your USB label printer first.');
  await printBytesViaSystem(printerName, bytes);
}
