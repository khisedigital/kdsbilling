import { create } from 'zustand';
import { useLanguageStore } from '../i18n/languageStore';
import type { SearchProductResult } from '../services/catalogService';
import type { UomInfo } from '../utils/quantity';

export interface CartItem {
  /** Catalog variant id, or `custom-<id>` for open-price lines */
  variantId: string;
  productName: string;
  /** Marathi catalog name, used on screen when the UI language is Marathi. */
  productNameMr?: string | null;
  sku: string;
  size?: string | null;
  color?: string | null;
  quantity: number;
  unitPrice: number;
  /** Catalog MRP at add time — used for “You saved” vs selling price */
  mrp?: number | null;
  /** Cashier changed this line’s rate. Catalog refresh must not put the list price back. */
  priceEdited?: boolean;
  discountAmount?: number;
  discountPercent?: number;
  uom?: UomInfo;
  allowDecimalQty?: boolean;
  /** Available warehouse stock when item was added */
  stockQty?: number;
  /** True for ad-hoc lines entered without a catalog product */
  isCustom?: boolean;
}

interface CartState {
  items: CartItem[];
  customerId: string | null;
  customerName: string | null;
  billDiscountAmount: number;
  billDiscountPercent: number;
  offerId: string | null;
  /** Held bill loaded onto the counter. Removed only after the sale or an explicit cancel. */
  resumedHeldId: string | null;
  addItem: (item: CartItem) => void;
  updateQty: (variantId: string, quantity: number) => void;
  updatePrice: (variantId: string, unitPrice: number) => void;
  removeItem: (variantId: string) => void;
  /** Refresh name/price/stock on bill lines after a catalog product is edited. */
  syncFromCatalog: (catalog: SearchProductResult[]) => void;
  setCustomer: (id: string | null, name?: string | null) => void;
  setBillDiscount: (amount: number, percent: number) => void;
  setOffer: (id: string | null) => void;
  loadCart: (
    items: CartItem[],
    customerId?: string | null,
    customerName?: string | null,
    extras?: {
      billDiscountAmount?: number;
      billDiscountPercent?: number;
      offerId?: string | null;
      resumedHeldId?: string | null;
    },
  ) => void;
  clear: () => void;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  customerId: null,
  customerName: null,
  billDiscountAmount: 0,
  billDiscountPercent: 0,
  offerId: null,
  resumedHeldId: null,
  addItem: (item) => {
    // Custom lines stay separate (each entry is its own row)
    if (item.isCustom) {
      set({ items: [...get().items, item] });
      return;
    }
    const existing = get().items.find((i) => !i.isCustom && i.variantId === item.variantId);
    if (existing) {
      set({
        items: get().items.map((i) =>
          !i.isCustom && i.variantId === item.variantId
            ? {
                ...i,
                quantity: Math.round((i.quantity + item.quantity) * 10000) / 10000,
                stockQty: item.stockQty ?? i.stockQty,
                mrp: item.mrp !== undefined ? item.mrp : i.mrp,
                productName: item.productName || i.productName,
                productNameMr: item.productNameMr ?? i.productNameMr,
              }
            : i
        ),
      });
    } else {
      set({ items: [...get().items, item] });
    }
  },
  updateQty: (variantId, quantity) => {
    if (quantity <= 0) {
      set({ items: get().items.filter((i) => i.variantId !== variantId) });
    } else {
      set({
        items: get().items.map((i) => (i.variantId === variantId ? { ...i, quantity } : i)),
      });
    }
  },
  updatePrice: (variantId, unitPrice) => {
    const price = Math.round((Number(unitPrice) || 0) * 100) / 100;
    if (!Number.isFinite(price) || price < 0) return;
    set({
      items: get().items.map((item) => {
        if (item.variantId !== variantId) return item;
        const current = Math.round((Number(item.unitPrice) || 0) * 100) / 100;
        if (current === price) return item;
        return { ...item, unitPrice: price, priceEdited: true };
      }),
    });
  },
  removeItem: (variantId) => set({ items: get().items.filter((i) => i.variantId !== variantId) }),
  syncFromCatalog: (catalog) => {
    if (!catalog.length || !get().items.length) return;
    const byVariant = new Map(catalog.map((p) => [p.variantId, p]));
    let changed = false;
    const items = get().items.map((item) => {
      if (item.isCustom) return item;
      const product = byVariant.get(item.variantId);
      if (!product) return item;
      const catalogPrice = Number(product.sellingPrice) || 0;
      const nextPrice = item.priceEdited ? item.unitPrice : catalogPrice;
      const nextMrp = product.mrp != null ? Number(product.mrp) || null : null;
      const nextAllow = !!(product.allowDecimalQty || product.isWeightBased);
      const nextStock = product.stockQty ?? item.stockQty;
      const mrName = product.productNameMr?.trim() || null;
      const nextName =
        useLanguageStore.getState().bill === 'mr' && mrName ? mrName : product.productName;
      if (
        item.productName === nextName &&
        (item.productNameMr || null) === mrName &&
        item.sku === product.sku &&
        item.size === product.size &&
        item.color === product.color &&
        item.unitPrice === nextPrice &&
        item.mrp === nextMrp &&
        item.allowDecimalQty === nextAllow &&
        item.stockQty === nextStock &&
        (item.uom?.code || '') === (product.uom?.code || '')
      ) {
        return item;
      }
      changed = true;
      return {
        ...item,
        productName: nextName,
        productNameMr: mrName,
        sku: product.sku,
        size: product.size,
        color: product.color,
        unitPrice: nextPrice,
        mrp: nextMrp,
        uom: product.uom || item.uom,
        allowDecimalQty: nextAllow,
        stockQty: nextStock,
      };
    });
    if (changed) set({ items });
  },
  setCustomer: (id, name = null) => set({ customerId: id, customerName: name }),
  setBillDiscount: (amount, percent) => set({ billDiscountAmount: amount, billDiscountPercent: percent }),
  setOffer: (id) => set({ offerId: id }),
  loadCart: (items, customerId = null, customerName = null, extras) =>
    set({
      items,
      customerId,
      customerName,
      billDiscountAmount: extras?.billDiscountAmount || 0,
      billDiscountPercent: extras?.billDiscountPercent || 0,
      offerId: extras?.offerId || null,
      resumedHeldId: extras?.resumedHeldId || null,
    }),
  clear: () =>
    set({
      items: [],
      customerId: null,
      customerName: null,
      billDiscountAmount: 0,
      billDiscountPercent: 0,
      offerId: null,
      resumedHeldId: null,
    }),
}));
