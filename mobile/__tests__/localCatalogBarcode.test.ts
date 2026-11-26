jest.mock('../src/offline/sqliteApi', () => ({
  hasSqliteBridge: jest.fn(() => true),
  sqliteListProducts: jest.fn(),
}));

jest.mock('../src/services/catalogService', () => ({
  fetchUnits: jest.fn(async () => [{ id: 'unit', code: 'kg', name: 'Kilogram', type: 'weight' }]),
  attachUnitsToProducts: jest.fn((products) => products.map((product: object) => ({
    ...product,
    uom_id: 'unit',
  }))),
}));

jest.mock('../src/offline/localApi', () => ({
  localUpsertProduct: jest.fn(),
}));

import { searchSqliteProducts } from '../src/offline/localCatalog';
import { sqliteListProducts } from '../src/offline/sqliteApi';
import { localUpsertProduct } from '../src/offline/localApi';

it('searches SQLite for a new pack barcode without writing a stale product back', async () => {
  jest.mocked(sqliteListProducts).mockResolvedValue({
    total: 1,
    items: [{
      id: 'product',
      name: 'Rice',
      variants: [{
        id: 'variant',
        sku: 'RICE',
        barcodes: [
          { barcode: '2000000000001', quantity: null, is_primary: true },
          { barcode: '2000000000002', quantity: 2.5 },
        ],
      }],
    }],
  });

  const results = await searchSqliteProducts('2000000000002');

  expect(sqliteListProducts).toHaveBeenCalledWith({
    search: '2000000000002', limit: 400, offset: 0,
  });
  expect(results[0]).toMatchObject({
    variantId: 'variant',
    barcodes: ['2000000000001'],
    quantityBarcodes: [{ barcode: '2000000000002', quantity: 2.5 }],
    scannedQuantity: 2.5,
  });
  expect(localUpsertProduct).not.toHaveBeenCalled();
});
