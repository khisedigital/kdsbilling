import {
  useConnectivityStore,
  isOfflineNow,
  AUTO_SYNC_STORAGE_KEY,
  MANUAL_OFFLINE_STORAGE_KEY,
  triggerAutoSync,
  registerAutoSyncRunner,
} from '../src/offline/connectivityStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  multiGet: jest.fn(() => Promise.resolve([['kds_auto_sync_enabled', null], ['kds_manual_offline', null]])),
}));

jest.mock('../src/offline/capability', () => ({
  isDesktopOfflineCapable: jest.fn(() => true),
}));

const mockSyncNow = jest.fn(() => Promise.resolve({ synced: 2, failed: 0 }));
registerAutoSyncRunner(mockSyncNow);

describe('Online/Offline and Auto-sync functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useConnectivityStore.setState({
      online: true,
      manualOffline: false,
      autoSync: false,
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

  it('updates autoSync setting correctly', () => {
    expect(useConnectivityStore.getState().autoSync).toBe(false);

    useConnectivityStore.getState().setAutoSync(true);
    expect(useConnectivityStore.getState().autoSync).toBe(true);

    useConnectivityStore.getState().setAutoSync(false);
    expect(useConnectivityStore.getState().autoSync).toBe(false);
  });

  it('triggers auto-sync when enabled and online', async () => {
    useConnectivityStore.setState({ online: true, autoSync: true, syncing: false });

    const result = await triggerAutoSync();
    expect(mockSyncNow).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ synced: 2, failed: 0 });
  });

  it('does NOT trigger auto-sync when offline', async () => {
    useConnectivityStore.setState({ online: false, autoSync: true, syncing: false });

    const result = await triggerAutoSync();
    expect(mockSyncNow).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('does NOT trigger auto-sync when navigator.onLine is false', async () => {
    Object.defineProperty(global, 'navigator', {
      value: { onLine: false },
      writable: true,
      configurable: true,
    });
    useConnectivityStore.setState({ online: true, autoSync: true, syncing: false });

    const result = await triggerAutoSync();
    expect(mockSyncNow).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('does NOT trigger auto-sync when already syncing', async () => {
    useConnectivityStore.setState({ online: true, autoSync: true, syncing: true });

    const result = await triggerAutoSync();
    expect(mockSyncNow).not.toHaveBeenCalled();
    expect(result).toBeNull();
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
