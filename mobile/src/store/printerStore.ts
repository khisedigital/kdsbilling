import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * POS (58/80 mm): bluetooth | network | system (USB/installed).
 * A4 office: system only.
 */
export type PrinterType = 'bluetooth' | 'network' | 'system';
/** A4 is desktop / web only. */
export type PaperSize = '58' | '80' | 'a4';

export interface PrinterSettings {
  type: PrinterType;
  paperSize: PaperSize;
  /**
   * Phone: BLE MAC / UUID.
   * Desktop: OS printer queue name after pairing the POS printer in system Bluetooth.
   */
  bluetoothAddress?: string;
  bluetoothName?: string;
  /** Desktop: installed printer; empty means ask with the print dialog (A4) */
  systemPrinterName?: string;
  networkHost?: string;
  networkPort?: number;
  serverPrinterId?: string;
}

const KEY = 'billing_printer_settings';

export const IS_DESKTOP = Platform.OS === 'web';

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  type: IS_DESKTOP ? 'system' : 'bluetooth',
  // Web/desktop defaults to 80mm (common POS roll); phones default 58mm Bluetooth rolls.
  paperSize: IS_DESKTOP ? '80' : '58',
};

function normalizePrinterSettings(raw: string | null): PrinterSettings {
  if (!raw) return { ...DEFAULT_PRINTER_SETTINGS };
  const stored = { ...DEFAULT_PRINTER_SETTINGS, ...JSON.parse(raw) } as Omit<PrinterSettings, 'type'> & {
    type: PrinterType | 'a4';
    networkPath?: string;
  };
  const saved = { ...stored, type: stored.type === 'a4' ? 'system' : stored.type } as PrinterSettings & {
    networkPath?: string;
  };
  delete saved.networkPath;
  if (stored.type === 'a4') saved.paperSize = 'a4';
  if (saved.networkPort === 9100) saved.networkPort = undefined;
  // Phones have no OS “system” queue for bills — map legacy system → bluetooth.
  if (!IS_DESKTOP && saved.type === 'system') saved.type = 'bluetooth';
  if (!IS_DESKTOP && saved.paperSize === 'a4') saved.paperSize = '80';
  // A4 never uses Bluetooth / network ESC/POS.
  if (IS_DESKTOP && saved.paperSize === 'a4' && saved.type !== 'system') saved.type = 'system';
  return saved;
}

export async function getPrinterSettings(): Promise<PrinterSettings> {
  return normalizePrinterSettings(await AsyncStorage.getItem(KEY));
}

export async function savePrinterSettings(settings: PrinterSettings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
}
