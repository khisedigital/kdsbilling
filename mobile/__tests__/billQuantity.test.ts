import { formatBillQuantity, formatReceiptQuantity } from '../src/utils/quantity';

const kg = { code: 'kg', type: 'weight' as const };
const g = { code: 'g', type: 'weight' as const };
const pcs = { code: 'pcs', type: 'count' as const };

describe('bill quantity labels', () => {
  it('shows the barcode weight instead of the raw kg fraction', () => {
    expect(formatBillQuantity(0.1, kg)).toBe('100 g');
    expect(formatBillQuantity(0.05, kg)).toBe('50 g');
    expect(formatBillQuantity(1, kg)).toBe('1 kg');
    expect(formatBillQuantity(1.5, kg)).toBe('1.5 kg');
  });

  it('keeps gram and piece products readable', () => {
    expect(formatBillQuantity(100, g)).toBe('100 g');
    expect(formatBillQuantity(2, pcs)).toBe('2');
  });

  it('drops spaces on the printed qty so 100g fits the column', () => {
    expect(formatReceiptQuantity(0.1, kg)).toBe('100g');
    expect(formatReceiptQuantity(0.05, kg)).toBe('50g');
    expect(formatReceiptQuantity(1, kg)).toBe('1kg');
  });
});
