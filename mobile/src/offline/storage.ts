import { getDesktopBridge } from '../desktop/bridge';
import { useAuthStore } from '../store/authStore';
import { isDesktopOfflineCapable } from './capability';

function shopCode(): string {
  return useAuthStore.getState().savedLogin?.shopCode
    || useAuthStore.getState().tenant?.slug
    || 'default';
}

export async function offlineRead<T>(key: string): Promise<T | null> {
  if (!isDesktopOfflineCapable()) return null;
  const bridge = getDesktopBridge();
  const result = await bridge!.offlineRead!({ shopCode: shopCode(), key });
  return (result?.value as T) ?? null;
}

export async function offlineWrite(key: string, value: unknown): Promise<void> {
  if (!isDesktopOfflineCapable()) return;
  const bridge = getDesktopBridge();
  await bridge!.offlineWrite!({ shopCode: shopCode(), key, value });
}

export async function offlineRemove(key: string): Promise<void> {
  if (!isDesktopOfflineCapable()) return;
  const bridge = getDesktopBridge();
  await bridge!.offlineRemove!({ shopCode: shopCode(), key });
}

export async function offlineList(prefix = ''): Promise<string[]> {
  if (!isDesktopOfflineCapable()) return [];
  const bridge = getDesktopBridge();
  const result = await bridge!.offlineList!({ shopCode: shopCode(), prefix });
  return result?.keys || [];
}
