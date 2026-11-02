import { Platform } from 'react-native';

type AndroidConstants = {
  Brand?: string;
  Model?: string;
  Manufacturer?: string;
  Fingerprint?: string;
};

type IosConstants = {
  simulator?: boolean;
};

export function isEmulator(): boolean {
  if (Platform.OS === 'android') {
    const c = Platform.constants as AndroidConstants & { Product?: string; Brand?: string };
    const model = (c.Model || '').toLowerCase();
    const fingerprint = (c.Fingerprint || '').toLowerCase();
    const product = (c.Product || '').toLowerCase();
    const brand = (c.Brand || '').toLowerCase();
    const manufacturer = (c.Manufacturer || '').toLowerCase();

    return (
      model.includes('sdk_gphone') ||
      model.includes('sdk_gphone16k') ||
      model.includes('emulator') ||
      model.includes('android sdk built for') ||
      model === 'google_sdk' ||
      product.includes('sdk') ||
      product.includes('emulator') ||
      fingerprint.includes('generic') ||
      fingerprint.includes('vbox') ||
      fingerprint.includes('emulator') ||
      brand === 'google' && model.includes('sdk') ||
      manufacturer === 'genymotion'
    );
  }

  if (Platform.OS === 'ios') {
    const c = Platform.constants as IosConstants;
    return c.simulator === true;
  }

  return false;
}
