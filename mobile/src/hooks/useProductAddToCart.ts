import { useCallback, useState } from 'react';
import { useLanguageStore } from '../i18n';
import type { SearchProductResult } from '../services/catalogService';
import { useCartStore, type CartItem } from '../store/cartStore';
import { needsQuantityPrompt } from '../utils/quantity';

function cartProductName(product: SearchProductResult): string {
  if (useLanguageStore.getState().bill === 'mr' && product.productNameMr?.trim()) {
    return product.productNameMr.trim();
  }
  return product.productName;
}

export function useProductAddToCart() {
  const addItem = useCartStore((s) => s.addItem);
  const updateQty = useCartStore((s) => s.updateQty);
  const [pendingProduct, setPendingProduct] = useState<SearchProductResult | null>(null);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [initialQty, setInitialQty] = useState<number | undefined>();

  const buildCartItem = useCallback(
    (product: SearchProductResult, quantity: number): CartItem => ({
      variantId: product.variantId,
      productName: cartProductName(product),
      productNameMr: product.productNameMr?.trim() || null,
      sku: product.sku,
      size: product.size,
      color: product.color,
      quantity,
      unitPrice: product.sellingPrice,
      mrp: product.mrp != null ? Number(product.mrp) || null : null,
      uom: product.uom || undefined,
      allowDecimalQty: product.allowDecimalQty || product.isWeightBased,
      stockQty: product.stockQty ?? 0,
    }),
    [],
  );

  const requestAdd = useCallback(
    (product: SearchProductResult) => {
      if (product.scannedQuantity && product.scannedQuantity > 0) {
        addItem(buildCartItem(product, product.scannedQuantity));
      } else if (needsQuantityPrompt(product)) {
        setEditingVariantId(null);
        setInitialQty(undefined);
        setPendingProduct(product);
      } else {
        addItem(buildCartItem(product, 1));
      }
    },
    [addItem, buildCartItem],
  );

  /** Barcode / scanner path: always add to cart (qty barcode amount, else 1). Never open How much?. */
  const requestScanAdd = useCallback(
    (product: SearchProductResult) => {
      const qty =
        product.scannedQuantity && product.scannedQuantity > 0 ? product.scannedQuantity : 1;
      addItem(buildCartItem(product, qty));
    },
    [addItem, buildCartItem],
  );

  const requestEditQty = useCallback(
    (item: CartItem) => {
      setEditingVariantId(item.variantId);
      setInitialQty(item.quantity);
      setPendingProduct({
        variantId: item.variantId,
        productId: '',
        productName: item.productName,
        productNameMr: item.productNameMr,
        sku: item.sku,
        size: item.size,
        color: item.color,
        sellingPrice: item.unitPrice,
        mrp: item.mrp ?? null,
        uom: item.uom || { code: 'pcs', type: 'count' },
        allowDecimalQty: item.allowDecimalQty === true,
        stockQty: item.stockQty,
      });
    },
    [],
  );

  const confirmQuantity = useCallback(
    (quantity: number) => {
      if (!pendingProduct) return;
      if (editingVariantId) {
        updateQty(editingVariantId, quantity);
      } else {
        addItem(buildCartItem(pendingProduct, quantity));
      }
      setPendingProduct(null);
      setEditingVariantId(null);
      setInitialQty(undefined);
    },
    [addItem, buildCartItem, editingVariantId, pendingProduct, updateQty],
  );

  const dismissQuantity = useCallback(() => {
    setPendingProduct(null);
    setEditingVariantId(null);
    setInitialQty(undefined);
  }, []);

  return {
    pendingProduct,
    initialQty,
    editingVariantId,
    requestAdd,
    requestScanAdd,
    requestEditQty,
    confirmQuantity,
    dismissQuantity,
  };
}
