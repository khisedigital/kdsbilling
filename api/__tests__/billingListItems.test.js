'use strict';

const { listBills } = require('../src/services/billingService');

describe('listBills item details', () => {
  it('includes the item values needed to display synced bill details', async () => {
    const findAndCountAll = jest.fn().mockResolvedValue({ rows: [], count: 0 });
    const db = {
      SalesOrder: { findAndCountAll },
      Customer: {},
      SalesPayment: {},
      SalesOrderItem: {},
      SalesOrderItemTax: {},
      ProductVariant: {},
      Product: {},
      UnitOfMeasure: {},
    };

    await listBills(db, 'branch-1', {});

    const items = findAndCountAll.mock.calls[0][0].include.find((include) => include.as === 'items');
    expect(items.attributes).toEqual(expect.arrayContaining([
      'product_name',
      'sku',
      'quantity',
      'unit_price',
      'discount_amount',
      'tax_amount',
      'line_total',
    ]));
    expect(items.include.some((include) => include.as === 'variant')).toBe(true);
    expect(items.include.some((include) => include.as === 'taxes')).toBe(true);
  });
});
