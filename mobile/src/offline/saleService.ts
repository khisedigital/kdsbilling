import type { BillDetail } from '../services/businessService';
import { createBill as createBillOnline } from '../services/businessService';
import {
  applyCatalogPricePatches,
  readCachedProducts,
  type CatalogPricePatch,
} from '../services/catalogCache';
import { isDesktopOfflineCapable } from './capability';
import { isOfflineNow, useConnectivityStore } from './connectivityStore';
import { buildLocalPreview } from './localPreview';
import { saveOutboxSale, type OutboxSale } from './outbox';
import { hasSqliteBridge } from './sqliteApi';

function newClientBillId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function localBillNumber(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `OFF-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

type SaleItem = {
  variantId: string;
  quantity: number;
  unitPrice: number;
  mrp?: number | null;
  discountAmount?: number;
  discountPercent?: number;
  taxRate?: number;
  taxName?: string | null;
  isCustom?: boolean;
  productName: string;
  productNameMr?: string | null;
  uom?: { code: string; name?: string; type?: 'count' | 'weight' | 'volume' | 'length' } | null;
};

export type CreateSaleInput = {
  customerId?: string | null;
  customerName?: string | null;
  items: SaleItem[];
  language?: string;
  billDiscountAmount?: number;
  billDiscountPercent?: number;
  offerId?: string | null;
  roundOffAmount?: number;
  heldBillId?: string;
  payments: Array<{ mode: string; amount: number; referenceNumber?: string }>;
};

async function applyLocalCreditWallet(input: CreateSaleInput, clientBillId: string) {
  if (!hasSqliteBridge()) return;
  const customerId = input.customerId;
  if (!customerId) return;
  const { localAddCustomerLedger, localEnqueueSync } = await import('./localApi');
  for (const p of input.payments || []) {
    if (!(p.amount > 0)) continue;
    if (p.mode !== 'credit' && p.mode !== 'store_credit') continue;
    const entry = {
      id: `${clientBillId}-${p.mode}`,
      customerId,
      entryType: p.mode === 'store_credit' ? 'store_credit_use' : 'sale',
      amount: Number(p.amount) || 0,
      referenceType: 'sale',
      referenceId: clientBillId,
      notes: p.mode === 'credit' ? 'Credit sale' : 'Wallet / store credit',
      syncStatus: 'pending',
    };
    await localAddCustomerLedger(entry);
    await localEnqueueSync({
      entityType: 'customer_ledger',
      entityId: entry.id,
      op: 'create',
      payload: entry,
    });
  }
}

function round2(n: number) {
  return Math.round(Number(n) * 100) / 100;
}

function buildLocalBill(input: CreateSaleInput, clientBillId: string): BillDetail {
  const preview = buildLocalPreview(input.items, {
    billDiscountAmount: input.billDiscountAmount,
    billDiscountPercent: input.billDiscountPercent,
    roundOffAmount: input.roundOffAmount,
  });
  const paid = round2(input.payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
  const total = preview.totalAmount;
  return {
    id: clientBillId,
    bill_number: localBillNumber(),
    status: 'completed',
    subtotal: preview.subtotal,
    discount_amount: preview.discountAmount,
    tax_amount: preview.taxAmount,
    round_off_amount: input.roundOffAmount || 0,
    total_amount: total,
    paid_amount: paid,
    change_amount: Math.max(0, paid - total),
    created_at: new Date().toISOString(),
    customer: input.customerId
      ? { id: input.customerId, name: input.customerName || 'Customer' }
      : input.customerName
        ? { id: '', name: input.customerName }
        : null,
    items: preview.items.map((line, idx) => {
      const cart = input.items.find((i) => i.variantId === line.variantId);
      return {
        // Must be unique across all bills (sale_items.id is global PK).
        id: `${clientBillId}-i${idx}`,
        product_name: line.productName,
        product_name_mr: cart?.productNameMr ?? null,
        sku: '',
        variant_id: line.variantId,
        quantity: line.quantity,
        uom: cart?.uom || null,
        unit_price: line.unitPrice,
        mrp: line.mrp ?? null,
        discount_amount: line.discountAmount || 0,
        tax_amount: line.taxAmount || 0,
        line_total: line.lineTotal,
        taxes: (line.taxes || []).map((tax) => ({
          tax_name: tax.taxName || 'Tax',
          rate_percent: tax.ratePercent,
          tax_amount: tax.taxAmount,
        })),
        variant: cart
          ? {
              product: {
                name: cart.productName,
                name_mr: cart.productNameMr ?? null,
              },
            }
          : null,
      };
    }),
    payments: input.payments.map((p, idx) => ({
      id: `${clientBillId}-p${idx}`,
      payment_mode: p.mode,
      amount: p.amount,
      reference_number: p.referenceNumber || null,
    })),
  };
}

async function reduceLocalStock(items: SaleItem[]) {
  const prev = await readCachedProducts();
  if (!prev?.items?.length) return;
  const patches: CatalogPricePatch[] = [];
  for (const item of items) {
    if (item.isCustom || !item.variantId || String(item.variantId).startsWith('custom-')) continue;
    for (const product of prev.items) {
      const variant = (product.variants || []).find((v) => v.id === item.variantId);
      if (!variant) continue;
      const current = Number(variant.stockQty) || 0;
      patches.push({
        variantId: item.variantId,
        stockQty: Math.max(0, round2(current - (Number(item.quantity) || 0))),
      });
      break;
    }
  }
  if (patches.length) await applyCatalogPricePatches(patches);
}

async function saveOfflineSale(input: CreateSaleInput, clientBillId: string, lastError?: string) {
  const bill = buildLocalBill(input, clientBillId);
  const sale: OutboxSale = {
    clientBillId,
    createdAt: new Date().toISOString(),
    payload: { ...input, clientBillId },
    bill,
    syncAttempts: 0,
    lastError,
  };
  await saveOutboxSale(sale);
  // SQLite saveSale already adjusts variant stock; JSON outbox still needs a cache patch.
  if (!hasSqliteBridge()) {
    await reduceLocalStock(input.items);
  } else {
    await applyLocalCreditWallet(input, clientBillId);
  }
  return bill;
}

/**
 * Desktop + SQLite: everything stays local until the user taps Sync.
 * Without SQLite: online API, or JSON outbox if offline / network fail.
 */
export async function createSale(input: CreateSaleInput): Promise<{
  bill: BillDetail;
  offline: boolean;
}> {
  const clientBillId = newClientBillId();
  const payload: Record<string, unknown> = {
    ...input,
    clientBillId,
  };

  // —— Local only (sync later when user wants) ——
  if (hasSqliteBridge()) {
    const localBill = await saveOfflineSale(input, clientBillId);
    return { bill: localBill, offline: true };
  }

  if (isDesktopOfflineCapable() && isOfflineNow()) {
    const bill = await saveOfflineSale(input, clientBillId);
    return { bill, offline: true };
  }

  try {
    const bill = (await createBillOnline(payload)) as BillDetail;
    return { bill, offline: false };
  } catch (err) {
    if (!isDesktopOfflineCapable()) throw err;
    const message = err instanceof Error ? err.message : String(err);
    const networkish = /cannot connect|network|timeout|ENOTFOUND|ECONNREFUSED|502|503|504/i.test(message);
    if (!networkish) throw err;
    useConnectivityStore.getState().setOnline(false);
    const bill = await saveOfflineSale(input, clientBillId, message);
    return { bill, offline: true };
  }
}
