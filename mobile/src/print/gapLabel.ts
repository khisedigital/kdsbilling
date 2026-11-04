import { Platform } from 'react-native';
import { getDesktopBridge } from '../desktop/bridge';
import { getLabelPrinterSettings } from '../store/printerStore';
import {
  isNativeLabelPrinterAvailable,
  printNativeGapLabel,
} from './labelPrinterNative';
import {
  buildGapLabelEscPos,
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

export function isDesktopLabelPrintAvailable(): boolean {
  return Platform.OS === 'web' && Boolean(getDesktopBridge()?.printRawSystem);
}

export function isGapLabelPrintAvailable(): boolean {
  return isNativeLabelPrinterAvailable() || isDesktopLabelPrintAvailable();
}

async function printDesktopGapLabel(label: GapLabelContent, copies: number): Promise<void> {
  // Label printer only — never reads billing / receipt printer settings.
  const settings = await getLabelPrinterSettings();
  const heightMm = normalizeLabelHeightMm(settings.labelHeightMm);
  const bytes = buildGapLabelEscPos(label, copies, heightMm);
  const { printBytesViaBluetooth, printBytesViaNetwork, printBytesViaSystem } = await import(
    './PrintService'
  );

  if (settings.type === 'network') {
    const host = settings.networkHost?.trim();
    if (!host) {
      throw new Error('Select a network label printer on the Barcode label screen.');
    }
    await printBytesViaNetwork(host, settings.networkPort || 9100, bytes);
    return;
  }

  if (settings.type === 'bluetooth') {
    const address = settings.bluetoothAddress?.trim();
    if (!address) {
      throw new Error('Select a Bluetooth label printer on the Barcode label screen.');
    }
    await printBytesViaBluetooth(address, bytes);
    return;
  }

  const printerName = settings.systemPrinterName?.trim();
  if (!printerName) {
    throw new Error('Select your USB label printer on the Barcode label screen, then print.');
  }
  await printBytesViaSystem(printerName, bytes);
}

/**
 * Prints 50×H mm labels (H from label printer settings, default 28):
 * - Android: Microlan PrinterSDK Bluetooth (bitmap → ESC/POS → GS FF)
 * - Desktop: same ESC/POS raster via USB / installed label printer queue
 */
export async function printGapLabel(label: GapLabelContent, copies: number): Promise<void> {
  if (isNativeLabelPrinterAvailable()) {
    const settings = await getLabelPrinterSettings();
    await printNativeGapLabel(label, copies, normalizeLabelHeightMm(settings.labelHeightMm));
    return;
  }
  if (isDesktopLabelPrintAvailable()) {
    await printDesktopGapLabel(label, copies);
    return;
  }
  throw new Error(
    Platform.OS === 'web'
      ? 'Label printing needs the KDSPOZ desktop app with a USB label printer selected on the Barcode label screen.'
      : 'Gap-label printing needs the Android app. Open KDSPOZ on your phone, connect the Bluetooth label printer, then print.',
  );
}
