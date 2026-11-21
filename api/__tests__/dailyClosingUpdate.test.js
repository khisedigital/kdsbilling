'use strict';

const testRunner = require('node:test');
const describe = testRunner.describe || globalThis.describe;
const it = testRunner.it || globalThis.it;
const assert = require('node:assert');

const expenseService = require('../src/services/expenseService');
const AppError = require('../src/utils/AppError');

describe('updateDailyClosing', () => {
  const branchId = 'branch-123';
  const userId = 'user-456';
  const today = new Date().toISOString().slice(0, 10);

  function createMockDb(initialRecord) {
    let currentRecord = initialRecord
      ? {
          ...initialRecord,
          update: async function (updates) {
            Object.assign(this, updates);
            return this;
          },
        }
      : null;

    return {
      sequelize: {
        query: async (sql) => {
          if (sql.includes('sales_payments')) {
            return [{ mode: 'cash', total: 1000 }, { mode: 'upi', total: 500 }];
          }
          if (sql.includes('returns')) {
            return [{ total: 100 }];
          }
          return [];
        },
        QueryTypes: { SELECT: 'SELECT' },
      },
      Expense: {
        sum: async () => 50,
      },
      SalesOrder: {
        sum: async () => 1500,
      },
      DailyClosing: {
        findOne: async ({ where }) => {
          if (currentRecord && currentRecord.id === where.id && currentRecord.branch_id === where.branch_id) {
            return currentRecord;
          }
          return null;
        },
        findByPk: async (id) => {
          if (currentRecord && currentRecord.id === id) {
            return {
              ...currentRecord,
              creator: { id: userId, name: 'Cashier John' },
            };
          }
          return null;
        },
      },
      User: {},
    };
  }

  it('updates today\'s register successfully and recalculates expected cash', async () => {
    const existing = {
      id: 'closing-1',
      branch_id: branchId,
      closing_date: today,
      opening_cash: 500,
      expected_cash: 1350,
      actual_cash: 1350,
      variance: 0,
      total_sales: 1500,
      total_expenses: 50,
      notes: 'All good',
      details: JSON.stringify({
        version: 1,
        payments: { cash: 1000, upi: 500, card: 0, other: 0 },
        cashSales: 1000,
        cashRefunds: 100,
        cashExpenses: 50,
        cashAdded: 0,
        denominations: { '500': 2, '200': 1, '100': 1, '50': 1 },
      }),
      created_by: userId,
    };

    const mockDb = createMockDb(existing);

    // Sales cash: 1000, refunds: 100, expenses: 50
    // Opening: 600, Added: 200 => Expected: 600 + 1000 + 200 - 100 - 50 = 1650
    // Actual: 1650 (matched)
    const updated = await expenseService.updateDailyClosing(mockDb, branchId, userId, 'closing-1', {
      openingCash: 600,
      cashAdded: 200,
      actualCash: 1650,
      closingDate: today,
      denominations: { '500': 3, '100': 1, '50': 1 },
      notes: 'Updated opening float count',
    });

    assert.strictEqual(updated.id, 'closing-1');
    assert.strictEqual(updated.opening_cash, 600);
    assert.strictEqual(updated.expected_cash, 1650);
    assert.strictEqual(updated.actual_cash, 1650);
    assert.strictEqual(updated.variance, 0);
    assert.strictEqual(updated.details.cashAdded, 200);
    assert.deepStrictEqual(updated.details.denominations, { '500': 3, '100': 1, '50': 1 });
    assert.strictEqual(updated.details.remarks, 'Updated opening float count');
    assert.strictEqual(updated.details.lastEditedByUserId, userId);
  });

  it('rejects update if closing record is not found', async () => {
    const mockDb = createMockDb(null);

    await assert.rejects(
      async () => {
        await expenseService.updateDailyClosing(mockDb, branchId, userId, 'non-existent', {
          actualCash: 1000,
        });
      },
      (err) => {
        assert(err instanceof AppError);
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.code, 'NOT_FOUND');
        return true;
      }
    );
  });

  it('rejects update if closing record is not for today', async () => {
    const yesterdayRecord = {
      id: 'closing-yesterday',
      branch_id: branchId,
      closing_date: '2020-01-01',
      created_by: userId,
    };
    const mockDb = createMockDb(yesterdayRecord);

    await assert.rejects(
      async () => {
        await expenseService.updateDailyClosing(mockDb, branchId, userId, 'closing-yesterday', {
          actualCash: 1000,
        });
      },
      (err) => {
        assert(err instanceof AppError);
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.message, "Only today's register can be edited");
        return true;
      }
    );
  });

  it('requires varianceReason when cash does not match', async () => {
    const existing = {
      id: 'closing-2',
      branch_id: branchId,
      closing_date: today,
      opening_cash: 500,
      actual_cash: 1350,
      created_by: userId,
    };
    const mockDb = createMockDb(existing);

    // Expected: 500 + 1000 + 0 - 100 - 50 = 1350
    // Actual: 1300 (shortage of 50) without reason
    await assert.rejects(
      async () => {
        await expenseService.updateDailyClosing(mockDb, branchId, userId, 'closing-2', {
          openingCash: 500,
          cashAdded: 0,
          actualCash: 1300,
          varianceReason: '',
        });
      },
      (err) => {
        assert(err instanceof AppError);
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.message, 'Please enter a reason when cash does not match');
        return true;
      }
    );
  });

  it('accepts variance when reason is provided', async () => {
    const existing = {
      id: 'closing-3',
      branch_id: branchId,
      closing_date: today,
      opening_cash: 500,
      actual_cash: 1350,
      created_by: userId,
    };
    const mockDb = createMockDb(existing);

    const updated = await expenseService.updateDailyClosing(mockDb, branchId, userId, 'closing-3', {
      openingCash: 500,
      cashAdded: 0,
      actualCash: 1300,
      varianceReason: 'Short change given to customer',
    });

    assert.strictEqual(updated.variance, -50);
    assert.strictEqual(updated.details.varianceReason, 'Short change given to customer');
  });
});
