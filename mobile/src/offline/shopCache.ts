import type { ShopSettings } from '../services/shopSettingsService';
import { isDesktopOfflineCapable } from './capability';
import { isOfflineNow } from './connectivityStore';
import { offlineRead, offlineWrite } from './storage';
import { hasSqliteBridge, sqliteReadShopSettings, sqliteSaveShopSettings } from './sqliteApi';

const KEY = 'shop-settings';

/** Hot memory copy so Print never waits on the network after the first load. */
let memoryShop: ShopSettings | null = null;

export async function cacheShopSettings(settings: ShopSettings): Promise<void> {
  memoryShop = settings;
  if (!isDesktopOfflineCapable()) return;
  if (hasSqliteBridge()) {
    await sqliteSaveShopSettings(settings).catch(() => null);
  }
  await offlineWrite(KEY, settings);
}

export async function readCachedShopSettings(): Promise<ShopSettings | null> {
  if (memoryShop) return memoryShop;
  if (!isDesktopOfflineCapable()) return null;
  if (hasSqliteBridge()) {
    const fromSql = await sqliteReadShopSettings<ShopSettings>().catch(() => null);
    if (fromSql) {
      memoryShop = fromSql;
      return fromSql;
    }
  }
  const disk = await offlineRead<ShopSettings>(KEY);
  if (disk) memoryShop = disk;
  return disk;
}

/**
 * Receipt path: return cached shop immediately; refresh API in the background.
 * Waiting on /shop-settings every Print made the 2nd+ slip feel 10s+ late.
 */
export async function getShopSettingsForPrint(): Promise<ShopSettings | null> {
  const cached = await readCachedShopSettings();
  if (cached) {
    if (!isOfflineNow()) {
      void import('../services/shopSettingsService')
        .then(({ getShopSettings }) => getShopSettings())
        .catch(() => null);
    }
    return cached;
  }
  if (isOfflineNow()) return null;
  try {
    const { getShopSettings } = await import('../services/shopSettingsService');
    return await getShopSettings();
  } catch {
    return readCachedShopSettings();
  }
}
