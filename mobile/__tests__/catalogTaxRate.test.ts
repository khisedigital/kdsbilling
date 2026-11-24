jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  multiGet: jest.fn(() => Promise.resolve([])),
}));

import { productVariantToSearchResult } from '../src/services/catalogService';

describe('catalog tax rates for offline billing', () => {
  it('uses the product tax group rate over a stale variant tax rate', () => {
    const result = productVariantToSearchResult(
      {
        id: 'product-1',
        name: 'Tea',
        tax_group_id: 'current-tax',
        taxGroup: { id: 'current-tax', name: 'GST 18%', total_rate: '18.0000' },
        uom_id: 'uom-1',
        is_weight_based: false,
        allow_decimal_qty: false,
        has_variants: false,
        status: 'active',
      },
      {
        id: 'variant-1',
        sku: 'TEA',
        selling_price: 100,
        cost_price: 50,
        tax_group_id: 'old-tax',
        taxGroup: { id: 'old-tax', name: 'GST 5%', total_rate: '5.0000' },
      },
    );

    expect(result.taxRate).toBe(18);
    expect(result.taxName).toBe('GST 18%');
  });
});
