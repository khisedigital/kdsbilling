import { create } from 'zustand';
import { isDesktopOfflineCapable } from './capability';

type ConnectivityState = {
  online: boolean;
  pendingCount: number;
  syncing: boolean;
  lastSyncError: string;
  lastSyncAt: string | null;
  setOnline: (online: boolean) => void;
  setPendingCount: (count: number) => void;
  setSyncing: (syncing: boolean) => void;
  setLastSyncError: (message: string) => void;
  setLastSyncAt: (lastSyncAt: string | null) => void;
};

export const useConnectivityStore = create<ConnectivityState>((set) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  pendingCount: 0,
  syncing: false,
  lastSyncError: '',
  lastSyncAt: null,
  setOnline: (online) => set({ online }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setSyncing: (syncing) => set({ syncing }),
  setLastSyncError: (lastSyncError) => set({ lastSyncError }),
  setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),
}));

/** Start listening for online/offline. No-op outside desktop. */
export function startConnectivityMonitor(): () => void {
  if (!isDesktopOfflineCapable() || typeof window === 'undefined') return () => {};

  const update = () => useConnectivityStore.getState().setOnline(navigator.onLine);
  update();
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  return () => {
    window.removeEventListener('online', update);
    window.removeEventListener('offline', update);
  };
}

export function isOfflineNow(): boolean {
  if (!isDesktopOfflineCapable()) return false;
  return !useConnectivityStore.getState().online || (typeof navigator !== 'undefined' && !navigator.onLine);
}
