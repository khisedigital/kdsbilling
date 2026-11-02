import api from './api';
import { getCachedApiUrl } from '../config/api';

export interface ShopSettings {
  shopName: string;
  shopCode: string;
  address: string;
  city: string;
  gstin: string;
  phone: string;
  billFooter: string;
  logoUrl: string | null;
  branchId: string | null;
  branchName: string | null;
}

export type ShopSettingsUpdate = Partial<{
  shopName: string;
  address: string;
  city: string;
  gstin: string;
  phone: string;
  billFooter: string;
}>;

/** Resolve relative /uploads/... URLs against the API host (without /api/v1). */
export function resolveUploadUrl(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const apiBase = getCachedApiUrl().replace(/\/api\/v1\/?$/, '');
  return pathOrUrl.startsWith('/') ? `${apiBase}${pathOrUrl}` : `${apiBase}/${pathOrUrl}`;
}

export async function getShopSettings(): Promise<ShopSettings> {
  const { data } = await api.get('/shop-settings');
  return data.data;
}

export async function updateShopSettings(payload: ShopSettingsUpdate): Promise<ShopSettings> {
  const { data } = await api.patch('/shop-settings', payload);
  return data.data;
}

export async function uploadShopLogo(
  uri: string,
  fileName = 'logo.jpg',
  type = 'image/jpeg',
  file?: Blob,
): Promise<ShopSettings> {
  const form = new FormData();
  if (file) {
    form.append('image', file);
  } else {
    form.append('image', {
      uri,
      name: fileName,
      type,
    } as unknown as Blob);
  }

  const { data } = await api.post('/shop-settings/logo', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    transformRequest: [(body) => body],
    timeout: 60000,
  });
  return data.data;
}

export async function removeShopLogo(): Promise<ShopSettings> {
  const { data } = await api.delete('/shop-settings/logo');
  return data.data;
}
