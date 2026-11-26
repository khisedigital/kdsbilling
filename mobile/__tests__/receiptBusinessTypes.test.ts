jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { buildThermalReceipt, buildA4Receipt, buildReceiptPayload } from '../src/print/buildReceipt';
import { buildEscPosBytes } from '../src/print/escpos';
import { insertPaymentQr, paymentQrSvg } from '../src/print/qrCodeGenerator';
import type { ShopSettings } from '../src/services/shopSettingsService';
import type { BillDetail } from '../src/services/businessService';

describe('Receipt business types & registration fields', () => {
  const dummyBill: BillDetail = {
    id: 'b1',
    bill_number: 'INV-001',
    created_at: '2026-11-23T10:00:00Z',
    customer: { id: 'c1', name: 'Ramesh Patel', phone: '9876543210' },
    subtotal: 500,
    discount_amount: 50,
    tax_amount: 25,
    round_off_amount: 0,
    total_amount: 475,
    items: [
      {
        id: 'i1',
        product_name: 'Cotton Shirt L',
        quantity: 2,
        unit_price: 250,
        line_total: 500,
      },
    ],
    payments: [{ id: 'p1', payment_mode: 'upi', amount: 475 }],
  };

  test('prints standard GSTIN on thermal and A4 bill', () => {
    const shop: ShopSettings = {
      shopName: 'Shree Fashion Hub',
      shopNameMr: 'श्री फॅशन हब',
      shopCode: 'sfh',
      address: 'Shop 12, Main Road',
      addressMr: '',
      city: 'Pune',
      gstin: '27AABCU9603R1ZM',
      phone: '9822000000',
      billFooter: 'Thank you!',
      logoUrl: null,
      branchId: 'b1',
      branchName: 'Main',
      businessType: 'clothing',
    };

    const thermal = buildThermalReceipt(dummyBill, shop, 32);
    expect(thermal).toContain('GSTIN: 27AABCU9603R1ZM');
    expect(thermal).toContain('SHREE FASHION HUB');
    expect(thermal).toContain('TAX INVOICE');

    const a4 = buildA4Receipt(dummyBill, shop);
    expect(a4).toContain('GSTIN: 27AABCU9603R1ZM');
    expect(a4).toContain('TAX INVOICE');
  });

  test('shows customer details left and bill date and number right on A4', () => {
    const a4 = buildA4Receipt(dummyBill, null);

    expect(a4).toMatch(/<div class="customerInfo">[\s\S]*Customer[\s\S]*Ramesh Patel[\s\S]*Ph<\/strong> 9876543210/);
    expect(a4).toMatch(/<div class="billMeta">[\s\S]*Date[\s\S]*Bill No[\s\S]*INV-001/);
  });

  test('separates the total on both paper sizes while keeping 58mm compact', () => {
    const shop: ShopSettings = {
      shopName: 'Test Shop',
      shopNameMr: '',
      shopCode: 'test',
      address: '',
      addressMr: '',
      phone: '1234567890',
      gstin: '27TEST1234A1Z1',
      billFooter: 'Thanks',
      logoUrl: null,
      branchId: 'b1',
      branchName: 'Main',
      businessType: 'clothing',
    };
    const wide = buildThermalReceipt({ ...dummyBill, items: [...dummyBill.items!, ...dummyBill.items!] }, shop, 48)
      .replace(/<\/?[A-Z]+>/g, '');
    const narrow = buildThermalReceipt({ ...dummyBill, items: [...dummyBill.items!, ...dummyBill.items!] }, shop, 32);

    expect(wide).toMatch(/1234567890.*\n\nGSTIN: 27TEST1234A1Z1/);
    expect(wide).toMatch(/Date.*\n\nCustomer/);
    expect(wide).toMatch(/Discount.*\n\nTax/);
    expect(wide).toMatch(/Tax.*\n\nTOTAL/);
    expect(wide).toMatch(/Cotton Shirt L.*\n\nCotton Shirt L/);
    expect(narrow).toMatch(/Tax.*\n\nTOTAL/);
    expect(narrow.match(/\n\n/g)).toHaveLength(1);
  });

  test('uses the existing UPI setting and each bill total for offline QR printing', () => {
    const shop: ShopSettings = {
      shopName: 'Test Shop', shopNameMr: '', shopCode: 'test',
      address: '', addressMr: '', city: '', gstin: '', phone: '',
      billFooter: '', logoUrl: null, branchId: 'b1', branchName: 'Main',
      upiId: ' shop@bank ',
    };
    for (const format of ['58', '80'] as const) {
      const payload = buildReceiptPayload({ ...dummyBill, total_amount: 123.45 }, shop, format);
      expect(payload.paymentQrData).toBe('upi://pay?pa=shop%40bank&pn=Test%20Shop&am=123.45&cu=INR');
      expect(payload.html).toContain(paymentQrSvg(payload.paymentQrData!));
      const bytes = buildEscPosBytes(payload.raw!, payload.charsPerLine!, format);
      const printed = insertPaymentQr(bytes, payload.paymentQrData!, payload.charsPerLine!);
      const tailLength = format === '58' ? 4 : 9;
      expect(printed.slice(-tailLength)).toEqual(bytes.slice(-tailLength));
      expect(printed.slice(bytes.length - tailLength, bytes.length - tailLength + 4))
        .toEqual([0x1d, 0x76, 0x30, 0]);
    }

    const changed = buildReceiptPayload({ ...dummyBill, total_amount: 67 }, shop, '58');
    expect(changed.paymentQrData).toContain('am=67.00');
    const a4 = buildA4Receipt({ ...dummyBill, total_amount: 123.45 }, shop);
    expect(a4).toContain(paymentQrSvg(changed.paymentQrData!.replace('am=67.00', 'am=123.45')));
    expect(a4).not.toContain('api.qrserver.com');
    for (const disabled of [{ ...shop, upiId: '' }, { ...shop, showUpi: false }]) {
      expect(buildReceiptPayload(dummyBill, disabled, '58').paymentQrData).toBe('');
      expect(buildA4Receipt(dummyBill, disabled)).not.toContain('<svg');
    }
    for (const total of [0, -1, NaN]) {
      expect(buildReceiptPayload({ ...dummyBill, total_amount: total }, shop, '80').paymentQrData).toBe('');
    }
  });

  test('inserts payment QR before the native receipt feed and cut', () => {
    const nativeTail = [10, 10, 10, 10, 10, 10, 0x1d, 0x56, 1];
    const bytes = [0x1b, 0x40, 65, 10, ...nativeTail];
    const result = insertPaymentQr(bytes, 'upi://pay?pa=shop%40bank&am=1.00&cu=INR', 32);
    expect(result.slice(0, 4)).toEqual(bytes.slice(0, 4));
    expect(result.slice(-nativeTail.length)).toEqual(nativeTail);
    expect(() => insertPaymentQr([1, 2, 3], 'upi://pay', 32)).toThrow('unrecognized receipt feed');
  });

  test('prints item tax names, rates, and amounts on thermal and A4 receipts', () => {
    const taxableBill: BillDetail = {
      ...dummyBill,
      tax_amount: 2.5,
      total_amount: 502.5,
      items: [{
        ...dummyBill.items![0],
        tax_amount: 2.5,
        line_total: 502.5,
        taxes: [
          { tax_name: 'CGST', rate_percent: 2.5, tax_amount: 1.25 },
          { tax_name: 'SGST', rate_percent: 2.5, tax_amount: 1.25 },
        ],
      }],
    };

    const thermal = buildThermalReceipt(taxableBill, null, 32);
    expect(thermal).toContain('Tax: CGST (2.5%) 1.25');
    expect(thermal).toContain('Tax: SGST (2.5%) 1.25');

    const a4 = buildA4Receipt(taxableBill, null);
    expect(a4).toContain('CGST (2.5%): Rs.1.25');
    expect(a4).toContain('SGST (2.5%): Rs.1.25');
  });

  test('prints FSSAI license for food / restaurant business', () => {
    const shop: ShopSettings = {
      shopName: 'Green Spice Cafe',
      shopNameMr: '',
      shopCode: 'gsc',
      address: 'FC Road',
      addressMr: '',
      city: 'Pune',
      gstin: '',
      fssai: '11521000000123',
      phone: '9822111111',
      billFooter: 'Visit Again!',
      logoUrl: null,
      branchId: 'b1',
      branchName: 'Main',
      businessType: 'restaurant',
      invoiceTitle: 'CASH MEMO',
      tagline: 'Authentic Indian Flavours',
      upiId: 'greenspice@upi',
      terms: 'Food once served cannot be returned.',
    };

    const thermal = buildThermalReceipt(dummyBill, shop, 32);
    expect(thermal).toContain('FSSAI: 11521000000123');
    expect(thermal).toContain('Authentic Indian Flavours');
    expect(thermal).toContain('CASH MEMO');
    expect(thermal).toContain('UPI: greenspice@upi');
    expect(thermal).toContain('Food once served');

    const a4 = buildA4Receipt(dummyBill, shop);
    expect(a4).toContain('FSSAI: 11521000000123');
    expect(a4).toContain('Authentic Indian Flavours');
    expect(a4).toContain('CASH MEMO');
    expect(a4).toContain('UPI ID');
    expect(a4).toContain('greenspice@upi');
    expect(a4).toContain('Food once served cannot be returned.');
  });

  test('prints Drug License for pharmacy business', () => {
    const shop: ShopSettings = {
      shopName: 'City Medical Store',
      shopNameMr: '',
      shopCode: 'cms',
      address: 'Hospital Square',
      addressMr: '',
      city: 'Mumbai',
      gstin: '27AABCU0000R1Z1',
      drugLicense: 'MH-MZ1-20B-9988',
      phone: '9833000000',
      billFooter: 'Get well soon!',
      logoUrl: null,
      branchId: 'b1',
      branchName: 'Main',
      businessType: 'pharmacy',
      invoiceTitle: 'RETAIL INVOICE',
      terms: 'Medicines once sold cannot be returned without bill.',
    };

    const thermal = buildThermalReceipt(dummyBill, shop, 32);
    expect(thermal).toContain('GSTIN: 27AABCU0000R1Z1');
    expect(thermal).toContain('D.L. No: MH-MZ1-20B-9988');
    expect(thermal).toContain('RETAIL INVOICE');
    expect(thermal).toContain('Medicines once sold');

    const a4 = buildA4Receipt(dummyBill, shop);
    expect(a4).toContain('GSTIN: 27AABCU0000R1Z1');
    expect(a4).toContain('D.L. No: MH-MZ1-20B-9988');
    expect(a4).toContain('RETAIL INVOICE');
    expect(a4).toContain('Medicines once sold cannot be returned without bill.');
  });

  test('prints Trade License, PAN, and Bill of Supply for composition dealer', () => {
    const shop: ShopSettings = {
      shopName: 'Ganesh General Stores',
      shopNameMr: '',
      shopCode: 'ggs',
      address: 'Station Road',
      addressMr: '',
      city: 'Nagpur',
      gstin: '27ABCDE1234F1Z5',
      tradeLicense: 'TR-NGP-4567',
      pan: 'ABCDE1234F',
      phone: '9844000000',
      billFooter: 'Thank you!',
      logoUrl: null,
      branchId: 'b1',
      branchName: 'Main',
      businessType: 'grocery',
      invoiceTitle: 'BILL OF SUPPLY',
    };

    const thermal = buildThermalReceipt(dummyBill, shop, 32);
    expect(thermal).toContain('GSTIN: 27ABCDE1234F1Z5');
    expect(thermal).toContain('Lic / Reg No: TR-NGP-4567');
    expect(thermal).toContain('PAN: ABCDE1234F');
    expect(thermal).toContain('BILL OF SUPPLY');

    const a4 = buildA4Receipt(dummyBill, shop);
    expect(a4).toContain('BILL OF SUPPLY');
    expect(a4).toContain('Lic / Reg No: TR-NGP-4567');
    expect(a4).toContain('PAN: ABCDE1234F');
  });
});
