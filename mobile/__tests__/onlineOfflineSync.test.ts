import {
  useConnectivityStore,
  isOfflineNow,
} from '../src/offline/connectivityStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  multiGet: jest.fn(() => Promise.resolve([['kds_auto_sync_enabled', null], ['kds_manual_offline', null]])),
}));

jest.mock('../src/offline/capability', () => ({
  isDesktopOfflineCapable: jest.fn(() => true),
}));

describe('Online/Offline and manual sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useConnectivityStore.setState({
      online: true,
      manualOffline: false,
      pendingCount: 0,
      syncing: false,
      lastSyncError: '',
      lastSyncAt: null,
    });
    Object.defineProperty(global, 'navigator', {
      value: { onLine: true },
      writable: true,
      configurable: true,
    });
  });

  it('updates online state correctly when toggled to offline and online', () => {
    expect(useConnectivityStore.getState().online).toBe(true);
    expect(isOfflineNow()).toBe(false);

    // Switch to offline
    useConnectivityStore.getState().setManualOffline(true);
    useConnectivityStore.getState().setOnline(false);

    expect(useConnectivityStore.getState().online).toBe(false);
    expect(useConnectivityStore.getState().manualOffline).toBe(true);
    expect(isOfflineNow()).toBe(true);

    // Switch back to online
    useConnectivityStore.getState().setManualOffline(false);
    useConnectivityStore.getState().setOnline(true);

    expect(useConnectivityStore.getState().online).toBe(true);
    expect(useConnectivityStore.getState().manualOffline).toBe(false);
    expect(isOfflineNow()).toBe(false);
  });

  it('recognizes isOfflineNow when physical network is disconnected', () => {
    useConnectivityStore.setState({ online: true });
    Object.defineProperty(global, 'navigator', {
      value: { onLine: false },
      writable: true,
      configurable: true,
    });

    expect(isOfflineNow()).toBe(true);
  });
});
