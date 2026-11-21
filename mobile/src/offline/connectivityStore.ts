import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { isDesktopOfflineCapable } from './capability';

export const AUTO_SYNC_STORAGE_KEY = 'kds_auto_sync_enabled';
export const MANUAL_OFFLINE_STORAGE_KEY = 'kds_manual_offline';

export type ConnectivityState = {
  online: boolean;
  manualOffline: boolean;
  autoSync: boolean;
  pendingCount: number;
  syncing: boolean;
  lastSyncError: string;
  lastSyncAt: string | null;
  setOnline: (online: boolean) => void;
  setManualOffline: (manualOffline: boolean) => void;
  setAutoSync: (autoSync: boolean) => void;
  setPendingCount: (count: number) => void;
  setSyncing: (syncing: boolean) => void;
  setLastSyncError: (message: string) => void;
  setLastSyncAt: (lastSyncAt: string | null) => void;
};

export const useConnectivityStore = create<ConnectivityState>((set) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  manualOffline: false,
  autoSync: false,
  pendingCount: 0,
  syncing: false,
  lastSyncError: '',
  lastSyncAt: null,
  setOnline: (online) => set({ online }),
  setManualOffline: (manualOffline) => {
    set({ manualOffline });
    void AsyncStorage.setItem(MANUAL_OFFLINE_STORAGE_KEY, manualOffline ? '1' : '0').catch(() => {});
  },
  setAutoSync: (autoSync) => {
    set({ autoSync });
    void AsyncStorage.setItem(AUTO_SYNC_STORAGE_KEY, autoSync ? '1' : '0').catch(() => {});
    if (isDesktopOfflineCapable()) {
      void import('./sqliteApi')
        .then(({ sqliteSetMeta }) => sqliteSetMeta('auto_sync_enabled', autoSync ? '1' : '0'))
        .catch(() => {});
    }
  },
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setSyncing: (syncing) => set({ syncing }),
  setLastSyncError: (lastSyncError) => set({ lastSyncError }),
  setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),
}));

let hydrating = false;
let hydrated = false;

type AutoSyncRunner = () => Promise<any>;
let autoSyncRunner: AutoSyncRunner | null = null;

export function registerAutoSyncRunner(runner: AutoSyncRunner) {
  autoSyncRunner = runner;
}

export async function initConnectivitySettings(): Promise<void> {
  if (hydrated || hydrating) return;
  hydrating = true;
  try {
    const [storedAutoSync, storedManual] = await AsyncStorage.multiGet([
      AUTO_SYNC_STORAGE_KEY,
      MANUAL_OFFLINE_STORAGE_KEY,
    ]);
    const isManualOffline = storedManual?.[1] === '1';
    let isAutoSync = storedAutoSync?.[1] === '1';

    if (isDesktopOfflineCapable()) {
      try {
        const { sqliteGetMeta } = await import('./sqliteApi');
        const metaAuto = await sqliteGetMeta('auto_sync_enabled');
        if (metaAuto != null) {
          isAutoSync = metaAuto === '1';
        }
      } catch {}
    }

    const isNavigatorOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
    const finalOnline = isManualOffline ? false : isNavigatorOnline;

    useConnectivityStore.setState({
      autoSync: isAutoSync,
      manualOffline: isManualOffline,
      online: finalOnline,
    });
    hydrated = true;
  } catch {
  } finally {
    hydrating = false;
  }
}

// Auto-hydrate settings on module load
void initConnectivitySettings();

/**
 * Triggers two-way sync from local to live when online and desktop offline capable.
 */
export async function triggerAutoSync(): Promise<any> {
  const store = useConnectivityStore.getState();
  if (store.syncing) return null;
  if (!store.online) return null;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  if (!isDesktopOfflineCapable()) return null;

  if (autoSyncRunner) {
    return await autoSyncRunner();
  }

  try {
    const { syncNow } = await import('./syncEngine');
    return await syncNow();
  } catch (err) {
    console.error('[KDSPOZ] triggerAutoSync failed:', err);
    return null;
  }
}

/** Start listening for online/offline. No-op outside desktop. */
export function startConnectivityMonitor(): () => void {
  void initConnectivitySettings();
  if (!isDesktopOfflineCapable() || typeof window === 'undefined') return () => {};

  const onOnline = () => {
    const state = useConnectivityStore.getState();
    if (state.manualOffline) return;
    const wasOffline = !state.online;
    state.setOnline(true);
    if (wasOffline && state.autoSync) {
      void triggerAutoSync();
    }
  };

  const onOffline = () => {
    useConnectivityStore.getState().setOnline(false);
  };

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}

export function isOfflineNow(): boolean {
  if (!isDesktopOfflineCapable()) return false;
  return !useConnectivityStore.getState().online || (typeof navigator !== 'undefined' && !navigator.onLine);
}
