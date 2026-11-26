jest.mock('../src/services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
jest.mock('../src/services/businessService', () => ({ createBill: jest.fn(), fetchCustomers: jest.fn() }));
jest.mock('../src/services/catalogService', () => ({
  fetchAllProducts: jest.fn(), fetchBrands: jest.fn(), fetchCategories: jest.fn(),
}));
jest.mock('../src/services/shopSettingsService', () => ({ getShopSettings: jest.fn() }));
jest.mock('../src/services/inventoryService', () => ({ fetchSuppliers: jest.fn() }));
jest.mock('../src/desktop/bridge', () => ({ getDesktopBridge: jest.fn(() => null) }));
jest.mock('../src/services/catalogCache', () => ({
  writeCachedProducts: jest.fn(), writeCachedCategories: jest.fn(), bumpCatalogRevision: jest.fn(),
}));
jest.mock('../src/store/authStore', () => ({ useAuthStore: { getState: () => ({ savedLogin: { shopCode: 'test' } }) } }));
jest.mock('../src/utils/apiError', () => ({ apiError: (_err: unknown, fallback: string) => fallback }));
jest.mock('../src/offline/capability', () => ({ isDesktopOfflineCapable: () => true }));
jest.mock('../src/offline/connectivityStore', () => ({
  useConnectivityStore: { getState: () => ({ setLastSyncError: jest.fn(), setOnline: jest.fn() }) },
}));
jest.mock('../src/offline/outbox', () => ({
  listOutboxSales: jest.fn(),
  markOutboxSaleError: jest.fn(),
  refreshPendingCount: jest.fn(async () => {}),
  removeOutboxSale: jest.fn(async () => {}),
}));
jest.mock('../src/offline/localApi', () => ({
  localListSyncQueue: jest.fn(),
  localMarkSyncQueueDone: jest.fn(async () => {}),
  localMarkSyncQueueError: jest.fn(async () => {}),
  localUpsertProduct: jest.fn(async () => {}),
  localDeleteProduct: jest.fn(async () => {}),
}));
jest.mock('../src/offline/sqliteApi', () => ({
  hasSqliteBridge: () => true,
  sqliteGetMeta: jest.fn(async () => null),
  sqliteSetMeta: jest.fn(async () => {}),
  sqliteGetProduct: jest.fn(),
  sqliteListProducts: jest.fn(),
  sqliteStatus: jest.fn(async () => ({ ok: true, localOnlyCount: 0 })),
  sqliteReplaceCatalogBatched: jest.fn(),
  sqliteReplaceCustomers: jest.fn(),
  sqliteReadShopSettings: jest.fn(),
  sqliteRetryMissingVariantSales: jest.fn(async () => 0),
  sqliteSaveShopSettings: jest.fn(),
  sqliteSaveSale: jest.fn(),
}));

import api from '../src/services/api';
import { createBill, fetchCustomers } from '../src/services/businessService';
import { fetchAllProducts, fetchBrands, fetchCategories } from '../src/services/catalogService';
import { fetchSuppliers } from '../src/services/inventoryService';
import { localDeleteProduct, localListSyncQueue, localMarkSyncQueueDone, localMarkSyncQueueError } from '../src/offline/localApi';
import { listOutboxSales, markOutboxSaleError, removeOutboxSale } from '../src/offline/outbox';
import type { OutboxSale } from '../src/offline/outbox';
import { sqliteGetMeta, sqliteGetProduct, sqliteListProducts, sqliteReadShopSettings, sqliteReplaceCatalogBatched, sqliteRetryMissingVariantSales, sqliteSaveShopSettings, sqliteSetMeta, sqliteStatus } from '../src/offline/sqliteApi';
import { flushOutbox, pullEverythingToSqlite } from '../src/offline/syncEngine';

it('maps locally created product and variant ids before uploading later edits and bills', async () => {
  Object.defineProperty(global, 'navigator', { value: { onLine: true }, configurable: true });
  jest.mocked(localListSyncQueue).mockResolvedValue([
    { id: 'q1', entityType: 'product', entityId: 'local-p', op: 'create',
      createdAt: '2025-12-31T23:59:58Z',
      payload: { name: 'Tea', stockQty: 10, localInitialVariantStock: { 'local-v': 10 } } },
    { id: 'q2', entityType: 'product', entityId: 'local-p', op: 'update',
      createdAt: '2025-12-31T23:59:59Z',
      payload: { variants: [{ id: 'local-v', sellingPrice: 20 }] } },
  ]);
  const localProduct = {
    id: 'local-p', name: 'Tea',
    variants: [{ id: 'local-v', sku: 'TEA', stockQty: 8, barcode: '12345', barcodes: [{ barcode: '12345' }] }],
  };
  const remoteProduct = { id: 'server-p', variants: [{ id: 'server-v', sku: 'TEA', barcodes: [{ barcode: '12345' }] }] };
  jest.mocked(sqliteGetProduct).mockImplementation(async (id) => id === 'local-p' ? localProduct : null);
  jest.mocked(api.post).mockResolvedValue({ data: { data: remoteProduct } });
  jest.mocked(api.get).mockResolvedValue({ data: { data: remoteProduct } });
  jest.mocked(listOutboxSales).mockResolvedValue([{
    clientBillId: 'bill', payload: { items: [{ variantId: 'local-v' }] },
    createdAt: '2026-01-01T00:00:00Z', syncAttempts: 0,
    bill: { id: 'bill', bill_number: 'OFF-1', status: 'completed', subtotal: 0,
      discount_amount: 0, tax_amount: 0, total_amount: 0, paid_amount: 0, change_amount: 0 },
  }]);
  jest.mocked(createBill).mockResolvedValue({ id: 'server-bill' });

  await expect(flushOutbox()).resolves.toEqual({ synced: 3, failed: 0 });
  expect(api.post).toHaveBeenCalledWith('/products', expect.objectContaining({
    variants: [expect.objectContaining({ stockQty: 10 })],
  }));
  expect(jest.mocked(api.post).mock.calls[0][1]).not.toHaveProperty('localInitialVariantStock');
  expect(sqliteSetMeta).toHaveBeenCalledWith(
    'product_sync_id_map', JSON.stringify({ 'local-p': 'server-p', 'local-v': 'server-v' }),
  );
  expect(api.put).toHaveBeenCalledWith('/products/server-p', {
    variants: [{ id: 'server-v', sellingPrice: 20 }],
  });

  expect(createBill).toHaveBeenCalledWith({ items: [{ variantId: 'server-v' }], syncRequireIdempotency: true });
  expect(jest.mocked(api.put).mock.invocationCallOrder[0])
    .toBeLessThan(jest.mocked(createBill).mock.invocationCallOrder[0]);
  expect(localMarkSyncQueueDone).toHaveBeenCalledTimes(2);
});

it('stops in chronological order and keeps the local product when a sale fails', async () => {
  jest.clearAllMocks();
  jest.mocked(localListSyncQueue).mockResolvedValue([
    { id: 'q1', entityType: 'product', entityId: 'local-p', op: 'create',
      createdAt: '2025-12-31T23:59:58Z',
      payload: { name: 'Tea', localInitialVariantStock: { 'local-v': 10 } } },
    { id: 'q2', entityType: 'product', entityId: 'local-p', op: 'update',
      createdAt: '2026-01-01T00:00:01Z', payload: { variants: [{ id: 'local-v', stockQty: 7 }] } },
  ]);
  jest.mocked(listOutboxSales).mockResolvedValue([{
    clientBillId: 'bill', payload: { items: [{ variantId: 'local-v' }] },
    createdAt: '2026-01-01T00:00:00Z', syncAttempts: 0,
    bill: { id: 'bill', bill_number: 'OFF-1', status: 'completed', subtotal: 0,
      discount_amount: 0, tax_amount: 0, total_amount: 0, paid_amount: 0, change_amount: 0 },
  }]);
  jest.mocked(createBill).mockRejectedValueOnce(new Error('sale failed'));

  await expect(flushOutbox()).resolves.toEqual({ synced: 1, failed: 1 });
  expect(api.put).not.toHaveBeenCalled();
  expect(localDeleteProduct).not.toHaveBeenCalled();
});

describe('recovering a missing sale variant', () => {
  const sale: OutboxSale = {
    clientBillId: 'bill', payload: { items: [{ variantId: 'local-v' }] },
    createdAt: '2026-01-01T00:00:00Z', syncAttempts: 0,
    bill: { id: 'bill', bill_number: 'OFF-1', status: 'completed', subtotal: 0,
      discount_amount: 0, tax_amount: 0, total_amount: 0, paid_amount: 0, change_amount: 0 },
  };
  const localProduct = {
    id: 'local-p', name: 'Tea', uom_id: 'unit',
    variants: [{ id: 'local-v', sku: 'TEA', barcode: '12345' }],
  };
  beforeEach(() => {
    jest.resetAllMocks();
    Object.defineProperty(global, 'navigator', { value: { onLine: true }, configurable: true });
    jest.mocked(localListSyncQueue).mockResolvedValue([]);
    jest.mocked(listOutboxSales).mockResolvedValue([sale]);
    jest.mocked(sqliteGetMeta).mockResolvedValue(null);
    jest.mocked(sqliteRetryMissingVariantSales).mockResolvedValue(0);
    jest.mocked(sqliteStatus).mockResolvedValue({ ok: true, localOnlyCount: 0 });
    jest.mocked(sqliteListProducts).mockImplementation(async (options) => ({
      items: options?.status === 'active' ? [localProduct] : [], total: 1,
    }));
    jest.mocked(sqliteGetProduct).mockResolvedValue(null);
    jest.mocked(api.post).mockResolvedValue({ data: { data: {
      productId: 'server-p', variants: [{ localId: 'local-v', variantId: 'server-v' }],
    } } });
    jest.mocked(createBill).mockRejectedValueOnce({
      response: { data: { error: { message: 'Variant not found: local-v' } } },
    });
  });

  it('persists verified product and variant mappings before retrying pending bills', async () => {
    jest.mocked(createBill).mockResolvedValue({ id: 'server-bill' });
    jest.mocked(listOutboxSales).mockResolvedValue([
      sale, { ...sale, clientBillId: 'bill-2', createdAt: '2026-01-01T00:00:01Z' },
    ]);

    await expect(flushOutbox()).resolves.toEqual({ synced: 2, failed: 0 });
    expect(sqliteSetMeta).toHaveBeenCalledWith(
      'product_sync_id_map', JSON.stringify({ 'local-v': 'server-v', 'local-p': 'server-p' }),
    );
    expect(createBill).toHaveBeenNthCalledWith(2, { items: [{ variantId: 'server-v' }], syncRequireIdempotency: true });
    expect(createBill).toHaveBeenNthCalledWith(3, { items: [{ variantId: 'server-v' }], syncRequireIdempotency: true });
    expect(jest.mocked(sqliteSetMeta).mock.invocationCallOrder[0])
      .toBeLessThan(jest.mocked(createBill).mock.invocationCallOrder[1]);
    expect(removeOutboxSale).toHaveBeenCalledTimes(2);
  });

  it('does not map a product ID to itself', async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { data: {
      productId: 'local-p', variants: [{ localId: 'local-v', variantId: 'server-v' }],
    } } });
    jest.mocked(createBill).mockResolvedValue({ id: 'server-bill' });

    await expect(flushOutbox()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(sqliteSetMeta).toHaveBeenCalledWith(
      'product_sync_id_map', JSON.stringify({ 'local-v': 'server-v' }),
    );
    expect(localDeleteProduct).not.toHaveBeenCalled();
  });

  it('retains the bill when barcode matches are ambiguous', async () => {
    jest.mocked(api.post).mockRejectedValue({ response: { status: 409, data: { error: { message: 'Cannot safely match' } } } });

    await expect(flushOutbox()).resolves.toEqual({ synced: 0, failed: 0, skipped: 1 });
    expect(markOutboxSaleError).toHaveBeenCalledWith(sale, expect.stringContaining('Cannot safely match'), true);
    expect(sqliteSetMeta).not.toHaveBeenCalled();
    expect(removeOutboxSale).not.toHaveBeenCalled();
    expect(localDeleteProduct).not.toHaveBeenCalled();
  });

  it('requests missing variant creation with its pack barcodes before retrying', async () => {
    jest.mocked(sqliteListProducts).mockImplementation(async (options) => ({
      items: options?.status === 'active' ? [{
        ...localProduct, variants: [{
          ...localProduct.variants[0], selling_price: 10, cost_price: 5,
          barcodes: [{ barcode: '12345', quantity: null }, { barcode: '67890', quantity: 2 }],
        }],
      }] : [], total: 1,
    }));
    jest.mocked(createBill).mockResolvedValue({ id: 'server-bill' });

    await expect(flushOutbox()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(api.post).toHaveBeenCalledWith('/products/sync-missing-variant', expect.objectContaining({
      variants: [expect.objectContaining({
        id: 'local-v',
        barcodes: [{ barcode: '12345', quantity: null }, { barcode: '67890', quantity: 2 }],
      })],
    }));
    expect(jest.mocked(api.post).mock.invocationCallOrder[0])
      .toBeLessThan(jest.mocked(createBill).mock.invocationCallOrder[1]);
  });

  it('maps all local variants before retrying or replacing the local product', async () => {
    jest.mocked(sqliteListProducts).mockImplementation(async (options) => ({
      items: options?.status === 'active' ? [{
        ...localProduct, variants: [
          { ...localProduct.variants[0], selling_price: 10 },
          { id: 'local-v2', sku: 'TEA-2', selling_price: 20, barcode: '67890' },
        ],
      }] : [], total: 1,
    }));
    jest.mocked(api.post).mockResolvedValue({ data: { data: {
      productId: 'server-p',
      variants: [{ localId: 'local-v', variantId: 'server-v' }, { localId: 'local-v2', variantId: 'server-v2' }],
    } } });
    jest.mocked(createBill).mockResolvedValue({ id: 'server-bill' });

    await expect(flushOutbox()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(sqliteSetMeta).toHaveBeenCalledWith(
      'product_sync_id_map', JSON.stringify({ 'local-v': 'server-v', 'local-v2': 'server-v2', 'local-p': 'server-p' }),
    );
    expect(api.post).toHaveBeenCalledWith('/products/sync-missing-variant', expect.objectContaining({
      variants: expect.arrayContaining([expect.objectContaining({ id: 'local-v2' })]),
    }));
  });

  it('does not replace a local product if a variant is missing from the live response', async () => {
    jest.mocked(sqliteGetProduct).mockImplementation(async (id) => id === 'local-p' ? {
      ...localProduct, variants: [...localProduct.variants, { id: 'new-local-v', sku: 'NEW' }],
    } : null);
    jest.mocked(api.get).mockResolvedValue({ data: { data: {
      id: 'server-p', variants: [{ id: 'server-v' }],
    } } });
    jest.mocked(createBill).mockResolvedValue({ id: 'server-bill' });

    await expect(flushOutbox()).rejects.toThrow('variants that are not yet synced');
    expect(localDeleteProduct).not.toHaveBeenCalled();
  });

  it('uses a saved mapping on a later sync attempt', async () => {
    jest.mocked(sqliteGetMeta).mockResolvedValue(JSON.stringify({ 'local-v': 'server-v' }));
    jest.mocked(createBill).mockReset().mockResolvedValue({ id: 'server-bill' });

    await expect(flushOutbox()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(createBill).toHaveBeenCalledWith({ items: [{ variantId: 'server-v' }], syncRequireIdempotency: true });
    expect(sqliteListProducts).not.toHaveBeenCalled();
  });

  it('continues with later sales after keeping an unmatched sale local-only', async () => {
    jest.mocked(api.post).mockRejectedValue({ response: { status: 409, data: { error: { message: 'Cannot safely match' } } } });
    jest.mocked(listOutboxSales).mockResolvedValue([
      sale, { ...sale, clientBillId: 'bill-2', createdAt: '2026-01-01T00:00:01Z' },
    ]);
    jest.mocked(createBill).mockResolvedValue({ id: 'later-bill' });

    await expect(flushOutbox()).resolves.toEqual({ synced: 1, failed: 0, skipped: 1 });
    expect(markOutboxSaleError).toHaveBeenCalledWith(sale, expect.stringContaining('Cannot safely match'), true);
    expect(removeOutboxSale).toHaveBeenCalledTimes(1);
    expect(removeOutboxSale).toHaveBeenCalledWith('bill-2', 'later-bill', expect.anything(), sale.payload);
  });

  it.each([401, 403, 408, 429, 500])('stops without skipping on HTTP %s', async (status) => {
    jest.mocked(createBill).mockReset().mockRejectedValue({ response: { status, data: { error: { message: 'Unavailable' } } } });

    await expect(flushOutbox()).resolves.toEqual({ synced: 0, failed: 1 });
    expect(markOutboxSaleError).toHaveBeenCalledWith(sale, expect.any(String), false);
    expect(removeOutboxSale).not.toHaveBeenCalled();
  });

  it('stops on network errors without making the sale local-only', async () => {
    jest.mocked(createBill).mockReset().mockRejectedValue(new Error('Network Error'));
    await expect(flushOutbox()).resolves.toEqual({ synced: 0, failed: 1 });
    expect(markOutboxSaleError).toHaveBeenCalledWith(sale, 'Network Error', false);
  });

  it('keeps a rejected queue item local-only and continues to the next sale', async () => {
    const queued = { id: 'q-bad', entityType: 'product', entityId: 'missing-p', op: 'update',
      createdAt: '2025-12-31T23:59:59Z', payload: {} };
    jest.mocked(localListSyncQueue).mockResolvedValue([queued]);
    jest.mocked(api.put).mockRejectedValue({ response: { status: 422, data: { error: { message: 'Invalid product' } } } });
    jest.mocked(createBill).mockReset().mockResolvedValue({ id: 'server-bill' });

    await expect(flushOutbox()).resolves.toEqual({ synced: 1, failed: 0, skipped: 1 });
    expect(localMarkSyncQueueError).toHaveBeenCalledWith('q-bad', expect.any(String), 1, true);
    expect(removeOutboxSale).toHaveBeenCalledTimes(1);
  });

  it('does not acknowledge a stock movement rejected as not found', async () => {
    jest.mocked(localListSyncQueue).mockResolvedValue([{
      id: 'q-stock', entityType: 'stock_movement', entityId: 'movement', op: 'in',
      createdAt: '2025-12-31T23:59:59Z', payload: {
        syncProtocol: 2, item: { variantId: 'missing-v', quantity: 1 },
      },
    }]);
    jest.mocked(listOutboxSales).mockResolvedValue([]);
    jest.mocked(api.post).mockRejectedValue({
      response: { status: 404, data: { error: { code: 'NOT_FOUND', message: 'Product variant not found' } } },
    });

    it('requires an idempotent acknowledgment before completing a new stock movement', async () => {
      jest.mocked(localListSyncQueue).mockResolvedValue([{
        id: 'q-stock', entityType: 'stock_movement', entityId: 'movement', op: 'in',
        createdAt: '2025-12-31T23:59:59Z', payload: {
          syncProtocol: 2, item: { variantId: 'local-v', quantity: 1 },
        },
      }]);
      jest.mocked(listOutboxSales).mockResolvedValue([]);
      jest.mocked(api.post).mockResolvedValueOnce({ data: { data: {} } })
        .mockResolvedValueOnce({ data: { data: { clientMovementId: 'movement', movementId: 'live-movement' } } });

      await expect(flushOutbox()).resolves.toEqual({ synced: 0, failed: 1 });
      expect(localMarkSyncQueueDone).not.toHaveBeenCalled();
      await expect(flushOutbox()).resolves.toEqual({ synced: 1, failed: 0 });
      expect(api.post).toHaveBeenLastCalledWith('/stock/sync-movement', expect.objectContaining({
        clientMovementId: 'movement', operation: 'in', variantId: 'local-v', quantity: 1,
      }));
      expect(localMarkSyncQueueDone).toHaveBeenCalledWith('q-stock');
    });

    it('does not upload legacy movements whose earlier outcome is unknown', async () => {
      jest.mocked(localListSyncQueue).mockResolvedValue([{
        id: 'q-legacy', entityType: 'stock_movement', entityId: 'old-movement', op: 'in',
        createdAt: '2025-12-31T23:59:59Z', payload: { item: { variantId: 'local-v', quantity: 1 } },
      }]);
      jest.mocked(listOutboxSales).mockResolvedValue([]);
      await expect(flushOutbox()).resolves.toEqual({ synced: 0, failed: 0, skipped: 1 });
      expect(api.post).not.toHaveBeenCalled();
      expect(localMarkSyncQueueError).toHaveBeenCalledWith('q-legacy', expect.stringContaining('verify the live stock history'), 1, true);
    });

    await expect(flushOutbox()).resolves.toEqual({ synced: 0, failed: 0, skipped: 1 });
    expect(localMarkSyncQueueError).toHaveBeenCalledWith('q-stock', expect.any(String), 1, true);
    expect(localMarkSyncQueueDone).not.toHaveBeenCalled();
  });

  it('stops when the verification endpoint fails instead of skipping the sale', async () => {
    jest.mocked(api.post).mockRejectedValue({ response: { status: 404, data: { error: { message: 'Endpoint unavailable' } } } });
    await expect(flushOutbox()).resolves.toEqual({ synced: 0, failed: 1 });
    expect(markOutboxSaleError).toHaveBeenCalledWith(sale, expect.stringContaining('Could not verify'), false);
  });

  it('keeps the bill pending after an interrupted product creation and retries with the same identity', async () => {
    jest.mocked(api.post).mockRejectedValueOnce(new Error('Network Error'));
    await expect(flushOutbox()).resolves.toEqual({ synced: 0, failed: 1 });
    expect(removeOutboxSale).not.toHaveBeenCalled();
    const firstRequest = jest.mocked(api.post).mock.calls[0];

    jest.mocked(createBill).mockReset()
      .mockRejectedValueOnce({ response: { data: { error: { message: 'Variant not found: local-v' } } } })
      .mockResolvedValue({ id: 'server-bill' });
    await expect(flushOutbox()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(jest.mocked(api.post).mock.calls[1]).toEqual(firstRequest);
    expect(removeOutboxSale).toHaveBeenCalledTimes(1);
  });

  it('requires the updated desktop database before uploading anything', async () => {
    jest.mocked(sqliteStatus).mockResolvedValue({ ok: true });
    await expect(flushOutbox()).rejects.toThrow('Restart the desktop app');
    expect(createBill).not.toHaveBeenCalled();
  });
});

it('pulls missing variants without overwriting existing local data after a skip', async () => {
  jest.resetAllMocks();
  Object.defineProperty(global, 'navigator', { value: { onLine: true }, configurable: true });
  const variant = { id: 'remote-v', sku: 'TEA', cost_price: 1, selling_price: 2 };
  const product = { id: 'remote-p', name: 'Tea', uom_id: 'unit', status: 'active',
    is_weight_based: false, allow_decimal_qty: false, has_variants: false, variants: [variant] };
  jest.mocked(sqliteStatus).mockResolvedValue({ ok: true, localOnlyCount: 1 });
  jest.mocked(sqliteGetMeta).mockResolvedValue(JSON.stringify({ 'local-p': 'remote-p', 'local-v': 'remote-v' }));
  jest.mocked(sqliteGetProduct).mockImplementation(async (id) => id === 'local-p'
    ? { ...product, id: 'local-p', variants: [{ ...variant, id: 'local-v' }] } : null);
  jest.mocked(fetchAllProducts).mockResolvedValue([product]);
  jest.mocked(fetchCategories).mockResolvedValue([]);
  jest.mocked(fetchBrands).mockResolvedValue([]);
  jest.mocked(fetchCustomers).mockResolvedValue({ items: [] });
  jest.mocked(fetchSuppliers).mockResolvedValue([]);
  jest.mocked(sqliteReadShopSettings).mockResolvedValue({ shopName: 'Local' });
  jest.mocked(sqliteReplaceCatalogBatched).mockResolvedValue({ products: 0, categories: 0, brands: 0 });
  jest.mocked(api.get).mockImplementation(async (url) => ({
    data: { data: url === '/shop-settings' ? { shopName: 'Live' } : [] },
  }));

  await expect(pullEverythingToSqlite()).resolves.not.toHaveProperty('errors');
  expect(sqliteReplaceCatalogBatched).toHaveBeenCalledWith(expect.objectContaining({
    insertOnly: true,
    products: [expect.objectContaining({ id: 'local-p', variants: [expect.objectContaining({ id: 'local-v' })] })],
  }));
  expect(sqliteSaveShopSettings).not.toHaveBeenCalled();

  jest.mocked(sqliteGetMeta).mockResolvedValue(JSON.stringify({ 'local-v': 'remote-v' }));
  jest.mocked(sqliteGetProduct).mockImplementation(async (id) => id === 'remote-p'
    ? { ...product, variants: [{ ...variant, id: 'local-v' }] } : null);
  jest.mocked(sqliteReplaceCatalogBatched).mockClear();
  await expect(pullEverythingToSqlite()).resolves.not.toHaveProperty('errors');
  expect(sqliteReplaceCatalogBatched).toHaveBeenCalledWith(expect.objectContaining({
    insertOnly: true,
    products: [expect.objectContaining({ id: 'remote-p', variants: [expect.objectContaining({ id: 'local-v' })] })],
  }));
});
