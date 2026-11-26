'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createBill } = require('../src/services/billingService');

const bill = {
  clientBillId: '11111111-1111-4111-8111-111111111111',
  syncRequireIdempotency: true,
  items: [{}],
  payments: [{}],
};

function dbWithIndexes(indexes) {
  return {
    SalesOrder: { findOne: async () => null },
    Offer: { findOne: async () => { throw new Error('continued'); } },
    sequelize: { getQueryInterface: () => ({ showIndex: async () => indexes }) },
  };
}

describe('offline bill retry safety', () => {
  it('refuses to create a bill without a unique client ID index', async () => {
    await assert.rejects(createBill(dbWithIndexes([]), 'branch', 'user', bill),
      (error) => error.code === 'SYNC_UNAVAILABLE');
    await assert.rejects(createBill(dbWithIndexes([{
      unique: true, fields: [{ attribute: 'client_bill_id' }, { attribute: 'branch_id' }],
    }]), 'branch', 'user', bill), (error) => error.code === 'SYNC_UNAVAILABLE');
  });

  it('continues when the client ID has a single-column unique index', async () => {
    const db = dbWithIndexes([{ unique: true, fields: [{ attribute: 'client_bill_id' }] }]);
    await assert.rejects(createBill(db, 'branch', 'user', { ...bill, offerId: 'offer' }), /continued/);
  });
});
