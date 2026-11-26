jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
  multiGet: jest.fn(async () => []),
}));
jest.mock('../src/services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
jest.mock('../src/services/catalogCache', () => ({
  isCatalogCacheEnabled: jest.fn(() => false),
  bumpCatalogRevision: jest.fn(),
  applyCatalogPricePatches: jest.fn(async () => {}),
  invalidateCachedProducts: jest.fn(async () => {}),
  invalidateCatalogCache: jest.fn(async () => {}),
  patchCachedProductFavorite: jest.fn(async () => {}),
  patchCachedProductsFavoriteByCategory: jest.fn(async () => {}),
  upsertCachedProduct: jest.fn(async () => {}),
}));
jest.mock('../src/offline/localCatalog', () => ({
  shouldUseLocalCatalog: jest.fn(() => true),
  searchSqliteProducts: jest.fn(),
}));
jest.mock('../src/desktop/bridge', () => ({ getDesktopBridge: jest.fn(() => null) }));
jest.mock('../src/offline/sqliteApi', () => ({
  hasSqliteBridge: jest.fn(() => true),
  sqliteListProducts: jest.fn(),
  sqliteGetProduct: jest.fn(),
  sqliteGenerateBarcodes: jest.fn(),
  sqliteEnsureQuantityBarcodes: jest.fn(),
  sqliteGetProductBarcodeStatus: jest.fn(),
}));
jest.mock('../src/offline/localApi', () => ({
  isFullyLocalMode: jest.fn(() => true),
  localUpsertProduct: jest.fn(async () => ({ ok: true, id: 'p' })),
  localUpsertProductsAndQueue: jest.fn(async () => ({ ok: true, id: 'queue' })),
  localEnqueueSync: jest.fn(async () => ({ ok: true, id: 'queue' })),
  localDeleteAllProducts: jest.fn(async () => ({ deleted: 2 })),
}));

import api from '../src/services/api';
import {
  bulkUpdateVariantPricing,
  deleteAllProducts,
  fetchProduct,
  fetchProducts,
  fetchAllProducts,
  generateBarcodes,
  ensureQuantityBarcodes,
  updateProduct,
} from '../src/services/catalogService';
import { localUpsertProductsAndQueue } from '../src/offline/localApi';
import { sqliteEnsureQuantityBarcodes, sqliteGenerateBarcodes, sqliteGetProduct, sqliteListProducts } from '../src/offline/sqliteApi';
import { bumpCatalogRevision } from '../src/services/catalogCache';

beforeEach(() => jest.clearAllMocks());

it('does not silently return a partial live catalog during sync', async () => {
  jest.mocked(api.get).mockReset()
    .mockResolvedValueOnce({ data: { data: {
      items: [{ id: 'p', variants: [{ id: 'v' }] }],
      pagination: { page: 1, limit: 1, total: 2, totalPages: 2 },
    } } })
    .mockRejectedValueOnce(new Error('page failed'));
  await expect(fetchAllProducts({ forceNetwork: true, preferFull: true, requireComplete: true }))
    .rejects.toThrow('page failed');
});

it('reports local lookup failures without falling back to the product API', async () => {
  jest.mocked(sqliteListProducts).mockRejectedValue(new Error('database unavailable'));
  jest.mocked(sqliteGetProduct).mockResolvedValue(null);
  jest.mocked(sqliteGenerateBarcodes).mockRejectedValue(new Error('barcode write failed'));
  await expect(fetchProducts()).rejects.toThrow('database unavailable');
  await expect(fetchProduct('missing')).rejects.toThrow('Product not found in local database');
  await expect(generateBarcodes(['v'])).rejects.toThrow('barcode write failed');
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});

it('saves price changes locally and queues them even while online', async () => {
  jest.mocked(sqliteGetProduct).mockResolvedValue({
    id: 'p', name: 'Tea', uom_id: 'u', variants: [{ id: 'v', selling_price: 10, sku: 'TEA' }],
  });
  await expect(bulkUpdateVariantPricing([{ productId: 'p', variantId: 'v', sellingPrice: 20 }]))
    .resolves.toEqual({ updated: 1 });
  expect(localUpsertProductsAndQueue).toHaveBeenCalledWith(
    [expect.objectContaining({ variants: [expect.objectContaining({ id: 'v', selling_price: 20 })] })],
    expect.objectContaining({ entityType: 'price_bulk' }),
  );
  expect(api.post).not.toHaveBeenCalled();
});

it('deletes products locally without calling delete-all on the server', async () => {
  await expect(deleteAllProducts()).resolves.toEqual({ deleted: 2 });
  expect(api.post).not.toHaveBeenCalled();
});

it('preserves other variants when a local append edit updates one variant', async () => {
  jest.mocked(sqliteGetProduct).mockResolvedValue({
    id: 'p', name: 'Tea', uom_id: 'u',
    variants: [
      { id: 'v1', sku: 'SMALL', selling_price: 10 },
      { id: 'v2', sku: 'LARGE', selling_price: 20 },
    ],
  });

  const updated = await updateProduct('p', {
    variantSyncMode: 'append', variants: [{ id: 'v1', sellingPrice: 15 }],
  });
  expect(updated.variants).toEqual([
    expect.objectContaining({ id: 'v1', selling_price: 15 }),
    expect.objectContaining({ id: 'v2', selling_price: 20 }),
  ]);
  expect(api.put).not.toHaveBeenCalled();
});

it('notifies open screens after newly generated unit and pack barcodes are committed', async () => {
  jest.mocked(sqliteGenerateBarcodes).mockResolvedValue([{ variantId: 'v', barcode: '123', generated: true }]);
  jest.mocked(sqliteEnsureQuantityBarcodes).mockResolvedValue([
    { variantId: 'v', quantity: 2, barcode: '456', generated: true },
  ]);
  await generateBarcodes(['v']);
  await ensureQuantityBarcodes([{ variantId: 'v', quantity: 2 }]);
  expect(bumpCatalogRevision).toHaveBeenCalledTimes(2);
  jest.mocked(sqliteEnsureQuantityBarcodes).mockResolvedValue([
    { variantId: 'v', quantity: 2, barcode: '456', generated: false },
  ]);
  await ensureQuantityBarcodes([{ variantId: 'v', quantity: 2 }]);
  expect(bumpCatalogRevision).toHaveBeenCalledTimes(2);
});
