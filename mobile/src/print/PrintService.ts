import { NativeModules, Platform } from 'react-native';
import {
  buildEscPosBytes,
  bytesToBase64,
  delay,
  estimatePrintFlushMs,
  sanitizeEscPosText,
  toPlainReceipt,
} from './escpos';
import { hasDevanagari } from './indicText';

export { buildEscPosBytes, sanitizeEscPosText, toPlainReceipt } from './escpos';
export type { ThermalPrintPayload } from './escpos';

export interface BluetoothDevice {
  device_name?: string;
  deviceName?: string;
  inner_mac_address?: string;
  macAddress?: string;
}

let BLEPrinter: {
  init: () => Promise<void>;
  getDeviceList: () => Promise<BluetoothDevice[]>;
  connectPrinter: (address: string) => Promise<void>;
  closeConn: () => Promise<void>;
} | null = null;

let NetPrinter: {
  init: () => Promise<void>;
  connectPrinter: (host: string, port: number) => Promise<void>;
  closeConn: () => Promise<void>;
} | null = null;

try {
  const mod = require('react-native-thermal-receipt-printer');
  BLEPrinter = mod.BLEPrinter;
  NetPrinter = mod.NetPrinter;
} catch {
  // Native module not linked yet
}

/** Keep BT socket open — reconnecting makes many printers spit blank paper first */
let bleConnectedAddress: string | null = null;
let netConnectedKey: string | null = null;

function decodeBase64(value: string): number[] {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = value.replace(/=+$/, '');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const v = alphabet.indexOf(clean[i]);
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return out;
}

/** Android has no canvas. Marathi lines are drawn by the native receipt raster. */
async function receiptBytes(plainOrMarkup: string, charsPerLine: number): Promise<number[]> {
  const plain = toPlainReceipt(plainOrMarkup, charsPerLine);
  const native = NativeModules.KdsLabelPrinter as
    | { encodeReceipt?: (text: string, cols: number) => Promise<string> }
    | undefined;
  if (Platform.OS === 'android' && hasDevanagari(plain) && native?.encodeReceipt) {
    const encoded = await native.encodeReceipt(plain, charsPerLine);
    const bytes = decodeBase64(String(encoded || ''));
    if (bytes.length) return bytes;
  }
  return buildEscPosBytes(plainOrMarkup, charsPerLine);
}

async function printPayload(
  moduleName: 'RNBLEPrinter' | 'RNNetPrinter',
  plainOrMarkup: string,
  charsPerLine = 32,
): Promise<void> {
  const bytes = await receiptBytes(plainOrMarkup, charsPerLine);
  if (!bytes.length) throw new Error('Nothing to print.');
  await printRawBase64(moduleName, bytesToBase64(bytes));
}

