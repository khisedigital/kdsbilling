// Webpack aliases `react-native` to this file for desktop/web builds.
export * from 'react-native-web';
export { Alert } from './alert';

// Android-only APIs are not in react-native-web; stub so imports resolve.
// Call sites already gate on Platform.OS === 'android', so these never run on web.
const DENIED = 'denied';
export const PermissionsAndroid = {
  PERMISSIONS: {
    BLUETOOTH_SCAN: 'android.permission.BLUETOOTH_SCAN',
    BLUETOOTH_CONNECT: 'android.permission.BLUETOOTH_CONNECT',
    ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION',
  },
  RESULTS: {
    GRANTED: 'granted',
    DENIED,
    NEVER_ASK_AGAIN: 'never_ask_again',
  },
  async request() {
    return DENIED;
  },
  async requestMultiple(permissions) {
    return Object.fromEntries(permissions.map((p) => [p, DENIED]));
  },
  async check() {
    return false;
  },
};
