import { getDesktopBridge } from '../desktop/bridge';

/** Offline billing is desktop Electron only — not phone, not browser-only web. */
export function isDesktopOfflineCapable(): boolean {
  const bridge = getDesktopBridge();
  if (!bridge?.isDesktop) return false;
  // SQLite local DB (preferred) or legacy JSON file store.
  return Boolean(
    (bridge.sqliteSaveSale && bridge.sqliteListProducts) ||
      (bridge.offlineRead && bridge.offlineWrite),
  );
}
