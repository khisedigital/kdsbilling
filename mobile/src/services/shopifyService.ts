import api from './api';

export type ShopifySyncStatus = 'idle' | 'queued' | 'running' | 'ok' | 'partial' | 'error';
export type ShopifyConnectionStatus = 'not_connected' | 'pending' | 'connected' | 'disconnected' | 'error';

export interface ShopifyStatus {
  configured: boolean;
  connected: boolean;
  status: ShopifyConnectionStatus;
  shopDomain: string | null;
  shopName: string | null;
  locationName: string | null;
  branchId: string | null;
  branchName: string | null;
  productSync: {
    status: ShopifySyncStatus;
    lastSyncAt: string | null;
    mappedCount: number;
    summary: {
      total: number;
      matched: number;
      created: number;
      updated: number;
      skipped: number;
      errors: number;
      lastErrors: string[];
    } | null;
  };
  inventorySync: { status: ShopifySyncStatus; lastSyncAt: string | null };
  orderSync: { status: ShopifySyncStatus; lastSyncAt: string | null; orderCount: number };
  lastSyncAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  connectedAt: string | null;
  syncInProgress: boolean;
}

// All Shopify calls go through the POS backend; the app never talks to Shopify's Admin API.
export async function getShopifyStatus(): Promise<ShopifyStatus> {
  const { data } = await api.get('/integrations/shopify');
  return data.data;
}

export async function startShopifyConnect(shopDomain: string): Promise<{ authUrl: string; shopDomain: string }> {
  const { data } = await api.post('/integrations/shopify/connect', { shopDomain });
  return data.data;
}

export async function syncShopifyNow(): Promise<ShopifyStatus> {
  const { data } = await api.post('/integrations/shopify/sync');
  return data.data;
}

export async function disconnectShopify(): Promise<ShopifyStatus> {
  const { data } = await api.post('/integrations/shopify/disconnect');
  return data.data;
}
