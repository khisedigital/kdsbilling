import { Platform } from 'react-native';
import { getDesktopBridge } from '../desktop/bridge';
import { getPrinterSettings } from '../store/printerStore';
import {
  isNativeLabelPrinterAvailable,
  printNativeGapLabel,
} from './labelPrinterNative';
import {
  buildGapLabelEscPos,
  LABEL_HEIGHT_MM as ESC_LABEL_HEIGHT_MM,
  LABEL_WIDTH_MM as ESC_LABEL_WIDTH_MM,
  type GapLabelContent,
} from './labelEscPos';

/** Preview size shown on screen (thermal sticker layout). */
export const LABEL_WIDTH_MM = ESC_LABEL_WIDTH_MM;
export const LABEL_HEIGHT_MM = ESC_LABEL_HEIGHT_MM;

export const DEMO_BARCODE = '2000000000008';

export type { GapLabelContent };

export function isDesktopLabelPrintAvailable(): boolean {
  return Platform.OS === 'web' && Boolean(getDesktopBridge()?.printRawSystem);
}

export function isGapLabelPrintAvailable(): boolean {
  return isNativeLabelPrinterAvailable() || isDesktopLabelPrintAvailable();
}

async function printDesktopGapLabel(label: GapLabelContent, copies: number): Promise<void> {
  const bytes = buildGapLabelEscPos(label, copies);
  const settings = await getPrinterSettings();
  const { printBytesViaBluetooth, printBytesViaNetwork, printBytesViaSystem } = await import(
    './PrintService'
  );

  if (settings.type === 'network') {
    const host = settings.networkHost?.trim();
    if (!host) {
      throw new Error('Set the printer IP in Printer Settings, or switch to USB.');
    }
    await printBytesViaNetwork(host, settings.networkPort || 9100, bytes);
    return;
  }

  if (settings.type === 'bluetooth') {
    const address = settings.bluetoothAddress?.trim();
    if (!address) {
      throw new Error('Select a Bluetooth printer in Printer Settings.');
    }
    await printBytesViaBluetooth(address, bytes);
    return;
  }

  const printerName = settings.systemPrinterName?.trim();
  if (!printerName) {
    throw new Error(
      'Select your USB label printer in Printer Settings (type: USB / installed), then print.',
    );
  }
  await printBytesViaSystem(printerName, bytes);
}

/**
 * Prints 50×25 mm labels:
 * - Android: Microlan PrinterSDK Bluetooth (bitmap → ESC/POS → GS FF)
 * - Desktop: same ESC/POS raster via USB / installed printer queue
 */
export async function printGapLabel(label: GapLabelContent, copies: number): Promise<void> {
  if (isNativeLabelPrinterAvailable()) {
    await printNativeGapLabel(label, copies);
    return;
  }
  if (isDesktopLabelPrintAvailable()) {
    await printDesktopGapLabel(label, copies);
    return;
  }
  throw new Error(
    Platform.OS === 'web'
      ? 'Label printing needs the KDSPOZ desktop app with a USB printer selected in Printer Settings.'
      : 'Gap-label printing needs the Android app. Open KDSPOZ on your phone, connect the Bluetooth printer, then print.',
  );
}
