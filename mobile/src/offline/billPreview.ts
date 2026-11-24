import { previewBill } from '../services/businessService';
import { isDesktopOfflineCapable } from './capability';
import { isOfflineNow, useConnectivityStore } from './connectivityStore';
import { buildLocalPreview, type LocalBillPreview } from './localPreview';

type PreviewPayload = {
  items: Array<{
    variantId: string;
    productName: string;
    productNameMr?: string | null;
    quantity: number;
    unitPrice: number;
    discountAmount?: number;
    discountPercent?: number;
    taxRate?: number;
    taxName?: string | null;
    mrp?: number | null;
    isCustom?: boolean;
  }>;
  language?: string;
  billDiscountAmount?: number;
  billDiscountPercent?: number;
  offerId?: string | null;
  roundOffAmount?: number;
};

/**
 * Online → server preview (tax, offers).
 * Offline / network fail on desktop → local totals using catalog tax rates.
 */
export async function previewBillSmart(payload: PreviewPayload): Promise<LocalBillPreview> {
  const { hasSqliteBridge } = await import('./sqliteApi');
  // Local-first desktop: calculate from the tax rates cached with the catalog.
  if (hasSqliteBridge() || (isDesktopOfflineCapable() && isOfflineNow())) {
    return buildLocalPreview(payload.items, {
      billDiscountAmount: payload.billDiscountAmount,
      billDiscountPercent: payload.billDiscountPercent,
      roundOffAmount: payload.roundOffAmount,
    });
  }

  try {
    const result = await previewBill(payload as Record<string, unknown>);
    return {
      items: (result.items || []).map((line: {
        variantId?: string;
        productName?: string;
        quantity?: number;
        unitPrice?: number;
        lineTotal?: number;
        discountAmount?: number;
        taxes?: Array<{
          taxName?: string;
          ratePercent?: number;
          taxAmount?: number;
        }>;
        mrp?: number | null;
        isCustom?: boolean;
      }) => ({
        variantId: line.variantId || '',
        productName: line.productName || '',
        quantity: Number(line.quantity) || 0,
        unitPrice: Number(line.unitPrice) || 0,
        lineTotal: Number(line.lineTotal) || 0,
        discountAmount: Number(line.discountAmount) || 0,
        taxes: (line.taxes || []).map((tax) => ({
          taxName: tax.taxName || '',
          ratePercent: Number(tax.ratePercent) || 0,
          taxAmount: Number(tax.taxAmount) || 0,
        })),
        mrp: line.mrp ?? null,
        isCustom: line.isCustom === true,
      })),
      subtotal: Number(result.subtotal) || 0,
      taxAmount: Number(result.taxAmount) || 0,
      discountAmount: Number(result.discountAmount) || 0,
      exactTotal: Number(result.exactTotal ?? result.totalAmount) || 0,
      totalAmount: Number(result.totalAmount) || 0,
    };
  } catch (err) {
    if (!isDesktopOfflineCapable()) throw err;
    useConnectivityStore.getState().setOnline(false);
    return buildLocalPreview(payload.items, {
      billDiscountAmount: payload.billDiscountAmount,
      billDiscountPercent: payload.billDiscountPercent,
      roundOffAmount: payload.roundOffAmount,
    });
  }
}
