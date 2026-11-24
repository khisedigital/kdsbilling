'use strict';

const testRunner = require('node:test');
const describe = testRunner.describe || globalThis.describe;
const it = testRunner.it || globalThis.it;
const assert = require('node:assert');

const productService = require('../src/services/productService');

describe('product barcode payloads', () => {
  it('accepts object-shaped plain barcodes when creating a product', async () => {
    const savedBarcodes = [];
    const transaction = {
      commit: async () => {},
      rollback: async () => {},
    };
    const db = {
      UnitOfMeasure: {
        findByPk: async () => ({ type: 'count' }),
      },
      Product: {
        create: async () => ({ id: 'product-1', name: 'Test product', uom_id: 'uom-1' }),
      },
      ProductVariant: {
        findOne: async () => null,
        create: async () => ({ id: 'variant-1' }),
      },
      Barcode: {
        findOne: async () => null,
        create: async (barcode) => {
          savedBarcodes.push(barcode);
          return { id: `barcode-${savedBarcodes.length}` };
        },
        findAll: async () => [],
      },
      sequelize: {
        transaction: async () => transaction,
      },
    };

    await productService.createProduct(
      db,
      {
        name: 'Test product',
        uomId: 'uom-1',
        variants: [{
          sellingPrice: 10,
          barcodes: [
            { barcode: '12345678', is_primary: true, quantity: null },
            { barcode: '12345679', is_primary: false, quantity: 2 },
          ],
          quantityBarcodes: [{ barcode: '12345679', quantity: 2 }],
        }],
      },
      { skipHydrate: true },
    );

    assert.strictEqual(savedBarcodes.length, 2);
    assert.strictEqual(savedBarcodes[0].barcode, '12345678');
    assert.strictEqual(savedBarcodes[0].is_primary, true);
    assert.strictEqual(savedBarcodes[1].barcode, '12345679');
    assert.strictEqual(savedBarcodes[1].quantity, 2);
    assert.strictEqual(savedBarcodes[1].is_primary, false);
  });
});
