jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));
jest.mock('../src/store/authStore', () => ({
  useAuthStore: { getState: () => ({ tenant: { id: 'shop' } }) },
}));
jest.mock('../src/offline/sqliteApi', () => ({ hasSqliteBridge: jest.fn() }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { hasSqliteBridge } from '../src/offline/sqliteApi';
import {
  applyCatalogPricePatches, readCachedProducts, subscribeCatalogChanges,
  upsertCachedProduct, writeCachedProducts,
} from '../src/services/catalogCache';
import type { Product } from '../src/types/catalog';

it('does not read or write desktop product caches but still notifies open screens', async () => {
  jest.mocked(hasSqliteBridge).mockReturnValue(true);
  const listener = jest.fn();
  const unsubscribe = subscribeCatalogChanges(listener);
  const product: Product = {
    id: 'p', name: 'Tea', uom_id: 'u', status: 'active', is_weight_based: false,
    allow_decimal_qty: false, has_variants: false,
    variants: [{ id: 'v', sku: 'TEA', cost_price: 5, selling_price: 10 }],
  };

  await writeCachedProducts([product], 1);
  await upsertCachedProduct(product);
  await applyCatalogPricePatches([{ variantId: 'v', sellingPrice: 20 }]);

  expect(await readCachedProducts()).toBeNull();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
});

it('retains the product cache outside desktop SQLite mode', async () => {
  jest.mocked(hasSqliteBridge).mockReturnValue(false);
  const product: Product = {
    id: 'mobile-p', name: 'Coffee', uom_id: 'u', status: 'active',
    is_weight_based: false, allow_decimal_qty: false, has_variants: false, variants: [],
  };
  await writeCachedProducts([product], 1);
  expect(AsyncStorage.setItem).toHaveBeenCalled();
  expect((await readCachedProducts())?.items).toEqual([product]);
});
