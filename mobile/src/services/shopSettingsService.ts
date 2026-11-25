import api from './api';
import { getCachedApiUrl } from '../config/api';
import { cacheShopSettings } from '../offline/shopCache';

export interface ShopSettings {
  shopName: string;
  shopNameMr: string;
  shopCode: string;
  address: string;
  addressMr: string;
  city: string;
  gstin: string;
  phone: string;
  billFooter: string;
  logoUrl: string | null;
  branchId: string | null;
  branchName: string | null;
  // Multi-business & registration fields
  businessType?: string;
  businessTypeCustom?: string;
  fssai?: string;
  drugLicense?: string;
  tradeLicense?: string;
  pan?: string;
  tagline?: string;
  taglineMr?: string;
  invoiceTitle?: string;
  invoiceTitleMr?: string;
  terms?: string;
  termsMr?: string;
  state?: string;
  stateCode?: string;
  pincode?: string;
  secondaryPhone?: string;
  email?: string;
  website?: string;
  upiId?: string;
  showGstin?: boolean;
  showFssai?: boolean;
  showDrugLicense?: boolean;
  showTradeLicense?: boolean;
  showPan?: boolean;
  showUpi?: boolean;
  showTerms?: boolean;
  showTagline?: boolean;
  showLogo?: boolean;
  billQrCodeType?: 'none' | 'upi' | 'bill' | 'both';
  enablePaymentQr?: boolean;
  paymentQrUpiId?: string;
  extraSettings?: Record<string, any>;
}

export type ShopSettingsUpdate = Partial<ShopSettings>;

/** Marathi bills and labels use the Marathi name and address when those are filled. */
export function shopTextForBill(
  shop: Partial<ShopSettings> | null | undefined,
  language: 'en' | 'mr',
): { shopName: string; address: string; tagline?: string; invoiceTitle?: string; terms?: string } {
  const shopName = (shop?.shopName || '').trim();
  const address = (shop?.address || '').trim();
  const tagline = (shop?.tagline || '').trim();
  const invoiceTitle = (shop?.invoiceTitle || '').trim();
  const terms = (shop?.terms || '').trim();

  if (language !== 'mr') return { shopName, address, tagline, invoiceTitle, terms };
  return {
    shopName: (shop?.shopNameMr || '').trim() || shopName,
    address: (shop?.addressMr || '').trim() || address,
    tagline: (shop?.taglineMr || '').trim() || tagline,
    invoiceTitle: (shop?.invoiceTitleMr || '').trim() || invoiceTitle,
    terms: (shop?.termsMr || '').trim() || terms,
  };
}

/** Resolve relative /uploads/... URLs against the API host (without /api/v1). */
export function resolveUploadUrl(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const apiBase = getCachedApiUrl().replace(/\/api\/v1\/?$/, '');
  return pathOrUrl.startsWith('/') ? `${apiBase}${pathOrUrl}` : `${apiBase}/${pathOrUrl}`;
}

let memoryShopSettings: ShopSettings | null = null;

export async function getShopSettings(opts?: { forceNetwork?: boolean }): Promise<ShopSettings> {
  if (!opts?.forceNetwork) {
    try {
      const { isFullyLocalMode } = await import('../offline/localApi');
      const { readCachedShopSettings } = await import('../offline/shopCache');
      if (isFullyLocalMode()) {
        const cached = await readCachedShopSettings();
        if (cached) {
          memoryShopSettings = cached;
          return cached;
        }
      }
    } catch {
      /* fall through */
    }
  }
  const { data } = await api.get('/shop-settings');
  const settings = data.data as ShopSettings;
  memoryShopSettings = settings;
  void cacheShopSettings(settings);
  return settings;
}

/** Sync peek for UI that already hydrated shop once. */
export function peekShopSettings(): ShopSettings | null {
  return memoryShopSettings;
}

export async function updateShopSettings(payload: ShopSettingsUpdate): Promise<ShopSettings> {
  try {
    const { isFullyLocalMode, localEnqueueSync } = await import('../offline/localApi');
    const { readCachedShopSettings, cacheShopSettings: cacheLocal } = await import(
      '../offline/shopCache'
    );
    if (isFullyLocalMode()) {
      const prev = (await readCachedShopSettings()) || (memoryShopSettings as ShopSettings) || ({} as ShopSettings);
      const settings = { ...prev, ...payload } as ShopSettings;
      memoryShopSettings = settings;
      await cacheLocal(settings);
      await localEnqueueSync({
        entityType: 'shop_settings',
        entityId: '1',
        op: 'update',
        payload: settings,
      });
      return settings;
    }
  } catch {
    /* fall through */
  }
  const { data } = await api.patch('/shop-settings', payload);
  const settings = data.data as ShopSettings;
  void cacheShopSettings(settings);
  return settings;
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
  const settings = data.data as ShopSettings;
  void cacheShopSettings(settings);
  return settings;
}

export async function removeShopLogo(): Promise<ShopSettings> {
  const { data } = await api.delete('/shop-settings/logo');
  const settings = data.data as ShopSettings;
  void cacheShopSettings(settings);
  return settings;
}
