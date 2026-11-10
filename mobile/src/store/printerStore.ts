import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * POS (58/80 mm): bluetooth | network | system (USB/installed).
 * A4 office: system only.
 *
 * Billing / receipt printer only — never used for gap labels.
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

/** Physical sticker height in mm (width is always 50). Wrong height → gap sensor skips a label. */
export type LabelHeightMm = 25 | 28 | 30;

/**
 * How many stickers per USB/spool write.
 * 0 = continuous (all copies in one job) — works on most printers.
 * 3 = batched — only for heads that cut/drift after a few stickers in one job.
 */
export type LabelBatchSize = 0 | 3;

/**
 * Gap-label / barcode sticker printer — stored separately from billing.
 */
export interface LabelPrinterSettings {
  type: PrinterType;
  /** Sticker height for the loaded roll (50×30 / 50×28 / 50×25). */
  labelHeightMm?: LabelHeightMm;
  /** 0 = continuous (default). 3 = batch for picky gap printers (e.g. Seznik). */
  labelBatchSize?: LabelBatchSize;
  /** Remember Continuous vs Batched per Windows printer queue name. */
  labelBatchByPrinter?: Record<string, LabelBatchSize>;
  bluetoothAddress?: string;
  bluetoothName?: string;
  systemPrinterName?: string;
  networkHost?: string;
  networkPort?: number;
}

/** Heuristic when a printer is first selected (user can still override). */
export function suggestLabelBatchSize(printerName: string): LabelBatchSize {
  const n = String(printerName || '').toLowerCase();
  // Seznik / Sezink-class heads only keep ~3 stickers of ESC/POS in the buffer.
  if (/sez?n[iy]?k|sezenik/.test(n)) return 3;
  // Poshiflow and similar handle a full continuous job.
  if (/poshi|poshiflow/.test(n)) return 0;
  return 0;
}

export function resolveLabelBatchSize(
  settings: LabelPrinterSettings,
  printerName?: string | null,
): LabelBatchSize {
  const key = String(printerName || settings.systemPrinterName || '').trim();
  if (key && settings.labelBatchByPrinter && key in settings.labelBatchByPrinter) {
    return normalizeLabelBatchSize(settings.labelBatchByPrinter[key]);
  }
  if (settings.labelBatchSize === 3) return 3;
  if (key) return suggestLabelBatchSize(key);
  return 0;
}

const BILLING_KEY = 'billing_printer_settings';
const LABEL_KEY = 'label_printer_settings';

export const IS_DESKTOP = Platform.OS === 'web';

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  type: IS_DESKTOP ? 'system' : 'bluetooth',
  // Web/desktop defaults to 80mm (common POS roll); phones default 58mm Bluetooth rolls.
  paperSize: IS_DESKTOP ? '80' : '58',
};

export const DEFAULT_LABEL_PRINTER_SETTINGS: LabelPrinterSettings = {
  type: IS_DESKTOP ? 'system' : 'bluetooth',
  labelHeightMm: 28,
  labelBatchSize: 0,
};

function normalizeLabelHeightMm(value: unknown): LabelHeightMm {
  if (value === 25 || value === 30) return value;
  return 28;
}

export function normalizeLabelBatchSize(value: unknown): LabelBatchSize {
  return value === 3 ? 3 : 0;
}

function normalizeLabelBatchByPrinter(value: unknown): Record<string, LabelBatchSize> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const out: Record<string, LabelBatchSize> = {};
  for (const [key, batch] of Object.entries(value as Record<string, unknown>)) {
    const name = String(key || '').trim();
    if (!name) continue;
    out[name] = normalizeLabelBatchSize(batch);
  }
  return Object.keys(out).length ? out : undefined;
}

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

function normalizeLabelPrinterSettings(raw: string | null): LabelPrinterSettings {
  if (!raw) return { ...DEFAULT_LABEL_PRINTER_SETTINGS };
  const stored = { ...DEFAULT_LABEL_PRINTER_SETTINGS, ...JSON.parse(raw) } as LabelPrinterSettings & {
    type?: PrinterType | 'a4';
    paperSize?: PaperSize;
  };
  const type: PrinterType = stored.type === 'a4' ? 'system' : stored.type || DEFAULT_LABEL_PRINTER_SETTINGS.type;
  const saved: LabelPrinterSettings = {
    type: !IS_DESKTOP && type === 'system' ? 'bluetooth' : type,
    labelHeightMm: normalizeLabelHeightMm(stored.labelHeightMm),
    labelBatchSize: normalizeLabelBatchSize(stored.labelBatchSize),
    labelBatchByPrinter: normalizeLabelBatchByPrinter(stored.labelBatchByPrinter),
    bluetoothAddress: stored.bluetoothAddress,
    bluetoothName: stored.bluetoothName,
    systemPrinterName: stored.systemPrinterName,
    networkHost: stored.networkHost,
    networkPort: stored.networkPort === 9100 ? undefined : stored.networkPort,
  };
  return saved;
}

/** Billing / receipt printer (bills, test print). Independent of label printer. */
export async function getPrinterSettings(): Promise<PrinterSettings> {
  return normalizePrinterSettings(await AsyncStorage.getItem(BILLING_KEY));
}

export async function savePrinterSettings(settings: PrinterSettings): Promise<void> {
  await AsyncStorage.setItem(BILLING_KEY, JSON.stringify(settings));
}

/** Gap-label / barcode sticker printer. Independent of billing printer. */
export async function getLabelPrinterSettings(): Promise<LabelPrinterSettings> {
  return normalizeLabelPrinterSettings(await AsyncStorage.getItem(LABEL_KEY));
}

export async function saveLabelPrinterSettings(settings: LabelPrinterSettings): Promise<void> {
  await AsyncStorage.setItem(LABEL_KEY, JSON.stringify(settings));
}