function printRawBase64(moduleName: 'RNBLEPrinter' | 'RNNetPrinter', base64: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const mod = NativeModules[moduleName];
    if (!mod?.printRawData) {
      reject(new Error('Printer raw API not available. Rebuild the app.'));
      return;
    }
    try {
      mod.printRawData(base64, (error: string) => {
        if (error) reject(new Error(String(error)));
      });
      resolve();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

async function ensureBleConnected(address: string): Promise<void> {
  if (!BLEPrinter) throw new Error('Bluetooth printer not available. Rebuild the app.');
  await BLEPrinter.init();
  if (bleConnectedAddress === address) return;
  if (bleConnectedAddress) {
    try {
      await BLEPrinter.closeConn();
    } catch {
      // ignore
    }
    bleConnectedAddress = null;
  }
  await BLEPrinter.connectPrinter(address);
  bleConnectedAddress = address;
}

async function ensureNetConnected(host: string, port: number): Promise<void> {
  if (!NetPrinter) throw new Error('Network printer not available. Rebuild the app.');
  const key = `${host}:${port}`;
  await NetPrinter.init();
  if (netConnectedKey === key) return;
  if (netConnectedKey) {
    try {
      await NetPrinter.closeConn();
    } catch {
      // ignore
    }
    netConnectedKey = null;
  }
  await NetPrinter.connectPrinter(host, port);
  netConnectedKey = key;
}

export async function isBluetoothAvailable(): Promise<boolean> {
  return Boolean(getIosBle() || BLEPrinter);
}

export async function scanBluetoothPrinters(): Promise<Array<{ name: string; address: string }>> {
  const iosBle = getIosBle();
  if (iosBle) return iosBle.scan(6000);
  if (!BLEPrinter) throw new Error('Bluetooth printer module not available. Rebuild the app.');
  await BLEPrinter.init();
  const devices = await BLEPrinter.getDeviceList();
  return devices
    .map((d) => ({
      name: d.device_name || d.deviceName || 'Unknown',
      address: d.inner_mac_address || d.macAddress || '',
    }))
    .filter((d) => d.address);
}

/**
 * Print thermal receipt as sharp plain text (no bold / double-size).
 */
export async function printViaBluetooth(
  address: string,
  text: string,
  charsPerLine = 32
): Promise<void> {
  if (!address?.trim()) throw new Error('No Bluetooth printer selected.');

  const source = String(text || '').trim();
  if (!source) throw new Error('Nothing to print.');

  const payload = sanitizeEscPosText(source);
  if (!payload.trim()) throw new Error('Nothing to print.');

  const iosBle = getIosBle();
  if (iosBle) {
    const bytes = buildEscPosBytes(payload, charsPerLine);
    if (!bytes.length) throw new Error('Nothing to print.');
    await iosBle.print(address, bytesToBase64(bytes));
    return;
  }

  await ensureBleConnected(address);
  await printPayload('RNBLEPrinter', payload, charsPerLine);
  await delay(estimatePrintFlushMs(payload));
}

export async function printViaNetwork(
  host: string,
  port: number,
  text: string,
  charsPerLine = 32
): Promise<void> {
  if (!host?.trim()) throw new Error('No network printer IP configured.');

  const source = String(text || '').trim();
  if (!source) throw new Error('Nothing to print.');

  const payload = sanitizeEscPosText(source);
  if (!payload.trim()) throw new Error('Nothing to print.');

  const iosNet = getIosNet();
  if (iosNet) {
    const bytes = buildEscPosBytes(payload, charsPerLine);
    if (!bytes.length) throw new Error('Nothing to print.');
    await iosNet.printRaw(host.trim(), port, bytesToBase64(bytes));
    return;
  }

  await ensureNetConnected(host, port);
  await printPayload('RNNetPrinter', payload, charsPerLine);
  await delay(estimatePrintFlushMs(payload));
}

/** Sends ready-made ESC/POS commands to a Bluetooth printer. */
export async function printBytesViaBluetooth(address: string, bytes: number[]): Promise<void> {
  if (!address?.trim()) throw new Error('No Bluetooth printer selected.');
  if (!bytes.length) throw new Error('Nothing to print.');
  const iosBle = getIosBle();
  if (iosBle) {
    await iosBle.print(address, bytesToBase64(bytes));
    return;
  }
  await ensureBleConnected(address);
  await printRawBase64('RNBLEPrinter', bytesToBase64(bytes));
  await delay(Math.min(8000, 700 + bytes.length / 4));
}

/** Sends ready-made ESC/POS commands to a Wi-Fi / LAN printer. */
export async function printBytesViaNetwork(host: string, port: number, bytes: number[]): Promise<void> {
  if (!host?.trim()) throw new Error('No network printer IP configured.');
  if (!bytes.length) throw new Error('Nothing to print.');
  const iosNet = getIosNet();
  if (iosNet) {
    await iosNet.printRaw(host.trim(), port, bytesToBase64(bytes));
    return;
  }
  await ensureNetConnected(host, port);
  await printRawBase64('RNNetPrinter', bytesToBase64(bytes));
  await delay(Math.min(8000, 700 + bytes.length / 4));
}

interface BleModule {
  scan: (timeoutMs: number) => Promise<Array<{ name: string; address: string }>>;
  print: (address: string, base64: string) => Promise<void>;
}

function getIosBle(): BleModule | undefined {
  if (Platform.OS !== 'ios') return undefined;
  return NativeModules.KdsBlePrinter as BleModule | undefined;
}

/** iOS raw TCP sender; the thermal library's iOS network module prints text only and ignores the port. */
interface NetModule {
  printRaw: (host: string, port: number, base64: string) => Promise<void>;
}

function getIosNet(): NetModule | undefined {
  if (Platform.OS !== 'ios') return undefined;
  const mod = NativeModules.KdsNetPrinter as NetModule | undefined;
  if (!mod?.printRaw) throw new Error('Network printing is not available. Rebuild the app.');
  return mod;
}

export async function printBytesViaSystem(_printerName: string, _bytes: number[]): Promise<void> {
  throw new Error('A system printer needs the desktop app. On a phone, choose Bluetooth or Wi-Fi in Printer Settings.');
}

export async function printViaA4(_html: string, _title: string, _target?: { printerName?: string }): Promise<void> {
  throw new Error('A4 printing is available in the desktop app. On phones, use a Bluetooth or network printer.');
}

export async function listSystemPrinters(): Promise<Array<{ name: string; displayName: string; isDefault: boolean }>> {
  return [];
}

export async function printViaSystem(
  _printerName: string,
  _text: string,
  _charsPerLine = 32,
  _paper?: '58' | '80',
): Promise<void> {
  throw new Error('Installed system printers are only available in the desktop app.');
}
