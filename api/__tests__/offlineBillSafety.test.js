'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createBill, syncOfflineBill } = require('../src/services/billingService');

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

  function syncDb() {
    const rows = [];
    const db = {
      SalesOrder: {
        findOne: async ({ where }) => rows.find((row) => row.client_bill_id === where.client_bill_id) || null,
        findByPk: async (id) => rows.find((row) => row.id === id) || null,
        create: async (data) => {
          const row = { ...data, items: [] };
          rows.push(row);
          return row;
        },
      },
      SalesOrderItem: {
        create: async (data) => {
          const item = { ...data, id: `item-${rows.length}` };
          rows.find((row) => row.id === data.sales_order_id).items.push(item);
          return item;
        },
      },
      SalesPayment: { create: async () => ({}) },
      sequelize: {
        getQueryInterface: () => ({
          describeTable: async () => ({ device_id: {}, sync_payload_hash: {} }),
          showIndex: async () => [{ unique: true, fields: [{ attribute: 'client_bill_id' }] }],
        }),
        transaction: async () => ({ LOCK: { UPDATE: 'UPDATE' }, commit: async () => {}, rollback: async () => {} }),
      },
    };
    return { db, rows };
  }

  const offlineBill = {
    clientBillId: '11111111-1111-4111-8111-111111111111',
    billNumber: 'OFF-003432',
    deviceId: 'POS-001',
    syncRequireIdempotency: true,
    items: [{ isCustom: true, productName: 'Open item', quantity: 1, unitPrice: 10 }],
    payments: [{ mode: 'cash', amount: 10 }],
    offlineTotals: {
      subtotal: 10, taxAmount: 0, discountAmount: 0, roundOffAmount: 0, totalAmount: 10,
      items: [{ quantity: 1, unitPrice: 10, discountAmount: 0, taxAmount: 0, lineTotal: 10 }],
    },
  };

  describe('offline bill identity', () => {
    it('preserves the displayed number and device across retries and devices', async () => {
      const { db, rows } = syncDb();
      const first = await syncOfflineBill(db, 'branch', 'user', offlineBill);
      const retried = await syncOfflineBill(db, 'branch', 'user', offlineBill);
      const second = await syncOfflineBill(db, 'branch', 'user', {
        ...offlineBill, clientBillId: '22222222-2222-4222-8222-222222222222', deviceId: 'POS-002',
      });
      assert.equal(first.id, offlineBill.clientBillId);
      assert.equal(retried.id, first.id);
      assert.equal(second.bill_number, first.bill_number);
      assert.equal(second.device_id, 'POS-002');
      assert.equal(rows.length, 2);
    });

    it('rejects reused IDs with different data and previously uploaded legacy identities', async () => {
      const { db, rows } = syncDb();
      await syncOfflineBill(db, 'branch', 'user', offlineBill);
      await assert.rejects(syncOfflineBill(db, 'branch', 'user', { ...offlineBill, deviceId: 'POS-002' }),
        (error) => error.code === 'SYNC_CONFLICT');
      rows[0].id = 'old-server-id';
      await assert.rejects(syncOfflineBill(db, 'branch', 'user', offlineBill),
        (error) => error.code === 'SYNC_CONFLICT');
      assert.equal(rows.length, 1);
    });

    it('does not save a bill whose offline totals differ from the live calculation', async () => {
      const { db, rows } = syncDb();
      await assert.rejects(syncOfflineBill(db, 'branch', 'user', {
        ...offlineBill, offlineTotals: { ...offlineBill.offlineTotals, totalAmount: 11 },
      }), (error) => error.code === 'SYNC_CONFLICT');
      assert.equal(rows.length, 0);
    });
  });

  it('continues when the client ID has a single-column unique index', async () => {
    const db = dbWithIndexes([{ unique: true, fields: [{ attribute: 'client_bill_id' }] }]);
    await assert.rejects(createBill(db, 'branch', 'user', { ...bill, offerId: 'offer' }), /continued/);
  });
});
