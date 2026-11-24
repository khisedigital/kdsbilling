import type { CartItem } from '../store/cartStore';

export type BillLineTax = {
  taxName?: string;
  ratePercent?: number;
  taxAmount?: number;
};

export type BillDetailTax = {
  tax_name: string;
  rate_percent: number;
  tax_amount: number;
};

export function toBillDetailTaxes(taxes?: BillLineTax[]): BillDetailTax[] {
  return (taxes || []).map((tax) => ({
    tax_name: String(tax.taxName || 'Tax'),
    rate_percent: Number(tax.ratePercent) || 0,
    tax_amount: Number(tax.taxAmount) || 0,
  }));
}

export type BillLineTaxDetail = {
  name: string;
  rate: number;
  amount: number;
};

export function getBillLineTaxDetails(
  item: CartItem,
  previewTaxes?: BillLineTax[],
): BillLineTaxDetail[] {
  if (previewTaxes !== undefined) {
    return previewTaxes
      .map((tax) => ({
        name: String(tax.taxName || 'Tax'),
        rate: Number(tax.ratePercent) || 0,
        amount: Number(tax.taxAmount) || 0,
      }))
      .filter((tax) => tax.rate > 0 || tax.amount > 0);
  }

  const rate = Math.max(0, Number(item.taxRate) || 0);
  if (item.isCustom || rate <= 0) return [];

  const subtotal = Math.max(0, Number(item.quantity) * Number(item.unitPrice));
  const discount = Number(item.discountAmount)
    || (Number(item.discountPercent) > 0 ? subtotal * Number(item.discountPercent) / 100 : 0);
  const taxable = Math.max(0, subtotal - discount);
  return [{
    name: String(item.taxName || 'Tax'),
    rate,
    amount: Math.round((taxable * rate / 100) * 100) / 100,
  }];
}
