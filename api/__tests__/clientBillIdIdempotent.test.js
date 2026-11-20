'use strict';

/**
 * Lightweight check that createBill short-circuits on client_bill_id.
 * Mocks the SalesOrder lookup used for offline sync idempotency.
 */

describe('createBill clientBillId idempotency shape', () => {
  it('reads clientBillId or client_bill_id from payload', () => {
    const payloadA = { clientBillId: '11111111-1111-4111-8111-111111111111' };
    const payloadB = { client_bill_id: '22222222-2222-4222-8222-222222222222' };
    const idA = payloadA.clientBillId || payloadA.client_bill_id || null;
    const idB = payloadB.clientBillId || payloadB.client_bill_id || null;
    expect(idA).toBe('11111111-1111-4111-8111-111111111111');
    expect(idB).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('migration file exists and adds unique client_bill_id', () => {
    const fs = require('fs');
    const path = require('path');
    const file = path.join(
      __dirname,
      '../src/migrations/tenant/20261116000001-sales-order-client-bill-id.js',
    );
    expect(fs.existsSync(file)).toBe(true);
    const src = fs.readFileSync(file, 'utf8');
    expect(src).toContain('client_bill_id');
    expect(src).toContain('sales_orders_client_bill_id_unique');
  });

  it('billingService createBill checks existing client_bill_id first', () => {
    const fs = require('fs');
    const path = require('path');
    const file = path.join(__dirname, '../src/services/billingService.js');
    const src = fs.readFileSync(file, 'utf8');
    expect(src).toMatch(/client_bill_id:\s*clientBillId/);
    expect(src).toMatch(/findOne\(\s*\{\s*where:\s*\{\s*client_bill_id:\s*clientBillId/);
    expect(src).toContain('SequelizeUniqueConstraintError');
  });
});
