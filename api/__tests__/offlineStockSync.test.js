'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { recordSyncedMovement } = require('../src/services/stockService');

function makeDb() {
  const state = { quantity: 10, ledger: [] };
  const db = {
    ProductVariant: {
      findOne: async ({ where }) => where.id === 'variant' ? { id: 'variant' } : null,
    },
    StockBalance: {
      findOrCreate: async () => [{
        get quantity() { return state.quantity; },
        update: async ({ quantity }) => { state.quantity = quantity; },
      }],
    },
    StockLedger: {
      findOne: async ({ where }) => state.ledger.find((row) => row.client_movement_id === where.client_movement_id) || null,
      create: async (data) => {
        if (state.ledger.some((row) => row.client_movement_id === data.client_movement_id)) {
          const error = new Error('Duplicate movement');
          error.name = 'SequelizeUniqueConstraintError';
          throw error;
        }
        const row = { ...data, id: `ledger-${state.ledger.length + 1}` };
        state.ledger.push(row);
        return row;
      },
    },
    sequelize: {
      getQueryInterface: () => ({
        showIndex: async () => [{ unique: true, fields: [{ attribute: 'client_movement_id' }] }],
      }),
      transaction: async () => {
        const quantity = state.quantity;
        const ledger = [...state.ledger];
        return {
          LOCK: { UPDATE: 'UPDATE' },
          commit: async () => {},
          rollback: async () => { state.quantity = quantity; state.ledger = ledger; },
        };
      },
    },
  };
  return { db, state };
}

const movement = { clientMovementId: 'device-1-movement', operation: 'out', variantId: 'variant', quantity: 2 };

describe('offline stock movement sync', () => {
  it('applies a movement only once after an interrupted acknowledgment', async () => {
    const { db, state } = makeDb();
    const first = await recordSyncedMovement(db, 'branch', 'user', movement);
    const retried = await recordSyncedMovement(db, 'branch', 'user', movement);
    assert.deepEqual(retried, first);
    assert.equal(state.quantity, 8);
    assert.equal(state.ledger.length, 1);
  });

  it('applies distinct movements from multiple devices and rejects reused IDs', async () => {
    const { db, state } = makeDb();
    await recordSyncedMovement(db, 'branch', 'user', movement);
    await recordSyncedMovement(db, 'branch', 'user', { ...movement, clientMovementId: 'device-2-movement' });
    await assert.rejects(recordSyncedMovement(db, 'branch', 'user', { ...movement, quantity: 3 }),
      (error) => error.code === 'SYNC_CONFLICT');
    assert.equal(state.quantity, 6);
    assert.equal(state.ledger.length, 2);
  });

  it('does not apply anything when the unique migration is missing', async () => {
    const { db, state } = makeDb();
    db.sequelize.getQueryInterface = () => ({ showIndex: async () => [] });
    await assert.rejects(recordSyncedMovement(db, 'branch', 'user', movement),
      (error) => error.code === 'SYNC_UNAVAILABLE');
    assert.equal(state.quantity, 10);
    assert.equal(state.ledger.length, 0);
  });

  it('rolls back a rejected movement', async () => {
    const { db, state } = makeDb();
    await assert.rejects(recordSyncedMovement(db, 'branch', 'user', { ...movement, quantity: 20 }),
      (error) => error.code === 'INSUFFICIENT_STOCK');
    assert.equal(state.quantity, 10);
    assert.equal(state.ledger.length, 0);
  });
});
