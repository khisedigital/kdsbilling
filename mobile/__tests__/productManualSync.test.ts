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
  sqliteStatus: jest.fn(async () => ({ ok: true, localOnlyCount: 0, syncGuardVersion: 1 })),
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
import { getShopSettings } from '../src/services/shopSettingsService';
import { localDeleteProduct, localListSyncQueue, localMarkSyncQueueDone, localMarkSyncQueueError } from '../src/offline/localApi';
import { listOutboxSales, markOutboxSaleError, removeOutboxSale } from '../src/offline/outbox';
import type { OutboxSale } from '../src/offline/outbox';
import { sqliteGetMeta, sqliteGetProduct, sqliteListProducts, sqliteReadShopSettings, sqliteReplaceCatalogBatched, sqliteRetryMissingVariantSales, sqliteSaveShopSettings, sqliteSetMeta, sqliteStatus } from '../src/offline/sqliteApi';
import { flushOutbox, pullEverythingToSqlite } from '../src/offline/syncEngine';

const acceptOfflineBill = async (payload: Record<string, unknown>) => ({
  id: payload.clientBillId, bill_number: payload.billNumber, device_id: payload.deviceId,
});
const deviceMeta = async (key: string) => key === 'sync_device_id' ? 'device-1' : null;

describe('syncing desktop product edits', () => {
  const previous = {
    id: 'local-p', name: 'Tea', uom_id: 'unit',
    variants: [{ id: 'local-v', sku: 'TEA', selling_price: 10, stockQty: 3,
      barcodes: [{ barcode: '12345', quantity: null }, { barcode: '99999', quantity: 2 }] }],
  };
  const updated = {
    ...previous, name: 'Updated tea',
    variants: [
      { ...previous.variants[0], sku: 'NEW-TEA', stockQty: 5 },
      { id: 'new-v', sku: 'TEA-L', selling_price: 20, stockQty: 4, barcodes: [{ barcode: '45678' }] },
    ],
  };
  const update = {
    id: 'edit', entityType: 'product', entityId: 'local-p', op: 'update',
    createdAt: '2026-01-01T00:00:00Z',
    payload: {
      id: 'local-p', name: 'Updated tea', syncEditProtocol: 2,
      syncPreviousProduct: previous, syncUpdatedProduct: updated,
      variants: [
        { id: 'local-v', sku: 'NEW-TEA', sellingPrice: 10,
          barcodes: ['12345'], quantityBarcodes: [{ barcode: '99999', quantity: 3 }] },
        { id: 'new-v', sku: 'TEA-L', sellingPrice: 20, barcodes: ['45678'] },
      ],
    },
  };
  beforeEach(() => {
    jest.resetAllMocks();
    Object.defineProperty(global, 'navigator', { value: { onLine: true }, configurable: true });
    jest.mocked(sqliteStatus).mockResolvedValue({ ok: true, localOnlyCount: 0, syncGuardVersion: 2 });
    jest.mocked(sqliteRetryMissingVariantSales).mockResolvedValue(0);
    jest.mocked(sqliteGetMeta).mockImplementation(deviceMeta);
    jest.mocked(listOutboxSales).mockResolvedValue([]);
    jest.mocked(localListSyncQueue).mockResolvedValue([update]);
    jest.mocked(api.post).mockImplementation(async (_url, data) => {
      if (!data || typeof data !== 'object' || !('variants' in data) || !Array.isArray(data.variants)) {
        throw new Error('Invalid test request');
      }
      return { data: { data: {
        identityProtocol: 1, productId: 'server-p',
        variants: data.variants.map((v: { id: string }) => ({
          localId: v.id, variantId: v.id === 'local-v' ? 'server-v' : 'server-new-v',
        })),
      } } };
    });
  });
  afterEach(() => {
    jest.resetAllMocks();
    jest.mocked(sqliteStatus).mockResolvedValue({ ok: true, localOnlyCount: 0, syncGuardVersion: 1 });
    jest.mocked(sqliteRetryMissingVariantSales).mockResolvedValue(0);
  });

  it('maps the original mobile product and new variant before uploading edits and packs', async () => {
    await expect(flushOutbox()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(api.post).toHaveBeenNthCalledWith(1, '/products/sync-catalog', expect.objectContaining({
      product: expect.objectContaining({ name: 'Tea' }),
      variants: [expect.objectContaining({ id: 'local-v', sku: 'TEA', barcodes: [
        { barcode: '12345', quantity: null }, { barcode: '99999', quantity: 2 },
      ] })],
    }));
    expect(api.post).toHaveBeenNthCalledWith(2, '/products/sync-catalog', expect.objectContaining({
      remoteProductId: 'server-p',
      variants: [expect.objectContaining({ id: 'new-v' })],
    }));
    expect(api.put).toHaveBeenCalledWith('/products/server-p', {
      name: 'Updated tea',
      variants: [
        { id: 'server-v', sku: 'NEW-TEA', sellingPrice: 10,
          barcodes: ['12345'], quantityBarcodes: [{ barcode: '99999', quantity: 3 }] },
        { id: 'server-new-v', sku: 'TEA-L', sellingPrice: 20, barcodes: ['45678'] },
      ],
    });
  });

  it('keeps verified mappings across an interrupted upload and does not recreate variants', async () => {
    let map: string | null = null;
    jest.mocked(sqliteGetMeta).mockImplementation(async (key) => key === 'sync_device_id' ? 'device-1' : map);
    jest.mocked(sqliteSetMeta).mockImplementation(async (_key, value) => { map = value; });
    jest.mocked(api.put).mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValue({});
    await expect(flushOutbox()).resolves.toEqual({ synced: 0, failed: 1 });
    await expect(flushOutbox()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(api.put).toHaveBeenCalledTimes(2);
  });

  it('retains a conflicting edit without sending a product update', async () => {
    jest.mocked(api.post).mockRejectedValue({ response: { status: 409, data: { error: { message: 'Duplicate barcode' } } } });
    await expect(flushOutbox()).resolves.toEqual({ synced: 0, failed: 0, skipped: 1 });
    expect(api.put).not.toHaveBeenCalled();
    expect(localMarkSyncQueueError).toHaveBeenCalledWith('edit', expect.any(String), 1, true);
  });

  it('uploads stock differences separately using the mapped variant and checks the acknowledgment', async () => {
    jest.mocked(localListSyncQueue).mockResolvedValue([
      update,
      { id: 'move', entityType: 'stock_movement', entityId: 'movement-uuid', op: 'adjust',
        createdAt: '2026-01-01T00:00:01Z',
        payload: { syncProtocol: 2, productEditMovement: true, endpoint: 'adjust',
          item: { variantId: 'new-v', quantity: 4 } } },
    ]);
    const catalogPost = jest.mocked(api.post).getMockImplementation();
    jest.mocked(api.post).mockImplementation(async (url, data, config) => {
      if (url === '/stock/sync-movement') return { data: { data: {
        clientMovementId: 'movement-uuid', movementId: 'server-movement',
        variantId: 'server-new-v', quantityChange: 4,
      } } };
      if (!catalogPost) throw new Error('Missing catalog mock');
      return catalogPost(url, data, config);
    });
    await expect(flushOutbox()).resolves.toEqual({ synced: 2, failed: 0 });
    expect(api.post).toHaveBeenCalledWith('/stock/sync-movement', expect.objectContaining({
      clientMovementId: 'movement-uuid', variantId: 'server-new-v', quantity: 4, operation: 'adjust',
    }));
    expect(localMarkSyncQueueDone).toHaveBeenCalledWith('move');
  });
});

it('maps locally created product and variant ids before uploading later edits and bills', async () => {
  Object.defineProperty(global, 'navigator', { value: { onLine: true }, configurable: true });
  jest.mocked(sqliteGetMeta).mockImplementation(deviceMeta);
  jest.mocked(localListSyncQueue).mockResolvedValue([
    { id: 'q1', entityType: 'product', entityId: 'local-p', op: 'create',
      createdAt: '2025-12-31T23:59:58Z',
      payload: { name: 'Tea', stockQty: 10, localInitialVariantStock: { 'local-v': 10 } } },
    { id: 'q2', entityType: 'product', entityId: 'local-p', op: 'update',
      createdAt: '2025-12-31T23:59:59Z',
      payload: { variants: [{ id: 'local-v', sellingPrice: 20 }] } },
  ]);
  const localProduct = {
    id: 'local-p', name: 'Tea', uom_id: 'unit',
    variants: [{ id: 'local-v', sku: 'TEA', selling_price: 10, stockQty: 8, barcode: '12345', barcodes: [{ barcode: '12345' }] }],
  };
  const remoteProduct = { id: 'server-p', variants: [{ id: 'server-v', sku: 'TEA', barcodes: [{ barcode: '12345' }] }] };
  jest.mocked(sqliteGetProduct).mockImplementation(async (id) => id === 'local-p' ? localProduct : null);
  jest.mocked(sqliteListProducts).mockImplementation(async (options) => ({
    items: options?.status === 'active' ? [localProduct] : [], total: 1,
  }));
  jest.mocked(api.post).mockResolvedValue({ data: { data: {
    identityProtocol: 1, productId: 'server-p', variants: [{ localId: 'local-v', variantId: 'server-v' }],
  } } });
  jest.mocked(api.get).mockResolvedValue({ data: { data: remoteProduct } });
  jest.mocked(listOutboxSales).mockResolvedValue([{
    clientBillId: 'bill', payload: { items: [{ variantId: 'local-v' }] },
    createdAt: '2026-01-01T00:00:00Z', syncAttempts: 0,
    bill: { id: 'bill', bill_number: 'OFF-1', status: 'completed', subtotal: 0,
      discount_amount: 0, tax_amount: 0, total_amount: 0, paid_amount: 0, change_amount: 0 },
  }]);
  jest.mocked(createBill).mockImplementation(acceptOfflineBill);

  await expect(flushOutbox()).resolves.toEqual({ synced: 3, failed: 0 });
  expect(api.post).toHaveBeenCalledWith('/products/sync-catalog', expect.objectContaining({
    deviceId: 'device-1',
    variants: [expect.objectContaining({ id: 'local-v', openingStock: 10 })],
  }));
  expect(sqliteSetMeta).toHaveBeenCalledWith(
    'product_sync_id_map', JSON.stringify({ 'local-v': 'server-v', 'local-p': 'server-p' }),
  );
  expect(api.put).toHaveBeenCalledWith('/products/server-p', {
    variants: [{ id: 'server-v', sellingPrice: 20 }],
  });

  expect(createBill).toHaveBeenCalledWith(expect.objectContaining({
    items: [{ variantId: 'server-v' }], syncRequireIdempotency: true,
    clientBillId: 'bill', billNumber: 'OFF-1', deviceId: 'device-1',
  }), true);
  expect(jest.mocked(api.put).mock.invocationCallOrder[0])
    .toBeLessThan(jest.mocked(createBill).mock.invocationCallOrder[0]);
  expect(localMarkSyncQueueDone).toHaveBeenCalledTimes(2);
  expect(localDeleteProduct).not.toHaveBeenCalled();
});

it('stops in chronological order and keeps the local product when a sale fails', async () => {
  jest.clearAllMocks();
  jest.mocked(sqliteGetMeta).mockImplementation(deviceMeta);
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
    jest.mocked(sqliteGetMeta).mockImplementation(deviceMeta);
    jest.mocked(sqliteRetryMissingVariantSales).mockResolvedValue(0);
    jest.mocked(sqliteStatus).mockResolvedValue({ ok: true, localOnlyCount: 0, syncGuardVersion: 1 });
    jest.mocked(sqliteListProducts).mockImplementation(async (options) => ({
      items: options?.status === 'active' ? [localProduct] : [], total: 1,
    }));
    jest.mocked(sqliteGetProduct).mockResolvedValue(null);
    jest.mocked(api.post).mockResolvedValue({ data: { data: {
      identityProtocol: 1, productId: 'server-p', variants: [{ localId: 'local-v', variantId: 'server-v' }],
    } } });
    jest.mocked(createBill).mockImplementation(acceptOfflineBill);
  });

  it('persists verified product and variant mappings before retrying pending bills', async () => {
    jest.mocked(createBill).mockImplementation(acceptOfflineBill);
    jest.mocked(listOutboxSales).mockResolvedValue([
      sale, { ...sale, clientBillId: 'bill-2', createdAt: '2026-01-01T00:00:01Z' },
    ]);

    await expect(flushOutbox()).resolves.toEqual({ synced: 2, failed: 0 });
    expect(sqliteSetMeta).toHaveBeenCalledWith(
      'product_sync_id_map', JSON.stringify({ 'local-v': 'server-v', 'local-p': 'server-p' }),
    );
    expect(createBill).toHaveBeenNthCalledWith(1, expect.objectContaining({ items: [{ variantId: 'server-v' }], clientBillId: 'bill' }), true);
    expect(createBill).toHaveBeenNthCalledWith(2, expect.objectContaining({ items: [{ variantId: 'server-v' }], clientBillId: 'bill-2' }), true);
    expect(jest.mocked(sqliteSetMeta).mock.invocationCallOrder[0])
      .toBeLessThan(jest.mocked(createBill).mock.invocationCallOrder[0]);
    expect(removeOutboxSale).toHaveBeenCalledTimes(2);
  });

  it('creates a referenced product with its original opening stock before an earlier queued bill', async () => {
    jest.mocked(localListSyncQueue).mockResolvedValue([{
      id: 'later-create', entityType: 'product', entityId: 'local-p', op: 'create',
      createdAt: '2026-01-01T00:00:01Z', payload: { localInitialVariantStock: { 'local-v': 10 } },
    }]);
    jest.mocked(sqliteGetProduct).mockImplementation(async (id) => id === 'local-p' ? localProduct : null);
    jest.mocked(api.get).mockResolvedValue({ data: { data: { id: 'server-p', variants: [{ id: 'server-v' }] } } });

    await expect(flushOutbox()).resolves.toEqual({ synced: 2, failed: 0 });
    expect(api.post).toHaveBeenNthCalledWith(1, '/products/sync-catalog', expect.objectContaining({
      variants: [expect.objectContaining({ id: 'local-v', openingStock: 10 })],
    }));
    expect(jest.mocked(api.post).mock.invocationCallOrder[0])
      .toBeLessThan(jest.mocked(createBill).mock.invocationCallOrder[0]);
    expect(localMarkSyncQueueDone).toHaveBeenCalledWith('later-create');
  });

  it('does not upload a bill when the server does not acknowledge the identity protocol', async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { data: {
      productId: 'server-p', variants: [{ localId: 'local-v', variantId: 'server-v' }],
    } } });
    await expect(flushOutbox()).resolves.toEqual({ synced: 0, failed: 1 });
    expect(createBill).not.toHaveBeenCalled();
    expect(markOutboxSaleError).toHaveBeenCalledWith(sale, expect.stringContaining('Update the live server'), false);
  });

  it('only remaps product identifiers, not matching descriptive text', async () => {
    jest.mocked(listOutboxSales).mockResolvedValue([{
      ...sale, payload: { items: [{ variantId: 'local-v', productName: 'local-v' }], notes: 'local-v' },
    }]);
    await expect(flushOutbox()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(createBill).toHaveBeenCalledWith(expect.objectContaining({
      items: [{ variantId: 'server-v', productName: 'local-v' }], notes: 'local-v',
    }), true);
  });

  it('uploads explicit custom items without creating catalog products', async () => {
    jest.mocked(listOutboxSales).mockResolvedValue([{
      ...sale, payload: { items: [{ isCustom: true, productName: 'Open item', quantity: 1, unitPrice: 10 }] },
    }]);
    await expect(flushOutbox()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(api.post).not.toHaveBeenCalled();
    expect(createBill).toHaveBeenCalled();
  });

  it('records an explicitly verified mapping even when product IDs match', async () => {
    jest.mocked(api.post).mockResolvedValue({ data: { data: {
      identityProtocol: 1, productId: 'local-p', variants: [{ localId: 'local-v', variantId: 'server-v' }],
    } } });
    jest.mocked(createBill).mockImplementation(acceptOfflineBill);

    await expect(flushOutbox()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(sqliteSetMeta).toHaveBeenCalledWith(
      'product_sync_id_map', JSON.stringify({ 'local-v': 'server-v', 'local-p': 'local-p' }),
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
    jest.mocked(createBill).mockImplementation(acceptOfflineBill);

    await expect(flushOutbox()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(api.post).toHaveBeenCalledWith('/products/sync-catalog', expect.objectContaining({
      variants: [expect.objectContaining({
        id: 'local-v',
        barcodes: [{ barcode: '12345', quantity: null }, { barcode: '67890', quantity: 2 }],
      })],
    }));
    expect(jest.mocked(api.post).mock.invocationCallOrder[0])
      .toBeLessThan(jest.mocked(createBill).mock.invocationCallOrder[0]);
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
      identityProtocol: 1,
      productId: 'server-p',
      variants: [{ localId: 'local-v', variantId: 'server-v' }, { localId: 'local-v2', variantId: 'server-v2' }],
    } } });
    jest.mocked(createBill).mockImplementation(acceptOfflineBill);

    await expect(flushOutbox()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(sqliteSetMeta).toHaveBeenCalledWith(
      'product_sync_id_map', JSON.stringify({ 'local-v': 'server-v', 'local-v2': 'server-v2', 'local-p': 'server-p' }),
    );
    expect(api.post).toHaveBeenCalledWith('/products/sync-catalog', expect.objectContaining({
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
    jest.mocked(createBill).mockImplementation(acceptOfflineBill);

    await expect(flushOutbox()).rejects.toThrow('variants that are not yet synced');
    expect(localDeleteProduct).not.toHaveBeenCalled();
  });

  it('uses a saved mapping on a later sync attempt', async () => {
    jest.mocked(sqliteGetMeta).mockImplementation(async (key) => key === 'sync_device_id'
      ? 'device-1' : JSON.stringify({ 'local-v': 'server-v' }));
    jest.mocked(createBill).mockReset().mockImplementation(acceptOfflineBill);

    await expect(flushOutbox()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(createBill).toHaveBeenCalledWith(expect.objectContaining({
      items: [{ variantId: 'server-v' }], clientBillId: 'bill', billNumber: 'OFF-1', deviceId: 'device-1',
    }), true);
    expect(api.post).toHaveBeenCalledWith('/products/sync-catalog', expect.objectContaining({
      variants: [expect.objectContaining({ remoteVariantId: 'server-v' })],
    }));
  });

  it('continues with later sales after keeping an unmatched sale local-only', async () => {
    jest.mocked(api.post).mockRejectedValueOnce({ response: { status: 409, data: { error: { message: 'Cannot safely match' } } } });
    jest.mocked(listOutboxSales).mockResolvedValue([
      sale, { ...sale, clientBillId: 'bill-2', createdAt: '2026-01-01T00:00:01Z' },
    ]);
    jest.mocked(createBill).mockImplementation(acceptOfflineBill);

    await expect(flushOutbox()).resolves.toEqual({ synced: 1, failed: 0, skipped: 1 });
    expect(markOutboxSaleError).toHaveBeenCalledWith(sale, expect.stringContaining('Cannot safely match'), true);
    expect(removeOutboxSale).toHaveBeenCalledTimes(1);
    expect(removeOutboxSale).toHaveBeenCalledWith('bill-2', 'bill-2', expect.anything(), sale.payload);
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

  it('keeps a bill pending if the server does not acknowledge its original identity', async () => {
    jest.mocked(createBill).mockReset().mockResolvedValue({
      id: 'bill', bill_number: 'different-number', device_id: 'device-1',
    });
    await expect(flushOutbox()).resolves.toEqual({ synced: 0, failed: 1 });
    expect(removeOutboxSale).not.toHaveBeenCalled();
    expect(markOutboxSaleError).toHaveBeenCalledWith(sale, expect.stringContaining('Invalid identity acknowledgment'), false);
  });

  it('keeps a bill pending when the server does not support the new bill sync endpoint', async () => {
    jest.mocked(createBill).mockReset().mockRejectedValue({
      response: { status: 404, data: { error: { code: 'NOT_FOUND', message: 'Route not found' } } },
    });
    await expect(flushOutbox()).resolves.toEqual({ synced: 0, failed: 1 });
    expect(markOutboxSaleError).toHaveBeenCalledWith(sale, expect.stringContaining('Update the live server'), false);
  });

  it('keeps a rejected queue item local-only and continues to the next sale', async () => {
    const queued = { id: 'q-bad', entityType: 'product', entityId: 'missing-p', op: 'update',
      createdAt: '2025-12-31T23:59:59Z', payload: {} };
    jest.mocked(localListSyncQueue).mockResolvedValue([queued]);
    jest.mocked(api.put).mockRejectedValue({ response: { status: 422, data: { error: { message: 'Invalid product' } } } });
    jest.mocked(createBill).mockReset().mockImplementation(acceptOfflineBill);

    await expect(flushOutbox()).resolves.toEqual({ synced: 1, failed: 0, skipped: 1 });
    expect(localMarkSyncQueueError).toHaveBeenCalledWith('q-bad', expect.any(String), 1, true);
    expect(removeOutboxSale).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite server stock with an absolute product edit', async () => {
    jest.mocked(localListSyncQueue).mockResolvedValue([{
      id: 'q-stock-edit', entityType: 'product', entityId: 'local-p', op: 'update',
      createdAt: '2025-12-31T23:59:59Z', payload: { variants: [{ id: 'local-v', stockQty: 7 }] },
    }]);
    jest.mocked(listOutboxSales).mockResolvedValue([]);

    await expect(flushOutbox()).resolves.toEqual({ synced: 0, failed: 0, skipped: 1 });
    expect(api.put).not.toHaveBeenCalled();
    expect(localMarkSyncQueueError).toHaveBeenCalledWith(
      'q-stock-edit', expect.stringContaining('absolute stock edit'), 1, true,
    );
  });

  it('does not acknowledge a stock movement rejected as not found', async () => {
    jest.mocked(localListSyncQueue).mockResolvedValue([{
      id: 'q-stock', entityType: 'stock_movement', entityId: 'movement', op: 'in',
      createdAt: '2025-12-31T23:59:59Z', payload: {
        syncProtocol: 2, item: { variantId: 'local-v', quantity: 1 },
      },
    }]);
    jest.mocked(listOutboxSales).mockResolvedValue([]);
    jest.mocked(api.post).mockImplementation(async (url) => {
      if (url === '/products/sync-catalog') return { data: { data: {
        identityProtocol: 1, productId: 'server-p', variants: [{ localId: 'local-v', variantId: 'server-v' }],
      } } };
      throw { response: { status: 404, data: { error: { code: 'NOT_FOUND', message: 'Product variant not found' } } } };
    });

    await expect(flushOutbox()).resolves.toEqual({ synced: 0, failed: 0, skipped: 1 });
    expect(localMarkSyncQueueError).toHaveBeenCalledWith('q-stock', expect.any(String), 1, true);
    expect(localMarkSyncQueueDone).not.toHaveBeenCalled();
  });

  it('requires an idempotent acknowledgment before completing a new stock movement', async () => {
      jest.mocked(localListSyncQueue).mockResolvedValue([{
        id: 'q-stock', entityType: 'stock_movement', entityId: 'movement', op: 'in',
        createdAt: '2025-12-31T23:59:59Z', payload: {
          syncProtocol: 2, item: { variantId: 'local-v', quantity: 1 },
        },
      }]);
      jest.mocked(listOutboxSales).mockResolvedValue([]);
      let movementAttempts = 0;
      jest.mocked(api.post).mockImplementation(async (url) => {
        if (url === '/products/sync-catalog') return { data: { data: {
          identityProtocol: 1, productId: 'server-p', variants: [{ localId: 'local-v', variantId: 'server-v' }],
        } } };
        movementAttempts += 1;
        return { data: { data: movementAttempts === 1 ? {} : {
          clientMovementId: 'movement', movementId: 'live-movement', variantId: 'server-v', quantityChange: 1,
        } } };
      });

      await expect(flushOutbox()).resolves.toEqual({ synced: 0, failed: 1 });
      expect(localMarkSyncQueueDone).not.toHaveBeenCalled();
      await expect(flushOutbox()).resolves.toEqual({ synced: 1, failed: 0 });
      expect(api.post).toHaveBeenLastCalledWith('/stock/sync-movement', expect.objectContaining({
        clientMovementId: 'movement', operation: 'in', variantId: 'server-v', quantity: 1,
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

  it('stops when the verification endpoint fails instead of skipping the sale', async () => {
    jest.mocked(api.post).mockRejectedValue({ response: { status: 404, data: { error: { message: 'Endpoint unavailable' } } } });
    await expect(flushOutbox()).resolves.toEqual({ synced: 0, failed: 1 });
    expect(markOutboxSaleError).toHaveBeenCalledWith(sale, expect.stringContaining('Update the live server'), false);
  });

  it('keeps the bill pending after an interrupted product creation and retries with the same identity', async () => {
    jest.mocked(api.post).mockRejectedValueOnce(new Error('Network Error'));
    await expect(flushOutbox()).resolves.toEqual({ synced: 0, failed: 1 });
    expect(removeOutboxSale).not.toHaveBeenCalled();
    const firstRequest = jest.mocked(api.post).mock.calls[0];

    jest.mocked(createBill).mockReset().mockImplementation(acceptOfflineBill);
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
  jest.mocked(sqliteStatus).mockResolvedValue({ ok: true, localOnlyCount: 1, syncGuardVersion: 1 });
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

  jest.mocked(sqliteStatus).mockResolvedValue({ ok: true, localOnlyCount: 0, syncGuardVersion: 1 });
  jest.mocked(getShopSettings).mockResolvedValue({
    shopName: 'Live', shopNameMr: '', shopCode: 'test', address: '', addressMr: '', city: '',
    gstin: '', phone: '', billFooter: '', logoUrl: null, branchId: null, branchName: null,
  });
  jest.mocked(sqliteReplaceCatalogBatched).mockClear();
  jest.mocked(sqliteReplaceCatalogBatched).mockResolvedValue({ products: 1, categories: 0, brands: 0 });
  await expect(pullEverythingToSqlite()).resolves.not.toHaveProperty('errors');
  expect(sqliteReplaceCatalogBatched).toHaveBeenCalledWith(expect.objectContaining({
    syncStock: false,
    protectPending: true,
    products: [expect.objectContaining({ id: 'local-p', variants: [expect.objectContaining({ id: 'local-v' })] })],
  }));

  jest.mocked(sqliteStatus).mockResolvedValue({ ok: true, localOnlyCount: 1, syncGuardVersion: 1 });
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
