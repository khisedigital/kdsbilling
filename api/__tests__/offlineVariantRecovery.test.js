'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ensureOfflineVariant } = require('../src/services/productService');

function fakeDb() {
  const rows = { products: [], variants: [], barcodes: [] };
  const product = (row) => row && Object.assign(row, {
    update: async (changes) => Object.assign(row, changes),
  });
  const db = {
    UnitOfMeasure: { findByPk: async (id) => id === 'unit' ? { id } : null },
    Product: {
      findByPk: async (id) => product(rows.products.find((row) => row.id === id)),
      create: async (data) => {
        rows.products.push({ ...data });
        return product(rows.products[rows.products.length - 1]);
      },
    },
    ProductVariant: {
      findByPk: async (id) => rows.variants.find((row) => row.id === id),
      findOne: async ({ where }) => rows.variants.find((row) => row.sku === where.sku),
      count: async ({ where }) => rows.variants.filter((row) => row.product_id === where.product_id && !row.deleted_at).length,
      create: async (data) => {
        rows.variants.push({ ...data });
        return rows.variants[rows.variants.length - 1];
      },
    },
    Barcode: {
      findOne: async ({ where }) => rows.barcodes.find((row) => row.barcode === where.barcode),
      findAll: async ({ where }) => rows.barcodes.filter((row) => row.variant_id === where.variant_id),
      create: async (data) => {
        rows.barcodes.push({ ...data });
        return rows.barcodes[rows.barcodes.length - 1];
      },
    },
    sequelize: {
      transaction: async () => {
        const snapshot = JSON.parse(JSON.stringify(rows));
        return {
          commit: async () => {},
          rollback: async () => {
            for (const key of Object.keys(rows)) rows[key].splice(0, rows[key].length, ...snapshot[key]);
          },
        };
      },
    },
  };
  return { db, rows };
}

const input = {
  product: { id: 'local-product', name: 'Tea', uomId: 'unit', hasVariants: false },
  variants: [{
    id: 'local-variant', sku: 'TEA', sellingPrice: 10,
    barcodes: [{ barcode: '12345678', quantity: null }, { barcode: '12345679', quantity: 2 }],
  }],
};

