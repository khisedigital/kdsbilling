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
  isCustom?: boolean;
};

/**
 * Simple offline totals: line = qty × price − line discount, then bill discount.
 * Tax stays 0 offline (prices are treated as the amount charged at the counter).
 */
export function buildLocalPreview(
  items: CartLike[],
  opts?: { billDiscountAmount?: number; billDiscountPercent?: number; roundOffAmount?: number },
): LocalBillPreview {
  const lines: LocalPreviewItem[] = items.map((item) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unitPrice) || 0;
    let discount = Number(item.discountAmount) || 0;
    if (!discount && item.discountPercent) {
      discount = round2((qty * price * Number(item.discountPercent)) / 100);
    }
    const lineTotal = round2(Math.max(0, qty * price - discount));
    return {
      variantId: item.variantId,
      productName: item.productName,
      productNameMr: item.productNameMr ?? null,
      quantity: qty,
      unitPrice: price,
      discountAmount: discount,
      mrp: item.mrp ?? null,
      isCustom: item.isCustom === true,
      lineTotal,
    };
  });

  const subtotal = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));
  let billDiscount = Number(opts?.billDiscountAmount) || 0;
  if (!billDiscount && opts?.billDiscountPercent) {
    billDiscount = round2((subtotal * Number(opts.billDiscountPercent)) / 100);
  }
  billDiscount = Math.min(billDiscount, subtotal);
  const taxAmount = 0;
  const exact = round2(subtotal - billDiscount + taxAmount);
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
