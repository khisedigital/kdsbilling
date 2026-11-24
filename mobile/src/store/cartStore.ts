import { create } from 'zustand';
import type { CatalogPricePatch } from '../services/catalogCache';
import type { SearchProductResult } from '../services/catalogService';
import type { UomInfo } from '../utils/quantity';

export interface CartItem {
  /** Catalog variant id, or `custom-<id>` for open-price lines */
  variantId: string;
  /** Catalog product id — used to re-link prices if a variant id is refreshed. */
  productId?: string;
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
  taxRate?: number;
  taxName?: string | null;
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
  syncFromCatalog: (catalog: SearchProductResult[], opts?: { forcePrices?: boolean }) => void;
  /** Force-apply product-form / price-management patches onto open bill lines. */
  applyPricePatches: (patches: CatalogPricePatch[]) => boolean;
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
                taxRate: item.taxRate ?? i.taxRate,
                taxName: item.taxName ?? i.taxName,
                productId: item.productId || i.productId,
                // Keep catalog list price unless cashier already overrode this line.
                ...(!i.priceEdited && item.unitPrice !== undefined
                  ? { unitPrice: item.unitPrice }
                  : {}),
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
  syncFromCatalog: (catalog, opts) => {
    if (!catalog.length || !get().items.length) return;
    const forcePrices = !!opts?.forcePrices;
    const byVariant = new Map(catalog.map((p) => [p.variantId, p]));
    const byProduct = new Map<string, SearchProductResult[]>();
    for (const row of catalog) {
      if (!row.productId) continue;
      const list = byProduct.get(row.productId) || [];
      list.push(row);
      byProduct.set(row.productId, list);
    }
    let changed = false;
    const items = get().items.map((item) => {
      if (item.isCustom) return item;
      let product = byVariant.get(item.variantId);
      // Single-variant product edit may refresh under the same product id.
      if (!product && item.productId) {
        const siblings = byProduct.get(item.productId) || [];
        if (siblings.length === 1) product = siblings[0];
      }
      if (!product) return item;
      const catalogPrice = Math.round((Number(product.sellingPrice) || 0) * 100) / 100;
      const currentPrice = Math.round((Number(item.unitPrice) || 0) * 100) / 100;
      // When forcing catalog prices, still refuse a ₹0 overwrite of a positive line
      // (corrupt cache / progressive lean payload race).
      const forcedPrice = catalogPrice > 0 || currentPrice <= 0 ? catalogPrice : currentPrice;
      const nextPrice = !forcePrices && item.priceEdited ? item.unitPrice : (
        forcePrices ? forcedPrice : catalogPrice
      );
      const nextMrp = product.mrp != null ? Number(product.mrp) || null : null;
      const nextAllow = !!(product.allowDecimalQty || product.isWeightBased);
      const nextTaxRate = Number(product.taxRate) || 0;
      const nextTaxName = product.taxName || null;
      const nextStock = product.stockQty ?? item.stockQty;
      const mrName = product.productNameMr?.trim() || null;
      // Always keep English in productName; bill print resolves Marathi separately.
      const nextName = product.productName;
      if (
        item.productName === nextName &&
        (item.productNameMr || null) === mrName &&
        item.sku === product.sku &&
        item.size === product.size &&
        item.color === product.color &&
        currentPrice === nextPrice &&
        item.mrp === nextMrp &&
        item.allowDecimalQty === nextAllow &&
        (item.taxRate || 0) === nextTaxRate &&
        (item.taxName || null) === nextTaxName &&
        item.stockQty === nextStock &&
        (item.uom?.code || '') === (product.uom?.code || '')
        && item.variantId === product.variantId
        && (item.productId || '') === (product.productId || item.productId || '')
        && (!forcePrices || !item.priceEdited)
      ) {
        return item;
      }
      changed = true;
      return {
        ...item,
        variantId: product.variantId,
        productId: product.productId || item.productId,
        productName: nextName,
        productNameMr: mrName,
        sku: product.sku,
        size: product.size,
        color: product.color,
        unitPrice: nextPrice,
        mrp: nextMrp,
        uom: product.uom || item.uom,
        allowDecimalQty: nextAllow,
        taxRate: nextTaxRate,
        taxName: nextTaxName,
        stockQty: nextStock,
        // Catalog price win after Price Management / product edit.
        ...(forcePrices ? { priceEdited: false } : {}),
      };
    });
    if (changed) set({ items });
  },
  applyPricePatches: (patches) => {
    const clean = (patches || []).filter((p) => p?.variantId);
    if (!clean.length || !get().items.length) return false;
    const byVariant = new Map(clean.map((p) => [p.variantId, p]));
    const byProduct = new Map<string, CatalogPricePatch[]>();
    for (const patch of clean) {
      if (!patch.productId) continue;
      const list = byProduct.get(patch.productId) || [];
      list.push(patch);
      byProduct.set(patch.productId, list);
    }
    let changed = false;
    const items = get().items.map((item) => {
      if (item.isCustom) return item;
      let patch = byVariant.get(item.variantId);
      if (!patch && item.productId) {
        const siblings = byProduct.get(item.productId) || [];
        if (siblings.length === 1) patch = siblings[0];
      }
      if (!patch) return item;
      const currentPrice = Math.round((Number(item.unitPrice) || 0) * 100) / 100;
      const patchPrice = patch.sellingPrice !== undefined
        ? Math.round((Number(patch.sellingPrice) || 0) * 100) / 100
        : null;
      // Ignore stale ₹0 patches that would wipe a known good line price.
      const nextPrice = patchPrice == null
        ? currentPrice
        : (patchPrice > 0 || currentPrice <= 0)
          ? patchPrice
          : currentPrice;
      const nextName = patch.name !== undefined ? patch.name : item.productName;
      const nextNameMr = patch.nameMr !== undefined ? patch.nameMr : item.productNameMr;
      const nextMrp = patch.mrp !== undefined ? patch.mrp : item.mrp;
      const nextStock = patch.stockQty !== undefined ? patch.stockQty : item.stockQty;
      if (
        currentPrice === nextPrice
        && item.productName === nextName
        && (item.productNameMr || null) === (nextNameMr || null)
        && item.mrp === nextMrp
        && item.stockQty === nextStock
        && item.variantId === patch.variantId
        && !item.priceEdited
      ) {
        return item;
      }
      changed = true;
      return {
        ...item,
        variantId: patch.variantId,
        productId: patch.productId || item.productId,
        productName: nextName || item.productName,
        productNameMr: nextNameMr,
        unitPrice: nextPrice,
        mrp: nextMrp ?? null,
        stockQty: nextStock,
        priceEdited: false,
      };
    });
    if (changed) set({ items });
    return changed;
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
