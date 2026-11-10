/** Line saving when MRP is above the selling/unit price. */
export function lineSaving(
  mrp: number | string | null | undefined,
  unitPrice: number | string | null | undefined,
  quantity: number | string | null | undefined,
): number {
  const m = parseFloat(String(mrp ?? 0));
  const p = parseFloat(String(unitPrice ?? 0));
  const q = parseFloat(String(quantity ?? 0));
  if (!(m > 0) || !(q > 0) || !(m > p)) return 0;
  return Math.round((m - p) * q * 100) / 100;
}

export function totalSaving(
  items: Array<{
    mrp?: number | string | null;
    unitPrice?: number | string | null;
    unit_price?: number | string | null;
    quantity?: number | string | null;
  }>,
): number {
  return Math.round(
    items.reduce(
      (sum, item) =>
        sum + lineSaving(item.mrp, item.unitPrice ?? item.unit_price, item.quantity),
      0,
    ) * 100,
  ) / 100;
}
