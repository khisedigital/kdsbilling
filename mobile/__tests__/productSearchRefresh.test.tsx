import React from 'react';
import { act, create } from 'react-test-renderer';
import { Searchbar } from 'react-native-paper';
import ProductSearchField from '../src/components/ProductSearchField';
import { bumpCatalogRevision } from '../src/services/catalogCache';
import { searchProducts } from '../src/services/catalogService';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));
jest.mock('../src/store/authStore', () => ({
  useAuthStore: { getState: () => ({ tenant: { id: 'shop' } }) },
}));
jest.mock('../src/offline/sqliteApi', () => ({ hasSqliteBridge: () => true }));
jest.mock('../src/offline/localCatalog', () => ({
  shouldUseLocalCatalog: () => true,
  readSqliteBillingCatalog: jest.fn(async () => ({ items: [] })),
}));
jest.mock('../src/services/catalogService', () => ({
  searchProducts: jest.fn(),
  plainBarcodesOf: jest.fn(() => []),
  quantityBarcodesOf: jest.fn(() => []),
}));
jest.mock('react-native-paper', () => ({ Searchbar: 'Searchbar', Text: 'Text' }));
const mockTranslate = (text: string) => text;
jest.mock('../src/i18n', () => ({ useT: () => mockTranslate }));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

it('refreshes an open product search after a local catalog change', async () => {
  jest.useFakeTimers();
  jest.mocked(searchProducts).mockResolvedValueOnce([]).mockResolvedValueOnce([{
    variantId: 'v', productId: 'p', productName: 'Tea', sku: 'TEA', sellingPrice: 10,
    quantityBarcodes: [{ barcode: '1234567890123', quantity: 2 }],
  }]);
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(<ProductSearchField onSelect={jest.fn()} />);
  });
  await act(async () => {
    renderer!.root.findByType(Searchbar).props.onChangeText('1234567890123');
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(280);
  });
  expect(searchProducts).toHaveBeenCalledTimes(1);
  await act(async () => {
    bumpCatalogRevision();
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(280);
  });
  expect(searchProducts).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(renderer!.toJSON())).toContain('Tea');
  await act(async () => renderer!.unmount());
  jest.useRealTimers();
});
