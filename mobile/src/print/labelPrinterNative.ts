import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type { GapLabelContent } from './gapLabel';

type ListedPrinter = { name: string; address: string };

type NativeLabelPrinter = {
  isAvailable: () => Promise<boolean>;
  listPrinters: () => Promise<ListedPrinter[]>;
  connect: (address: string) => Promise<{ connected: boolean; name?: string; address?: string }>;
  getStatus: () => Promise<{ connected: boolean; name?: string; address?: string }>;
  printLabel: (payload: GapLabelContent & { heightMm?: 25 | 28 | 30 }, copies: number) => Promise<void>;
  calibrate: () => Promise<void>;
  pullIn: () => Promise<void>;
  disconnect: () => Promise<void>;
};

const native = NativeModules.KdsLabelPrinter as NativeLabelPrinter | undefined;

const SDK_ONLY =
  'Gap-label printing needs the Android app with the Microlan SDK.';

/** True when the Microlan sdk2 native bridge is linked (Android build with sdk2.aar). */
export function isNativeLabelPrinterAvailable(): boolean {
  return Platform.OS === 'android' && Boolean(native?.listPrinters && native?.printLabel);
}

async function ensureBluetoothPermission(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (Platform.Version >= 31) {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    const scanOk = result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED;
    const connectOk =
      result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED;
    if (!scanOk || !connectOk) {
      throw new Error('Bluetooth permission is required to find the printer.');
    }
    return;
  }
  const fine = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  if (fine !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('Location permission is required to find Bluetooth printers on this Android version.');
  }
}

export async function listNativeLabelPrinters(): Promise<ListedPrinter[]> {
  if (!native?.listPrinters) throw new Error(SDK_ONLY);
  await ensureBluetoothPermission();
  return (await native.listPrinters()) || [];
}

export async function connectNativeLabelPrinter(address: string): Promise<{
  connected: boolean;
  name?: string;
  address?: string;
}> {
  if (!native?.connect) throw new Error(SDK_ONLY);
  await ensureBluetoothPermission();
  return native.connect(address);
}

export async function getNativeLabelPrinterStatus(): Promise<{
  connected: boolean;
  name?: string;
  address?: string;
}> {
  if (!native?.getStatus) return { connected: false };
  return native.getStatus();
}

export async function printNativeGapLabel(
  label: GapLabelContent,
  copies: number,
  heightMm: 25 | 28 | 30 = 28,
): Promise<void> {
  if (!native?.printLabel) throw new Error(SDK_ONLY);
  await ensureBluetoothPermission();
  await native.printLabel({ ...label, heightMm }, copies);
}

/** Gap / black-mark form-feed calibrate (same as SDKDemoApk). */
export async function calibrateNativeLabelPrinter(): Promise<void> {
  if (!native?.calibrate) throw new Error(SDK_ONLY);
  await ensureBluetoothPermission();
  await native.calibrate();
}

/** Advance one label via form-feed. */
export async function pullInNativeLabelPrinter(): Promise<void> {
  if (!native?.pullIn) throw new Error(SDK_ONLY);
  await ensureBluetoothPermission();
  await native.pullIn();
}
