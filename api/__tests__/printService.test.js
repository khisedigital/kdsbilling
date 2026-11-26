'use strict';

const testRunner = require('node:test');
const describe = testRunner.describe || globalThis.describe;
const it = testRunner.it || globalThis.it;
const assert = require('node:assert/strict');
const { generatePrint, thermalMarkupToEscPos } = require('../src/services/printService');
const qrcode = require('qrcode-generator');

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
    const narrow = await generatePrint(bill(item), tenant, '58');
    assert.match(narrow.raw, /Tax[^\n]*\n\n<B>TOTAL/);

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

describe('UPI payment QR', () => {
    const item = { product_name: 'Item', quantity: 1, unit_price: 100, line_total: 100 };
    const settings = { upiId: ' shop@bank ', shopName: 'Test Shop' };

    it('encodes the bill total and prints the QR in thermal and A4 outputs', async () => {
      const sale = { ...bill(item), total_amount: 123.45 };
      for (const format of ['58', '80']) {
        const receipt = await generatePrint(sale, tenant, format, settings);
        assert.equal(receipt.paymentQrData, 'upi://pay?pa=shop%40bank&pn=Test%20Shop&am=123.45&cu=INR');
        const bytes = thermalMarkupToEscPos(receipt.raw, receipt.paymentQrData, receipt.charsPerLine);
        assert.notEqual(bytes.indexOf(Buffer.from([0x1d, 0x76, 0x30, 0])), -1);
        assert.deepEqual([...bytes.subarray(-3)], [0x1d, 0x56, 0]);
      }
      const a4 = await generatePrint(sale, tenant, 'a4', settings);
      const qr = qrcode(0, 'M');
      qr.addData('upi://pay?pa=shop%40bank&pn=Test%20Shop&am=123.45&cu=INR');
      qr.make();
      assert.ok(a4.html.includes(qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true })));
      assert.doesNotMatch(a4.html, /api\.qrserver\.com/);
      const changed = await generatePrint({ ...sale, total_amount: 67 }, tenant, '58', settings);
      assert.match(changed.paymentQrData, /am=67\.00/);
    });

    it('omits the QR when UPI is hidden or the total is not payable', async () => {
      for (const [shop, total] of [
        [{}, 105],
        [{ ...settings, showUpi: false }, 105],
        [settings, 0],
        [settings, -1],
        [settings, 'invalid'],
      ]) {
        const receipt = await generatePrint({ ...bill(item), total_amount: total }, tenant, '58', shop);
        assert.equal(receipt.paymentQrData, '');
        const a4 = await generatePrint({ ...bill(item), total_amount: total }, tenant, 'a4', shop);
        assert.doesNotMatch(a4.html, /<svg/);
      }
    });
});
