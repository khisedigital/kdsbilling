import { getBillLineTaxDetails, toBillDetailTaxes } from '../src/utils/billTax';
import type { CartItem } from '../src/store/cartStore';

const item: CartItem = {
  variantId: 'item-1',
  productName: 'Tea',
  sku: 'TEA',
  quantity: 2,
  unitPrice: 50,
  taxRate: 18,
  taxName: 'GST',
};

describe('bill line tax details', () => {
  it('converts preview tax components to the printed bill item format', () => {
    expect(toBillDetailTaxes([
      { taxName: 'CGST', ratePercent: 2.5, taxAmount: 1.25 },
      { taxName: 'SGST', ratePercent: 2.5, taxAmount: 1.25 },
    ])).toEqual([
      { tax_name: 'CGST', rate_percent: 2.5, tax_amount: 1.25 },
      { tax_name: 'SGST', rate_percent: 2.5, tax_amount: 1.25 },
    ]);
  });

  it('uses preview tax components when available', () => {
    expect(getBillLineTaxDetails(item, [
      { taxName: 'CGST', ratePercent: 9, taxAmount: 9 },
      { taxName: 'SGST', ratePercent: 9, taxAmount: 9 },
    ])).toEqual([
      { name: 'CGST', rate: 9, amount: 9 },
      { name: 'SGST', rate: 9, amount: 9 },
    ]);
  });

  it('calculates tax from the discounted item amount before preview is ready', () => {
    expect(getBillLineTaxDetails({ ...item, discountPercent: 10 })).toEqual([
      { name: 'GST', rate: 18, amount: 16.2 },
    ]);
  });

  it('does not show tax on custom items', () => {
    expect(getBillLineTaxDetails({ ...item, isCustom: true })).toEqual([]);
  });
});
