'use strict';

const testRunner = require('node:test');
const describe = testRunner.describe || globalThis.describe;
const it = testRunner.it || globalThis.it;
const assert = require('node:assert/strict');
const { generatePrint } = require('../src/services/printService');

const tenant = { name: 'Test Shop', currency_code: 'INR', owner_mobile: '' };
const bill = (item) => ({
  bill_number: 'INV-1',
  createdAt: new Date('2026-11-24T05:00:00Z'),
  customer: { name: 'Customer', phone: '9876543210' },
  items: [item],
  subtotal: 100,
  discount_amount: 0,
  tax_amount: 5,
  round_off_amount: 0,
  total_amount: 105,
  payments: [],
  change_amount: 0,
});

describe('printed bill number', () => {
  it('shows the bill number on thermal and A4 receipts', async () => {
    const item = {
      product_name: 'Item',
      quantity: 1,
      unit_price: 100,
      line_total: 100,
    };

    const thermal = await generatePrint(bill(item), tenant, '80');
    assert.match(thermal.raw, /Bill No\s+INV-1/);

    const a4 = await generatePrint(bill(item), tenant, 'a4');
    assert.match(a4.html, /<strong>Bill No<\/strong> INV-1/);
    assert.match(a4.html, /<div class="customer-details">[\s\S]*Customer[\s\S]*Ph<\/strong> 9876543210/);
    assert.match(a4.html, /<div class="bill-identifiers">[\s\S]*Date<\/strong>[\s\S]*Bill No<\/strong> INV-1/);
  });

  it('omits the bill number when it is unavailable', async () => {
    const item = {
      product_name: 'Item',
      quantity: 1,
      unit_price: 100,
      line_total: 100,
    };
    const missingBillNumber = bill(item);
    delete missingBillNumber.bill_number;

    const thermal = await generatePrint(missingBillNumber, tenant, '80');
    assert.doesNotMatch(thermal.raw, /Bill No/);
  });
});

describe('print per-item tax details', () => {
  it('prints tax component names, rates, and amounts on thermal and A4 receipts', async () => {
    const item = {
      product_name: 'Taxable item',
      sku: 'SKU-1',
      quantity: 1,
      unit_price: 100,
      tax_amount: 5,
      line_total: 105,
      taxes: [
        { tax_name: 'CGST', rate_percent: 2.5, tax_amount: 2.5 },
        { tax_name: 'SGST', rate_percent: 2.5, tax_amount: 2.5 },
      ],
    };

    const thermal = await generatePrint(bill(item), tenant, '80');
    assert.match(thermal.raw, /Tax: CGST \(2\.5%\) Rs\.2\.50/);
    assert.match(thermal.raw, /Tax: SGST \(2\.5%\) Rs\.2\.50/);

    const a4 = await generatePrint(bill(item), tenant, 'a4');
    assert.match(a4.html, /CGST \(2\.5%\): ₹2\.50/);
    assert.match(a4.html, /SGST \(2\.5%\): ₹2\.50/);
    assert.match(a4.html, /padding:7px 6px;text-align:left;line-height:1\.35/);
  });

  it('shows the saved tax amount when component records are unavailable', async () => {
    const item = {
      product_name: 'Older taxable item',
      quantity: 1,
      unit_price: 100,
      tax_amount: 5,
      line_total: 105,
      taxes: [],
    };

    const thermal = await generatePrint(bill(item), tenant, '80');
    assert.match(thermal.raw, /Tax: Rs\.5\.00/);
  });
});
