import { buildLocalPreview } from '../src/offline/localPreview';

describe('buildLocalPreview (desktop offline totals)', () => {
  it('sums line totals and applies bill discount', () => {
    const preview = buildLocalPreview(
      [
        { variantId: 'a', productName: 'Tea', quantity: 2, unitPrice: 10 },
        { variantId: 'b', productName: 'Soap', quantity: 1, unitPrice: 25, discountAmount: 5 },
      ],
      { billDiscountAmount: 5 },
    );

    expect(preview.subtotal).toBe(40); // 20 + 20
    expect(preview.discountAmount).toBe(5);
    expect(preview.taxAmount).toBe(0);
    expect(preview.exactTotal).toBe(35);
    expect(preview.totalAmount).toBe(35);
  });

  it('applies percent bill discount and round-off', () => {
    const preview = buildLocalPreview(
      [{ variantId: 'a', productName: 'Rice', quantity: 1, unitPrice: 100 }],
      { billDiscountPercent: 10, roundOffAmount: 0.5 },
    );

    expect(preview.discountAmount).toBe(10);
    expect(preview.exactTotal).toBe(90);
    expect(preview.totalAmount).toBe(90.5);
  });

  it('applies line percent discount', () => {
    const preview = buildLocalPreview([
      { variantId: 'a', productName: 'Oil', quantity: 2, unitPrice: 50, discountPercent: 10 },
    ]);

    expect(preview.items[0].discountAmount).toBe(10);
    expect(preview.items[0].lineTotal).toBe(90);
    expect(preview.subtotal).toBe(90);
  });

  it('includes cached tax in offline payment totals and percent discounts', () => {
    const preview = buildLocalPreview(
      [{
        variantId: 'taxed',
        productName: 'Taxed item',
        quantity: 1,
        unitPrice: 100,
        taxRate: 18,
        taxName: 'GST',
      }],
      { billDiscountPercent: 10 },
    );

    expect(preview.subtotal).toBe(100);
    expect(preview.taxAmount).toBe(18);
    expect(preview.discountAmount).toBe(11.8);
    expect(preview.totalAmount).toBe(106.2);
    expect(preview.items[0].lineTotal).toBe(118);
  });
});
