/** Local bill totals when the desktop app is offline (no server preview). */

function round2(n: number) {
  return Math.round(Number(n) * 100) / 100;
}

export type LocalPreviewItem = {
  variantId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  discountAmount?: number;
  taxAmount?: number;
  taxable?: number;
  taxes?: Array<{
    taxName?: string;
    ratePercent: number;
    taxAmount: number;
  }>;
  mrp?: number | null;
  isCustom?: boolean;
  productNameMr?: string | null;
};

export type LocalBillPreview = {
  items: LocalPreviewItem[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  exactTotal: number;
  totalAmount: number;
};

type CartLike = {
  variantId: string;
  productName: string;
  productNameMr?: string | null;
  quantity: number;
  unitPrice: number;
  discountAmount?: number;
  discountPercent?: number;
  mrp?: number | null;
  taxRate?: number;
  taxName?: string | null;
  isCustom?: boolean;
};

function round4(n: number) {
  return Math.round(Number(n) * 10000) / 10000;
}

/**
 * Offline totals use the cached tax rate so the amount collected matches server billing.
 */
export function buildLocalPreview(
  items: CartLike[],
  opts?: { billDiscountAmount?: number; billDiscountPercent?: number; roundOffAmount?: number },
): LocalBillPreview {
  const lines: LocalPreviewItem[] = items.map((item) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unitPrice) || 0;
    const lineSubtotal = round4(qty * price);
    let discount = Number(item.discountAmount) || 0;
    if (!discount && item.discountPercent) {
      discount = round4((lineSubtotal * Number(item.discountPercent)) / 100);
    }
    discount = round4(discount);
    const taxable = round4(Math.max(0, lineSubtotal - discount));
    const taxRate = item.isCustom ? 0 : Math.max(0, Number(item.taxRate) || 0);
    const taxAmount = round4(taxable * taxRate / 100);
    const lineTotal = round2(taxable + taxAmount);
    return {
      variantId: item.variantId,
      productName: item.productName,
      productNameMr: item.productNameMr ?? null,
      quantity: qty,
      unitPrice: price,
      discountAmount: discount,
      taxAmount,
      taxable,
      taxes: taxRate > 0
        ? [{ taxName: item.taxName || 'Tax', ratePercent: taxRate, taxAmount }]
        : [],
      mrp: item.mrp ?? null,
      isCustom: item.isCustom === true,
      lineTotal,
    };
  });

  const subtotal = round4(lines.reduce((sum, line) => sum + (line.taxable ?? line.lineTotal), 0));
  const taxAmount = round4(lines.reduce((sum, line) => sum + (line.taxAmount || 0), 0));
  let billDiscount = Number(opts?.billDiscountAmount) || 0;
  if (!billDiscount && opts?.billDiscountPercent) {
    billDiscount = round4(((subtotal + taxAmount) * Number(opts.billDiscountPercent)) / 100);
  }
  billDiscount = Math.min(round4(billDiscount), subtotal + taxAmount);
  const exact = round2(Math.max(0, subtotal + taxAmount - billDiscount));
  const roundOff = round2(Number(opts?.roundOffAmount) || 0);
  const totalAmount = round2(exact + roundOff);

  return {
    items: lines,
    subtotal,
    taxAmount,
    discountAmount: billDiscount,
    exactTotal: exact,
    totalAmount,
  };
}
