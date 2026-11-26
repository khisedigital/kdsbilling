import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { isDesktopOfflineCapable } from './capability';

export const MANUAL_OFFLINE_STORAGE_KEY = 'kds_manual_offline';

export type ConnectivityState = {
  online: boolean;
  manualOffline: boolean;
  pendingCount: number;
  syncing: boolean;
  lastSyncError: string;
  lastSyncAt: string | null;
  setOnline: (online: boolean) => void;
  setManualOffline: (manualOffline: boolean) => void;
  setPendingCount: (count: number) => void;
  setSyncing: (syncing: boolean) => void;
  setLastSyncError: (message: string) => void;
  setLastSyncAt: (lastSyncAt: string | null) => void;
};

export const useConnectivityStore = create<ConnectivityState>((set) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  manualOffline: false,
  pendingCount: 0,
  syncing: false,
  lastSyncError: '',
  lastSyncAt: null,
  setOnline: (online) => set({ online }),
  setManualOffline: (manualOffline) => {
    set({ manualOffline });
    void AsyncStorage.setItem(MANUAL_OFFLINE_STORAGE_KEY, manualOffline ? '1' : '0').catch(() => {});
  },
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setSyncing: (syncing) => set({ syncing }),
  setLastSyncError: (lastSyncError) => set({ lastSyncError }),
  setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),
}));

let hydrating = false;
let hydrated = false;

export async function initConnectivitySettings(): Promise<void> {
  if (hydrated || hydrating) return;
  hydrating = true;
  try {
    const storedManual = await AsyncStorage.getItem(MANUAL_OFFLINE_STORAGE_KEY);
    const isManualOffline = storedManual === '1';

    const isNavigatorOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
    const finalOnline = isManualOffline ? false : isNavigatorOnline;

    useConnectivityStore.setState({
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

/** Start listening for online/offline. No-op outside desktop. */
export function startConnectivityMonitor(): () => void {
  void initConnectivitySettings();
  if (!isDesktopOfflineCapable() || typeof window === 'undefined') return () => {};

  const onOnline = () => {
    const state = useConnectivityStore.getState();
    if (state.manualOffline) return;
    state.setOnline(true);
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