describe('offline missing variant recovery', () => {
  it('creates a product and variant once, retaining plain and pack barcodes with zero opening stock', async () => {
    const { db, rows } = fakeDb();
    const first = await ensureOfflineVariant(db, input);
    const second = await ensureOfflineVariant(db, input);
    assert.deepEqual(second, first);
    assert.equal(rows.products.length, 1);
    assert.equal(rows.variants.length, 1);
    assert.deepEqual(rows.barcodes.map(({ barcode, quantity }) => ({ barcode, quantity })), input.variants[0].barcodes);
    assert.equal(rows.variants[0].id, first.variants[0].variantId);
  });

  it('adds a missing variant to an existing product without changing existing variants', async () => {
    const { db, rows } = fakeDb();
    rows.products.push({ id: 'local-product', name: 'Tea', uom_id: 'unit' });
    rows.variants.push({ id: 'existing', product_id: 'local-product', sku: 'OLD' });
    const result = await ensureOfflineVariant(db, input);
    assert.equal(result.productId, 'local-product');
    assert.equal(rows.variants.length, 2);
    assert.equal(rows.variants[0].sku, 'OLD');
    assert.equal(rows.products[0].has_variants, true);
  });

  it('rejects a conflicting barcode or SKU without creating anything', async () => {
    const { db, rows } = fakeDb();
    rows.products.push({ id: 'other', name: 'Other', uom_id: 'unit' });
    rows.variants.push({ id: 'other-v', product_id: 'other', sku: 'OTHER' });
    rows.barcodes.push({ variant_id: 'other-v', barcode: '12345678', quantity: null });
    await assert.rejects(ensureOfflineVariant(db, input), (err) => err.code === 'SYNC_CONFLICT');
    assert.equal(rows.products.length, 1);
    assert.equal(rows.variants.length, 1);
    assert.equal(rows.barcodes.length, 1);
  });

  it('reuses an unambiguous existing SKU and barcode only when product identity matches', async () => {
    const { db, rows } = fakeDb();
    rows.products.push({ id: 'live-p', name: 'Tea', uom_id: 'unit' });
    rows.variants.push({ id: 'live-v', product_id: 'live-p', sku: 'TEA' });
    rows.barcodes.push({ variant_id: 'live-v', barcode: '12345678', quantity: null, is_primary: true });
    const result = await ensureOfflineVariant(db, input);
    assert.deepEqual(result, { productId: 'live-p', variants: [{ localId: 'local-variant', variantId: 'live-v' }] });
    assert.equal(rows.barcodes.length, 2);
    assert.equal(rows.products.length, 1);
  });

  it('finds an existing product through another variant before creating the missing one', async () => {
    const { db, rows } = fakeDb();
    rows.products.push({ id: 'live-p', name: 'Tea', uom_id: 'unit' });
    rows.variants.push({ id: 'live-v2', product_id: 'live-p', sku: 'TEA-2', size: 'large' });
    rows.barcodes.push({ variant_id: 'live-v2', barcode: '22345678', quantity: null, is_primary: true });
    const result = await ensureOfflineVariant(db, {
      ...input,
      variants: [...input.variants, {
        id: 'local-variant-2', sku: 'TEA-2', size: 'large', sellingPrice: 20,
        barcodes: [{ barcode: '22345678', quantity: null }],
      }],
    });
    assert.equal(result.productId, 'live-p');
    assert.equal(rows.products.length, 1);
    assert.equal(rows.variants.length, 2);
    assert.equal(result.variants[1].variantId, 'live-v2');
  });

  it('does not create a product if its variants belong to different live products', async () => {
    const { db, rows } = fakeDb();
    rows.products.push({ id: 'first', name: 'Tea', uom_id: 'unit' }, { id: 'second', name: 'Tea', uom_id: 'unit' });
    rows.variants.push({ id: 'first-v', product_id: 'first', sku: 'TEA' }, { id: 'second-v', product_id: 'second', sku: 'TEA-2' });
    rows.barcodes.push(
      { variant_id: 'first-v', barcode: '12345678', quantity: null },
      { variant_id: 'second-v', barcode: '22345678', quantity: null },
    );
    await assert.rejects(ensureOfflineVariant(db, {
      ...input,
      variants: [...input.variants, {
        id: 'local-variant-2', sku: 'TEA-2', sellingPrice: 20,
        barcodes: [{ barcode: '22345678', quantity: null }],
      }],
    }), (err) => err.code === 'SYNC_CONFLICT');
    assert.equal(rows.products.length, 2);
    assert.equal(rows.variants.length, 2);
  });

  it('respects a previously saved variant mapping without creating a duplicate', async () => {
    const { db, rows } = fakeDb();
    rows.products.push({ id: 'live-p', name: 'Tea', uom_id: 'unit' });
    rows.variants.push({ id: 'live-v', product_id: 'live-p', sku: 'OLD-SKU' });
    const result = await ensureOfflineVariant(db, {
      ...input,
      remoteProductId: 'live-p',
      variants: [{ ...input.variants[0], remoteVariantId: 'live-v' }],
    });
    assert.equal(result.variants[0].variantId, 'live-v');
    assert.equal(rows.variants.length, 1);
  });

  it('rolls back earlier variant creation when a later pack quantity conflicts', async () => {
    const { db, rows } = fakeDb();
    rows.products.push({ id: 'live-p', name: 'Tea', uom_id: 'unit' });
    rows.variants.push({ id: 'live-v2', product_id: 'live-p', sku: 'TEA-2' });
    rows.barcodes.push(
      { variant_id: 'live-v2', barcode: '22345678', quantity: null, is_primary: true },
      { variant_id: 'live-v2', barcode: '22345679', quantity: 3, is_primary: false },
    );
    await assert.rejects(ensureOfflineVariant(db, {
      ...input,
      variants: [...input.variants, {
        id: 'local-variant-2', sku: 'TEA-2', sellingPrice: 20,
        barcodes: [{ barcode: '22345678', quantity: null }, { barcode: '22345679', quantity: 2 }],
      }],
    }), (err) => err.code === 'SYNC_CONFLICT');
    assert.equal(rows.variants.length, 1);
    assert.equal(rows.barcodes.length, 2);
  });
});
