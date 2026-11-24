'use strict';

const testRunner = require('node:test');
const describe = testRunner.describe || globalThis.describe;
const it = testRunner.it || globalThis.it;
const assert = require('node:assert');

const productService = require('../src/services/productService');

describe('product list tax metadata', () => {
  it('includes variant tax groups in the full product list used by sync', async () => {
    let listOptions;
    const Product = {
      describe: async () => ({ is_favorite: {} }),
      findAll: async (options) => {
        listOptions = options;
        return [];
      },
      count: async () => 0,
    };
    const db = {
      Product,
      Category: {},
      Brand: {},
      UnitOfMeasure: {},
      TaxGroup: {},
      ProductVariant: {},
      Barcode: {},
      ProductImage: {},
    };

    await productService.listProducts(db, { page: 1, limit: 10 });

    const variantsInclude = listOptions.include.find((include) => include.as === 'variants');
    assert.ok(
      variantsInclude.include.some((include) => include.as === 'taxGroup'),
      'full product sync must return each variant tax group',
    );
  });
});
