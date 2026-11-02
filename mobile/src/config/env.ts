import { Platform } from 'react-native';
import { DEV_MACHINE_LAN_IP } from './dev-host.generated';
import { USE_PRODUCTION_API_IN_DEV } from './devApiTarget';
import { isEmulator } from '../utils/device';

/** Set by webpack for browser builds (`--env webApi=...`); undefined under Metro. */
declare const __WEB_API_URL__: string | null | undefined;

const API_PORT = 3000;
const API_PATH = '/api/v1';

function buildApiUrl(host: string): string {
  return `http://${host}:${API_PORT}${API_PATH}`;
}

function resolveDevelopmentApiUrl(): string {
  if (Platform.OS === 'web') {
    // Same origin as the webpack dev server. It proxies /api and /uploads,
    // so the browser is not blocked by the API's CORS list.
    return API_PATH;
  }

  if (isEmulator()) {
    // Android emulator → host loopback. Prefer 10.0.2.2; adb reverse also maps localhost:3000.
    if (Platform.OS === 'android') {
      return buildApiUrl('10.0.2.2');
    }
    return buildApiUrl('localhost');
  }

  // Physical phone/tablet on same Wi-Fi → developer machine LAN IP
  return buildApiUrl(DEV_MACHINE_LAN_IP);
}

/** Production API — same for every tenant / shop */
export const PRODUCTION_API_URL = 'https://khisedigital.info/kdspozr/api/v1';

const WEB_API_URL = typeof __WEB_API_URL__ === 'string' ? __WEB_API_URL__ : null;

export const DEFAULT_API_URL =
  WEB_API_URL ??
  (__DEV__ && (Platform.OS === 'web' || !USE_PRODUCTION_API_IN_DEV)
    ? resolveDevelopmentApiUrl()
    : PRODUCTION_API_URL);
