'use strict';

const testRunner = require('node:test');
const describe = testRunner.describe || globalThis.describe;
const it = testRunner.it || globalThis.it;
const assert = require('node:assert');

const {
  round2,
  round4,
  toPaise,
  fromPaise,
  toUnits4,
  fromUnits4,
  calculateLine,
  calculateBill,
} = require('../src/services/taxCalculator');

describe('Tax & Totals Rounding with Exact Integer/Decimal Math', () => {
  describe('round2 and round4 half-up precision', () => {
    it('correctly rounds tricky floating-point numbers like 1.005 and 1.155 to nearest paisa', () => {
      // In vanilla JS: Math.round(1.005 * 100) / 100 === 1.00 (loses 1 paisa!)
      assert.strictEqual(round2(1.005), 1.01);
      assert.strictEqual(round2(1.055), 1.06);
      assert.strictEqual(round2(1.155), 1.16);
      assert.strictEqual(round2(35.55), 35.55);
      assert.strictEqual(round2(-1.005), -1.01);
      assert.strictEqual(round2(0), 0);
      assert.strictEqual(round2(null), 0);
      assert.strictEqual(round2(NaN), 0);
    });

    it('correctly rounds 4-decimal values without floating-point drift', () => {
      assert.strictEqual(round4(1.00005), 1.0001);
      assert.strictEqual(round4(0.49975), 0.4998);
      assert.strictEqual(round4(0.12344), 0.1234);
      assert.strictEqual(round4(null), 0);
    });
  });

  describe('integer paise math across split payments', () => {
    it('sums split payments without floating point accumulation error (e.g. 10.10 + 20.20)', () => {
      // Vanilla JS: 10.10 + 20.20 === 30.299999999999997
      const payments = [{ amount: '10.10' }, { amount: '20.20' }];
      const paidPaise = payments.reduce((s, p) => s + toPaise(p.amount), 0);
      assert.strictEqual(paidPaise, 3030);
      assert.strictEqual(fromPaise(paidPaise), 30.30);
    });

    it('sums 3-way split payments to exact 100.00 without floating point leak', () => {
      // Vanilla JS: 33.33 + 33.33 + 33.34 === 100.00000000000001
      const payments = [{ amount: '33.33' }, { amount: '33.33' }, { amount: '33.34' }];
      const paidPaise = payments.reduce((s, p) => s + toPaise(p.amount), 0);
      assert.strictEqual(paidPaise, 10000);
      assert.strictEqual(fromPaise(paidPaise), 100.00);

      const totalPaise = toPaise(100.00);
      assert.strictEqual(paidPaise < totalPaise, false);
      assert.strictEqual(fromPaise(Math.max(0, paidPaise - totalPaise)), 0);
    });

    it('handles store credit deductions in exact integer paise', () => {
      const balancePaise = toPaise('150.75');
      const usedPaise = toPaise('50.50');
      const newBalancePaise = balancePaise - usedPaise;
      assert.strictEqual(newBalancePaise, 10025);
      assert.strictEqual(fromPaise(newBalancePaise), 100.25);
    });
  });

  describe('multi-line taxes and bill calculation', () => {
    it('sums custom lines and computes exact totals in paise', async () => {
      const db = {};
      const payload = {
        items: [
          { isCustom: true, productName: 'Item A', quantity: 1, unitPrice: '10.10' },
          { isCustom: true, productName: 'Item B', quantity: 2, unitPrice: '20.20' },
        ],
        billDiscountAmount: 0,
        roundOffAmount: 0,
      };

      const result = await calculateBill(db, payload);
      assert.strictEqual(result.subtotal, 50.50);
      assert.strictEqual(result.taxAmount, 0);
      assert.strictEqual(result.exactTotal, 50.50);
      assert.strictEqual(result.totalAmount, 50.50);
    });

    it('handles line percentage discount with exact rounding', async () => {
      const db = {};
      const payload = {
        items: [
          { isCustom: true, productName: 'Item C', quantity: 3, unitPrice: '33.33', discountPercent: 10 },
        ],
        billDiscountAmount: 0,
        roundOffAmount: 0,
      };

      const result = await calculateBill(db, payload);
      // 3 * 33.33 = 99.99
      // discount 10% = 9.999
      // taxable = 99.99 - 9.999 = 89.991
      // exactTotal rounded to 2 decimals = 89.99
      assert.strictEqual(result.exactTotal, 89.99);
      assert.strictEqual(result.totalAmount, 89.99);
    });

    it('applies round-off to exact paisa without float residual', async () => {
      const db = {};
      const payload = {
        items: [
          { isCustom: true, productName: 'Item D', quantity: 1, unitPrice: '99.40' },
        ],
        roundOffAmount: '0.60',
      };

      const result = await calculateBill(db, payload);
      assert.strictEqual(result.exactTotal, 99.40);
      assert.strictEqual(result.roundOffAmount, 0.60);
      assert.strictEqual(result.totalAmount, 100.00);
    });
  });
});
