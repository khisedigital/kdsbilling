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
 * Offline / network fail on desktop → local totals (tax 0).
 */
export async function previewBillSmart(payload: PreviewPayload): Promise<LocalBillPreview> {
  const { hasSqliteBridge } = await import('./sqliteApi');
  // Local-first desktop: never call server for totals until Sync brings tax rules later.
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
        mrp?: number | null;
        isCustom?: boolean;
      }) => ({
        variantId: line.variantId || '',
        productName: line.productName || '',
        quantity: Number(line.quantity) || 0,
        unitPrice: Number(line.unitPrice) || 0,
        lineTotal: Number(line.lineTotal) || 0,
        discountAmount: Number(line.discountAmount) || 0,
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
