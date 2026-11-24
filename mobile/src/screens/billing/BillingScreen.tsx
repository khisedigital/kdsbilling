import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Button, Text, TextInput as PaperInput } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import { useT } from '../../i18n';
import { useLanguageStore } from '../../i18n/languageStore';
import QtyStepper from '../../components/ui/QtyStepper';
import CategoryPickerSheet from '../../components/ui/CategoryPickerSheet';
import {
  getCatalogRevision,
  consumeLastCatalogPricePatches,
  isCatalogCacheEnabled,
  readCachedProducts,
  subscribeCatalogChanges,
  writeCachedProducts,
  type CatalogPricePatch,
} from '../../services/catalogCache';
import {
  fetchAllProducts,
  flattenProductsToVariants,
  matchBarcodeProduct,
  searchProducts,
  type SearchProductResult,
} from '../../services/catalogService';
import { previewBillSmart } from '../../offline/billPreview';
import { useKeyboardOverlap } from '../../hooks/useKeyboardOverlap';
import { useProductAddToCart } from '../../hooks/useProductAddToCart';
import { useCartStore } from '../../store/cartStore';
import { colors } from '../../theme/colors';
import { common, radius, shadow, spacing } from '../../theme/layout';
import { apiError } from '../../utils/apiError';
import { totalSaving } from '../../utils/billSaving';
import { getBillLineTaxDetails, type BillLineTax } from '../../utils/billTax';
import { formatBillQuantity } from '../../utils/quantity';
import { screenProductName } from '../../utils/productName';
import { variantLabel } from '../../utils/variantLabel';
import ProductGridTile from './ProductGridTile';
import QuantityEntryDialog from './QuantityEntryDialog';
import CustomItemDialog from './CustomItemDialog';
import WideBillPanel from './WideBillPanel';

type Props = NativeStackScreenProps<MainStackParamList, 'Billing'>;
type DiscountMode = 'amount' | 'percent';

const GRID_GAP = spacing.sm;
const GRID_PAD = spacing.md;
const BAR_HEIGHT = 64;
/** Keep serving local catalog; only re-download in background every 10 minutes. */
const CATALOG_TTL_MS = 10 * 60_000;

/** Columns that keep tiles readable and never wider than the pane. */
function colsForPane(paneWidth: number, wide: boolean) {
  if (wide) {
    if (paneWidth >= 1100) return 4;
    if (paneWidth >= 720) return 3;
    return 2;
  }
  // Phones / narrow: always 2 products per row.
  return 2;
}

function cartQtyStep(uomCode?: string) {
  const code = (uomCode || '').toLowerCase();
  if (code === 'g' || code === 'ml') return 50;
  return 1;
}

function productSearchBlob(product: SearchProductResult) {
  return [
    product.productName,
    product.productNameMr || '',
    product.sku || '',
    product.size || '',
    product.color || '',
    ...(product.barcodes || []),
    // Pack / quantity barcodes (Manuka 50g, sugar 250g, etc.) must match in New Bill.
    ...((product.quantityBarcodes || []).map((b) => b.barcode)),
  ].join('\0').toLowerCase();
}

function looksLikeBarcode(value: string) {
  const q = value.trim();
  return q.length >= 4 && /^\d+$/.test(q);
}

function productMatches(product: SearchProductResult, query: string, blob?: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (blob || productSearchBlob(product)).includes(q);
}

const gridKeyExtractor = (item: SearchProductResult) => item.variantId;

export default function BillingScreen({ navigation, route }: Props) {
  const t = useT();
  useLanguageStore((s) => s.ui);
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const keyboardOverlap = useKeyboardOverlap();
  const [hostWidth, setHostWidth] = useState(windowWidth);
  const layoutWidth = hostWidth || windowWidth;
  const isWideBill = layoutWidth >= 900;
  const productWidth = isWideBill ? layoutWidth * 0.6 : layoutWidth;
  const narrowPhone = !isWideBill && layoutWidth < 400;
  const cols = colsForPane(productWidth, isWideBill);
  const gridPad = narrowPhone ? spacing.sm : GRID_PAD;
  const tileWidth = useMemo(() => {
    const inner = Math.max(0, productWidth - gridPad * 2 - GRID_GAP * (cols - 1));
    // Exact fit — never force a min width that overflows the row on Android.
    return Math.max(88, Math.floor(inner / cols));
  }, [productWidth, cols, gridPad]);

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const categoryIdRef = useRef<string | null>(null);
  categoryIdRef.current = categoryId;
  const [catalog, setCatalog] = useState<SearchProductResult[]>([]);
  /** Bumped on live price patches so FlatList rebinds visible tiles. */
  const [catalogEpoch, setCatalogEpoch] = useState(0);
  const [remoteResults, setRemoteResults] = useState<SearchProductResult[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [preview, setPreview] = useState<{
    totalAmount: number;
    taxAmount: number;
    subtotal: number;
    discountAmount: number;
    items: Array<{ variantId: string; taxes?: BillLineTax[] }>;
  } | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountMode, setDiscountMode] = useState<DiscountMode>('amount');
  const [discountInput, setDiscountInput] = useState('');
  const [discountError, setDiscountError] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [priceEditId, setPriceEditId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);

  const items = useCartStore((s) => s.items);
  const addItem = useCartStore((s) => s.addItem);
  const updateQty = useCartStore((s) => s.updateQty);
  const updatePrice = useCartStore((s) => s.updatePrice);
  const removeItem = useCartStore((s) => s.removeItem);
  const syncFromCatalog = useCartStore((s) => s.syncFromCatalog);
  const clearCart = useCartStore((s) => s.clear);
  const billDiscountAmount = useCartStore((s) => s.billDiscountAmount);
  const billDiscountPercent = useCartStore((s) => s.billDiscountPercent);
  const setBillDiscount = useCartStore((s) => s.setBillDiscount);
  const customerName = useCartStore((s) => s.customerName);
  const setCustomer = useCartStore((s) => s.setCustomer);

  const {
    pendingProduct,
    initialQty,
    editingVariantId,
    requestAdd,
    requestScanAdd,
    requestEditQty,
    confirmQuantity,
    dismissQuantity,
  } = useProductAddToCart();

  const skipNextFocusLoad = useRef(true);
  const catalogLoadedAt = useRef(0);
  const catalogRevisionSeen = useRef(getCatalogRevision());
  const hydratedFromCacheRef = useRef(false);
  const refreshAfterProductEdit = useRef(false);
  const previewReqId = useRef(0);
  const searchRef = useRef<TextInput>(null);
  const lastScanRef = useRef({ code: '', at: 0 });

  // "New Bill" always starts empty (held-bill resume navigates without fresh).
  useEffect(() => {
    if (!route.params?.fresh) return;
    clearCart();
    setSearch('');
    setCategoryId(null);
    setCartOpen(false);
    setPreview(null);
    dismissQuantity();
    searchRef.current?.focus();
    if (typeof document !== 'undefined') {
      const active = document.activeElement as HTMLElement | null;
      if (active && active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA') active.blur();
    }
    navigation.setParams({ fresh: undefined });
  }, [route.params?.fresh, clearCart, dismissQuantity, navigation]);

  const itemCount = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items],
  );

  const qtyByVariant = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) map.set(item.variantId, item.quantity);
    return map;
  }, [items]);

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of catalog) {
      if (product.categoryId && product.categoryName) {
        map.set(product.categoryId, product.categoryName);
      }
    }
    return [...map.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => ({ id, label: name }));
  }, [catalog]);

  const selectedCategoryLabel = useMemo(() => {
    if (!categoryId) return t('All');
    return categories.find((c) => c.id === categoryId)?.label || t('All');
  }, [categories, categoryId, t]);

  const onCategoryChange = useCallback((id: string | null) => {
    setCategoryId(id);
  }, []);

  const hasBillDiscount = billDiscountPercent > 0 || billDiscountAmount > 0;
  const runningTotal = useMemo(
    () => items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    [items],
  );
  const youSaved = useMemo(() => totalSaving(items), [items]);

  /** Prefer server preview; if missing/stale, still apply cart bill discount locally. */
  const billTotals = useMemo(() => {
    const subtotal = Number(preview?.subtotal);
    const taxAmount = Number(preview?.taxAmount);
    const baseSubtotal = Number.isFinite(subtotal) ? subtotal : runningTotal;
    const baseTax = Number.isFinite(taxAmount) ? taxAmount : 0;
    const base = baseSubtotal + baseTax;

    let expectedDiscount = 0;
    if (billDiscountPercent > 0) {
      expectedDiscount = Math.round((base * billDiscountPercent) / 100 * 100) / 100;
    } else if (billDiscountAmount > 0) {
      expectedDiscount = Math.round(billDiscountAmount * 100) / 100;
    }

    const serverDiscount = Number(preview?.discountAmount);
    const serverTotal = Number(preview?.totalAmount);
    const serverLooksCurrent =
      preview != null &&
      Number.isFinite(serverDiscount) &&
      Number.isFinite(serverTotal) &&
      Math.abs(serverDiscount - expectedDiscount) < 0.05;

    if (serverLooksCurrent) {
      return {
        subtotal: baseSubtotal,
        taxAmount: baseTax,
        discountAmount: serverDiscount,
        totalAmount: serverTotal,
      };
    }

    return {
      subtotal: baseSubtotal,
      taxAmount: baseTax,
      discountAmount: expectedDiscount,
      totalAmount: Math.max(0, Math.round((base - expectedDiscount) * 100) / 100),
    };
  }, [preview, runningTotal, billDiscountAmount, billDiscountPercent]);

  const displayTotal = billTotals.totalAmount;
  const totalLabel = `₹${displayTotal.toFixed(2)}`;
  const hasItems = items.length > 0;

  const applyPricePatchesToCart = useCartStore((s) => s.applyPricePatches);
  const catalogRef = useRef<SearchProductResult[]>([]);
  catalogRef.current = catalog;

  /** Apply live price patches to cart + in-memory catalog (Billing already open). */
  const applyPricePatches = useCallback((pricePatches: CatalogPricePatch[]) => {
    // Prefer fresh caller patches; otherwise consume remembered ones once (no replay → ₹0 blink).
    const patches = pricePatches.length ? pricePatches : consumeLastCatalogPricePatches();
    if (!patches.length) return false;
    // Drop the remembered copy whenever we apply (including live subscribe patches).
    if (pricePatches.length) consumeLastCatalogPricePatches();

    // Cart first — must not depend on the product still being in the painted grid.
    const cartUpdated = applyPricePatchesToCart(patches);

    const byVariant = new Map(patches.map((p) => [p.variantId, p]));
    const byProduct = new Map<string, CatalogPricePatch[]>();
    for (const patch of patches) {
      if (!patch.productId) continue;
      const list = byProduct.get(patch.productId) || [];
      list.push(patch);
      byProduct.set(patch.productId, list);
    }

    const prev = catalogRef.current;
    let nextCatalog: SearchProductResult[] | null = null;
    if (prev.length) {
      let changed = false;
      const next = prev.map((row) => {
        let patch = byVariant.get(row.variantId);
        if (!patch && row.productId) {
          const siblings = byProduct.get(row.productId) || [];
          if (siblings.length === 1) patch = siblings[0];
        }
        if (!patch) return row;
        changed = true;
        const patchPrice = patch.sellingPrice !== undefined ? Number(patch.sellingPrice) : null;
        // Never let a missing/zero patch wipe a known good tile price (cross-device refresh race).
        const nextPrice = patchPrice != null && Number.isFinite(patchPrice) && (patchPrice > 0 || row.sellingPrice <= 0)
          ? patchPrice
          : row.sellingPrice;
        const nextBarcodes = patch.barcodes !== undefined
          ? patch.barcodes
          : patch.barcode !== undefined
            ? [patch.barcode]
            : row.barcodes;
        const nextUom = patch.uom
          ? {
              code: patch.uom.code,
              name: patch.uom.name || patch.uom.code,
              type: patch.uom.type || row.uom?.type,
            }
          : row.uom;
        const isMeasure = nextUom?.type === 'weight' || nextUom?.type === 'volume';
        return {
          ...row,
          variantId: patch.variantId || row.variantId,
          productName: patch.name !== undefined ? patch.name : row.productName,
          productNameMr: patch.nameMr !== undefined ? patch.nameMr : row.productNameMr,
          sellingPrice: nextPrice,
          costPrice: patch.costPrice !== undefined ? Number(patch.costPrice) : row.costPrice,
          mrp: patch.mrp !== undefined ? patch.mrp : row.mrp,
          stockQty: patch.stockQty !== undefined ? patch.stockQty : row.stockQty,
          barcodes: nextBarcodes,
          uom: patch.uomId !== undefined ? nextUom : row.uom,
          isWeightBased: patch.uomId !== undefined ? isMeasure : row.isWeightBased,
          allowDecimalQty: patch.uomId !== undefined
            ? (isMeasure || nextUom?.type === 'length')
            : row.allowDecimalQty,
        };
      });
      if (changed) nextCatalog = next;
    }

    if (nextCatalog) {
      catalogRef.current = nextCatalog;
      setCatalog(nextCatalog);
      syncFromCatalog(nextCatalog, { forcePrices: true });
    }

    if (cartUpdated || nextCatalog) {
      catalogLoadedAt.current = Date.now();
      setCatalogEpoch((n) => n + 1);
      setLoadingCatalog(false);
      return true;
    }
    return false;
  }, [applyPricePatchesToCart, syncFromCatalog]);

  /** Keep a known good price when a progressive/network row briefly arrives as ₹0. */
  const mergeCatalogPrices = useCallback((next: SearchProductResult[]) => {
    const prevByVariant = new Map(catalogRef.current.map((row) => [row.variantId, row]));
    if (!prevByVariant.size) return next;
    return next.map((row) => {
      if (row.sellingPrice > 0) return row;
      const prev = prevByVariant.get(row.variantId);
      if (!prev || !(prev.sellingPrice > 0)) return row;
      return {
        ...row,
        sellingPrice: prev.sellingPrice,
        costPrice: (row.costPrice ?? 0) > 0 ? row.costPrice : prev.costPrice,
        mrp: row.mrp != null ? row.mrp : prev.mrp,
      };
    });
  }, []);

  /** Load catalog tiles from disk cache (cold open / hydrate). */
  const hydrateCatalogFromCache = useCallback(async (opts?: { force?: boolean }) => {
    if (!isCatalogCacheEnabled()) return false;
    if (hydratedFromCacheRef.current && !opts?.force) return false;
    const cached = await readCachedProducts();
    if (!cached?.items?.length) return false;
    const active = cached.items.filter((p) => p.status !== 'inactive');
    const flattened = mergeCatalogPrices(flattenProductsToVariants(active));
    if (!flattened.length) return false;
    catalogRef.current = flattened;
    setCatalog(flattened);
    // Soft sync — do not force ₹0 from a corrupt cache row onto open cart lines.
    syncFromCatalog(flattened, { forcePrices: false });
    hydratedFromCacheRef.current = true;
    // Stamp with cache age so a stale disk cache still triggers a network refresh.
    catalogLoadedAt.current = cached.updatedAt || 0;
    catalogRevisionSeen.current = getCatalogRevision();
    setCatalogEpoch((n) => n + 1);
    setLoadingCatalog(false);
    return true;
  }, [mergeCatalogPrices, syncFromCatalog]);

  const applyCatalogProducts = useCallback((
    products: Parameters<typeof flattenProductsToVariants>[0],
    opts?: { forcePrices?: boolean; cache?: boolean; alreadySorted?: boolean },
  ) => {
    const flattened = mergeCatalogPrices(flattenProductsToVariants(products, {
      alreadySorted: !!opts?.alreadySorted,
    }));
    if (!flattened.length) return false;
    hydratedFromCacheRef.current = true;
    catalogLoadedAt.current = Date.now();
    catalogRevisionSeen.current = getCatalogRevision();
    catalogRef.current = flattened;
    setCatalog(flattened);
    setCatalogEpoch((n) => n + 1);
    // Never replay stale lastPricePatches here — that caused ₹0 ↔ price blinking.
    syncFromCatalog(flattened, { forcePrices: !!opts?.forcePrices });
    setLoadingCatalog(false);
    setLoadError('');
    if (opts?.cache && isCatalogCacheEnabled()) {
      void writeCachedProducts(products, products.length, 'replace');
    }
    return true;
  }, [mergeCatalogPrices, syncFromCatalog]);

  const loadCatalog = useCallback(async (force = false, opts?: { categoryId?: string | null }) => {
    const revision = getCatalogRevision();
    const revisionChanged = revision !== catalogRevisionSeen.current;
    const catId = opts?.categoryId !== undefined ? opts.categoryId : categoryIdRef.current;
    if (
      !force &&
      !revisionChanged &&
      opts?.categoryId === undefined &&
      catalogLoadedAt.current > 0 &&
      Date.now() - catalogLoadedAt.current < CATALOG_TTL_MS
    ) {
      return;
    }
    try {
      setLoadError('');
      // Desktop local DB: load a small favorites-first page (not all 10k+ products).
      // Search still queries SQLite; full sync keeps the DB complete.
      const { shouldUseLocalCatalog, readSqliteBillingCatalog } = await import(
        '../../offline/localCatalog'
      );
      if (shouldUseLocalCatalog()) {
        const page = await readSqliteBillingCatalog({ categoryId: catId });
        if (page?.items?.length) {
          applyCatalogProducts(page.items, { forcePrices: force || revisionChanged, alreadySorted: true });
          return;
        }
        const hit = await hydrateCatalogFromCache({ force: true });
        if (!hit && !hydratedFromCacheRef.current) {
          setCatalog([]);
          setLoadError('Could not load products');
        }
        return;
      }
      // Progressive paint via onPage — no separate 80-row prefetch (that was a double download).
      let painted = hydratedFromCacheRef.current;
      const items = await fetchAllProducts({
        status: 'active',
        onPage: (products, loaded, total) => {
          // First useful page: show tiles immediately.
          // Later: refresh every ~500 rows; final apply happens after the await.
          if (painted && loaded < total && loaded % 500 !== 0) return;
          // Intermediate pages: paint tiles only — force prices on the final apply.
          if (applyCatalogProducts(products, {
            forcePrices: false,
            alreadySorted: true,
          })) {
            painted = true;
          }
        },
      });
      // Don't wipe a good cache/UI if the lean API returned nothing unexpectedly.
      if (!items.length && hydratedFromCacheRef.current) {
        catalogLoadedAt.current = Date.now();
        return;
      }
      if (!applyCatalogProducts(items, {
        forcePrices: revisionChanged || force,
        cache: true,
        alreadySorted: true,
      }) && !hydratedFromCacheRef.current) {
        setCatalog([]);
        setLoadError('Could not load products');
      }
    } catch (err) {
      // Network failed: keep / reload from SQLite or AsyncStorage cache.
      const hit = await hydrateCatalogFromCache({ force: true });
      if (!hit && !hydratedFromCacheRef.current) {
        setCatalog([]);
        setLoadError(apiError(err, 'Could not load products'));
      }
    }
  }, [applyCatalogProducts, hydrateCatalogFromCache]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingCatalog(true);
      await loadCatalog(true);
      if (!cancelled) setLoadingCatalog(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadCatalog]);

  // Category chip: reload a small SQLite page for that category (desktop local).
  const categoryLoadReady = useRef(false);
  useEffect(() => {
    if (!categoryLoadReady.current) {
      categoryLoadReady.current = true;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { shouldUseLocalCatalog } = await import('../../offline/localCatalog');
        if (!shouldUseLocalCatalog()) return;
        setLoadingCatalog(true);
        await loadCatalog(true, { categoryId });
      } finally {
        if (!cancelled) setLoadingCatalog(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [categoryId, loadCatalog]);

  /** After stock/price edits: patch tiles, then reload SQLite so stock is not stuck at 0. */
  const refreshCatalogAfterChange = useCallback(async (pricePatches: CatalogPricePatch[]) => {
    applyPricePatches(pricePatches);
    const hasStockPatch = (pricePatches || []).some((p) => p.stockQty !== undefined);
    try {
      const { shouldUseLocalCatalog } = await import('../../offline/localCatalog');
      if (shouldUseLocalCatalog() && (hasStockPatch || !pricePatches?.length)) {
        await loadCatalog(true);
        return;
      }
    } catch {
      /* fall through */
    }
    if (hasStockPatch) return;
    const ok = await hydrateCatalogFromCache({ force: true });
    if (!ok) await loadCatalog(true);
  }, [applyPricePatches, hydrateCatalogFromCache, loadCatalog]);

  // Live price/stock updates from Price Management / product detail (cache + bill lines).
  useEffect(() => {
    return subscribeCatalogChanges((revision, pricePatches) => {
      if (revision === catalogRevisionSeen.current) return;
      catalogRevisionSeen.current = revision;
      void refreshCatalogAfterChange(pricePatches);
    });
  }, [refreshCatalogAfterChange]);

  useFocusEffect(
    useCallback(() => {
      if (skipNextFocusLoad.current) {
        skipNextFocusLoad.current = false;
        return;
      }
      if (refreshAfterProductEdit.current) {
        refreshAfterProductEdit.current = false;
        // Product form just saved — force cart + tiles from patches / SQLite.
        void refreshCatalogAfterChange([]);
        return;
      }
      if (getCatalogRevision() !== catalogRevisionSeen.current) {
        catalogRevisionSeen.current = getCatalogRevision();
        void refreshCatalogAfterChange([]);
        return;
      }
      // Soft refresh only when TTL expired; otherwise Billing stays offline-fast.
      void loadCatalog(false);
    }, [loadCatalog, refreshCatalogAfterChange]),
  );

  useEffect(() => {
    if (isWideBill || !items.length) {
      previewReqId.current += 1;
      setPreview(null);
      return;
    }

    const requestId = ++previewReqId.current;
    const snapshot = {
      items: items.map((i) => ({
        variantId: i.variantId,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        mrp: i.mrp ?? null,
        discountAmount: i.discountAmount,
        discountPercent: i.discountPercent,
        taxRate: i.taxRate,
        taxName: i.taxName,
        isCustom: i.isCustom === true,
        productName: i.productName,
        productNameMr: i.productNameMr ?? null,
      })),
      language: useLanguageStore.getState().bill,
      billDiscountAmount,
      billDiscountPercent,
    };

    const timer = setTimeout(async () => {
      try {
        const result = await previewBillSmart(snapshot);
        if (requestId !== previewReqId.current) return;
        setPreview({
          totalAmount: Number(result.totalAmount) || 0,
          taxAmount: Number(result.taxAmount) || 0,
          subtotal: Number(result.subtotal) || 0,
          discountAmount: Number(result.discountAmount) || 0,
          items: result.items.map((line) => ({
            variantId: line.variantId,
            taxes: line.taxes,
          })),
        });
      } catch {
        // Keep last good preview; local billTotals still applies cart discount.
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [items, billDiscountAmount, billDiscountPercent, isWideBill]);

  useEffect(() => {
    if (!items.length) setCartOpen(false);
  }, [items.length]);

  const q = search.trim();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), q ? 120 : 0);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    // Names need 2+ chars; pack barcodes are numeric — search as soon as they look like a scan.
    if (q.length < 2 && !looksLikeBarcode(q)) {
      setRemoteResults([]);
      setSearching(false);
      return;
    }
    const delay = looksLikeBarcode(q) ? 60 : 280;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        setRemoteResults(await searchProducts(q));
      } catch {
        setRemoteResults([]);
      } finally {
        setSearching(false);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [q]);

  const catalogSearchBlobs = useMemo(
    () => catalog.map((p) => productSearchBlob(p)),
    [catalog],
  );

  const gridItems = useMemo(() => {
    const inCategory = (p: SearchProductResult) =>
      !categoryId || p.categoryId === categoryId;

    if (debouncedQ) {
      const local = catalog.filter((p, index) => (
        inCategory(p) && productMatches(p, debouncedQ, catalogSearchBlobs[index])
      ));
      // Catalog is already favorites-then-name; keep that order for local hits.
      if (debouncedQ.length < 2) return local;
      // remoteResults come from SQLite search — authoritative for live stock.
      // Prefer them over in-memory catalog tiles that can still show stale 0.
      const remoteByVariant = new Map(
        remoteResults.filter(inCategory).map((p) => [p.variantId, p]),
      );
      const mergedLocal = local.map((p) => {
        const fresh = remoteByVariant.get(p.variantId);
        if (!fresh) return p;
        return {
          ...p,
          stockQty: fresh.stockQty,
          sellingPrice: fresh.sellingPrice > 0 ? fresh.sellingPrice : p.sellingPrice,
          costPrice: (fresh.costPrice ?? 0) > 0 ? fresh.costPrice : p.costPrice,
          mrp: fresh.mrp != null ? fresh.mrp : p.mrp,
        };
      });
      const seen = new Set(mergedLocal.map((p) => p.variantId));
      const extra = remoteResults.filter((p) => inCategory(p) && !seen.has(p.variantId));
      return extra.length ? [...mergedLocal, ...extra] : mergedLocal;
    }
    if (!categoryId) return catalog;
    return catalog.filter(inCategory);
  }, [catalog, catalogSearchBlobs, debouncedQ, remoteResults, categoryId]);

  const openDiscount = () => {
    if (billDiscountPercent > 0) {
      setDiscountMode('percent');
      setDiscountInput(String(billDiscountPercent));
    } else if (billDiscountAmount > 0) {
      setDiscountMode('amount');
      setDiscountInput(String(billDiscountAmount));
    } else {
      setDiscountMode('amount');
      setDiscountInput('');
    }
    setDiscountError('');
    setDiscountOpen(true);
  };

  const applyDiscount = () => {
    const raw = discountInput.trim().replace(',', '.');
    if (!raw) {
      setBillDiscount(0, 0);
      setDiscountOpen(false);
      return;
    }
    const value = parseFloat(raw);
    if (Number.isNaN(value) || value < 0) {
      setDiscountError(t('Enter a valid number'));
      return;
    }
    if (discountMode === 'percent') {
      if (value > 100) {
        setDiscountError(t('Percent cannot exceed 100'));
        return;
      }
      setBillDiscount(0, Math.round(value * 100) / 100);
    } else {
      setBillDiscount(Math.round(value * 100) / 100, 0);
    }
    setDiscountOpen(false);
  };

  const clearDiscount = () => {
    setBillDiscount(0, 0);
    setDiscountInput('');
    setDiscountError('');
    setDiscountOpen(false);
  };

  const addProduct = useCallback(
    (product: SearchProductResult) => {
      requestAdd(product);
      Keyboard.dismiss();
    },
    [requestAdd],
  );

  const commitScan = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (code.length < 3) return false;
      const now = Date.now();
      if (
        lastScanRef.current.code.toLowerCase() === code.toLowerCase() &&
        now - lastScanRef.current.at < 800
      ) {
        return true;
      }
      lastScanRef.current = { code, at: now };

      let product = matchBarcodeProduct(catalog, code);
      if (!product) {
        product = matchBarcodeProduct(remoteResults, code);
      }
      if (!product) {
        try {
          product = matchBarcodeProduct(await searchProducts(code), code);
        } catch {
          lastScanRef.current = { code: '', at: 0 };
          return false;
        }
      }
      if (!product) {
        lastScanRef.current = { code: '', at: 0 };
        return false;
      }
      requestScanAdd(product);
      setSearch('');
      setDebouncedQ('');
      setRemoteResults([]);
      return true;
    },
    [catalog, remoteResults, requestScanAdd],
  );

  // Auto-add when search text is an exact barcode (local catalog or remote lookup).
  useEffect(() => {
    const code = debouncedQ.trim();
    if (code.length < 3) return;
    if (matchBarcodeProduct(catalog, code) || matchBarcodeProduct(remoteResults, code)) {
      void commitScan(code);
    }
  }, [catalog, remoteResults, commitScan, debouncedQ]);



  const handleIncrease = useCallback(
    (variantId: string) => {
      const qty =
        useCartStore.getState().items.find((i) => i.variantId === variantId)?.quantity || 0;
      updateQty(variantId, qty + 1);
    },
    [updateQty],
  );

  const handleDecrease = useCallback(
    (variantId: string) => {
      const qty =
        useCartStore.getState().items.find((i) => i.variantId === variantId)?.quantity || 0;
      updateQty(variantId, qty - 1);
    },
    [updateQty],
  );

  const handleEditQty = useCallback(
    (product: SearchProductResult) => {
      const line = useCartStore.getState().items.find((i) => i.variantId === product.variantId);
      if (line) requestEditQty(line);
      else {
        requestAdd(product);
        Keyboard.dismiss();
      }
    },
    [requestAdd, requestEditQty],
  );

  const handleEditProduct = useCallback(
    (product: SearchProductResult) => {
      if (!product.productId) return;
      Keyboard.dismiss();
      refreshAfterProductEdit.current = true;
      catalogLoadedAt.current = 0;
      navigation.navigate('ProductForm', { productId: product.productId });
    },
    [navigation],
  );

  const confirmClear = () => {
    if (!items.length) return;
    Alert.alert(t('Clear bill?'), t('Remove all items from this bill?'), [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Clear'),
        style: 'destructive',
        onPress: () => {
          clearCart();
          setCartOpen(false);
        },
      },
    ]);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadCatalog(true);
    setRefreshing(false);
  };

  const addCustomItem = (entries: { name: string; price: number; quantity: number }[]) => {
    const stamp = Date.now().toString(36);
    entries.forEach((item, index) => {
      addItem({
        variantId: `custom-${stamp}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        productName: item.name,
        sku: 'CUSTOM',
        quantity: item.quantity,
        unitPrice: item.price,
        isCustom: true,
        allowDecimalQty: true,
        stockQty: 0,
      });
    });
    setCustomOpen(false);
  };

  const goPay = () => {
    setCartOpen(false);
    navigation.navigate('Payment');
  };

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    let buffer = '';
    let lastKey = 0;

    const onKeyDown = (event: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      const tag = activeEl?.tagName;
      const typingInField =
        tag === 'INPUT' || tag === 'TEXTAREA' || !!activeEl?.isContentEditable;

      // F1: New Bill
      if (event.key === 'F1') {
        event.preventDefault();
        event.stopPropagation();
        clearCart();
        setSearch('');
        setCategoryId(null);
        setCartOpen(false);
        setPreview(null);
        dismissQuantity();
        searchRef.current?.focus();
        return;
      }

      // F2: Search
      if (event.key === 'F2') {
        event.preventDefault();
        event.stopPropagation();
        searchRef.current?.focus();
        const inputEl = searchRef.current as unknown as HTMLInputElement | null;
        if (inputEl && typeof inputEl.select === 'function') {
          inputEl.select();
        }
        return;
      }

      // F7: Customer select
      if (event.key === 'F7') {
        event.preventDefault();
        event.stopPropagation();
        if (isWideBill) {
          window.dispatchEvent(new CustomEvent('pos:customer-select'));
        } else {
          navigation.navigate('CustomerList');
        }
        return;
      }

      // F8: Discount
      if (event.key === 'F8') {
        event.preventDefault();
        event.stopPropagation();
        if (isWideBill) {
          window.dispatchEvent(new CustomEvent('pos:discount'));
        } else {
          setDiscountOpen(true);
        }
        return;
      }

      // F9: Hold bill
      if (event.key === 'F9') {
        event.preventDefault();
        event.stopPropagation();
        if (!items.length) {
          Alert.alert(t('Cart is empty'), t('Add items to hold a bill.'));
          return;
        }
        if (isWideBill) {
          window.dispatchEvent(new CustomEvent('pos:hold'));
        } else {
          setCartOpen(false);
          navigation.navigate('HoldBill');
        }
        return;
      }

      // F10: Print bill
      if (event.key === 'F10') {
        event.preventDefault();
        event.stopPropagation();
        if (isWideBill && items.length > 0) {
          window.dispatchEvent(new CustomEvent('pos:print'));
        }
        return;
      }

      // F12: Complete bill
      if (event.key === 'F12') {
        event.preventDefault();
        event.stopPropagation();
        if (!items.length) {
          Alert.alert(t('Cart is empty'), t('Add items before completing bill.'));
          return;
        }
        if (isWideBill) {
          window.dispatchEvent(new CustomEvent('pos:complete'));
        } else {
          goPay();
        }
        return;
      }

      // Barcode scanner wedge: digits then Enter
      if (pendingProduct || discountOpen || customOpen) {
        buffer = '';
        return;
      }

      const now = Date.now();
      if (now - lastKey > 80) buffer = '';
      lastKey = now;

      if (event.key === 'Enter' || event.key === 'NumpadEnter') {
        const code = buffer.trim();
        buffer = '';
        if (code.length >= 3) {
          // Fast keystrokes + Enter = barcode gun
          event.preventDefault();
          event.stopPropagation();
          void commitScan(code);
        }
        return;
      }

      if (typingInField) {
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          buffer += event.key;
        }
        return;
      }

      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        buffer += event.key;
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    commitScan,
    customOpen,
    discountOpen,
    goPay,
    isWideBill,
    items,
    navigation,
    pendingProduct,
    t,
  ]);

  const renderProduct = useCallback(
    ({ item }: { item: SearchProductResult }) => (
      <View style={[styles.gridCell, { width: tileWidth }]}>
        <ProductGridTile
          product={item}
          qtyInCart={qtyByVariant.get(item.variantId) || 0}
          width={tileWidth}
          onAdd={addProduct}
          onIncrease={handleIncrease}
          onDecrease={handleDecrease}
          onEditQty={handleEditQty}
          onEditProduct={handleEditProduct}
        />
      </View>
    ),
    [qtyByVariant, tileWidth, addProduct, handleIncrease, handleDecrease, handleEditQty, handleEditProduct],
  );

  const searchingNow = searching && q.length >= 2;
  const barPad = !isWideBill && hasItems
    ? BAR_HEIGHT + Math.max(insets.bottom, spacing.sm) + spacing.md
    : spacing.lg;
  const qtyLabel = itemCount % 1 === 0 ? String(itemCount) : itemCount.toFixed(2);
  const gridContentStyle = useMemo(
    () => [
      styles.gridContent,
      { paddingHorizontal: gridPad, paddingBottom: barPad },
      !gridItems.length && styles.gridEmpty,
    ],
    [barPad, gridItems.length, gridPad],
  );
  const gridExtraData = useMemo(
    () => ({ qtyByVariant, catalogEpoch }),
    [qtyByVariant, catalogEpoch],
  );

  const beginPriceEdit = (variantId: string, unitPrice: number) => {
    setPriceEditId(variantId);
    setPriceDraft(String(unitPrice));
  };

  const commitPriceEdit = (variantId: string) => {
    const cleaned = priceDraft.trim().replace(',', '.');
    const parsed = parseFloat(cleaned);
    if (cleaned && Number.isFinite(parsed) && parsed >= 0) {
      updatePrice(variantId, parsed);
    }
    setPriceEditId((current) => (current === variantId ? null : current));
  };

  const renderCartLine = ({ item }: { item: (typeof items)[number] }) => {
    const lineTotal = item.unitPrice * item.quantity;
    const size = variantLabel(item.size, item.color);
    const lineName = screenProductName(item.productName, item.productNameMr);
    const editingPrice = priceEditId === item.variantId;
    const previewTaxes = preview?.items.find((line) => line.variantId === item.variantId)?.taxes;
    const taxDetails = getBillLineTaxDetails(item, previewTaxes);
    return (
      <View style={styles.line}>
        <View style={styles.lineTop}>
          <View style={styles.lineInfo}>
            <Text style={styles.lineName} numberOfLines={1}>
              {lineName}
              {item.isCustom ? t(' · Custom') : size ? ` · ${size}` : ''}
            </Text>
            {taxDetails.map((tax, index) => (
              <Text key={`${tax.name}:${tax.rate}:${index}`} style={styles.lineMeta}>
                {t('{{name}} {{rate}}%: {{amount}}', {
                  name: tax.name,
                  rate: tax.rate,
                  amount: `₹${tax.amount.toFixed(2)}`,
                })}
              </Text>
            ))}
            {editingPrice ? (
              <View style={styles.priceEditRow}>
                <Text style={styles.pricePrefix}>₹</Text>
                <TextInput
                  value={priceDraft}
                  onChangeText={(value) => setPriceDraft(value.replace(/[^0-9.,]/g, ''))}
                  onBlur={() => commitPriceEdit(item.variantId)}
                  onSubmitEditing={() => commitPriceEdit(item.variantId)}
                  autoFocus
                  selectTextOnFocus
                  keyboardType="decimal-pad"
                  style={styles.priceInput}
                  accessibilityLabel={t('Price for {{name}}', { name: lineName })}
                />
              </View>
            ) : (
              <Pressable
                onPress={() => beginPriceEdit(item.variantId, item.unitPrice)}
                hitSlop={6}
                style={styles.priceTap}
                accessibilityLabel={t('Edit price for {{name}}', { name: lineName })}>
                <Text style={styles.lineMeta}>
                  ₹{item.unitPrice}
                  {item.uom?.code ? `/${item.uom.code}` : ''}
                </Text>
                <Icon name="pencil-outline" size={13} color={colors.primary} />
              </Pressable>
            )}
          </View>
          <Pressable onPress={() => removeItem(item.variantId)} hitSlop={10} style={styles.removeBtn}>
            <Icon name="trash-can-outline" size={16} color={colors.error} />
          </Pressable>
        </View>
        <View style={styles.lineBottom}>
          <QtyStepper
            value={formatBillQuantity(item.quantity, item.uom)}
            onDecrease={() => {
              const step = item.allowDecimalQty ? cartQtyStep(item.uom?.code) : 1;
              const next = Math.round((item.quantity - step) * 1000) / 1000;
              updateQty(item.variantId, next);
            }}
            onIncrease={() => {
              const step = item.allowDecimalQty ? cartQtyStep(item.uom?.code) : 1;
              const next = Math.round((item.quantity + step) * 1000) / 1000;
              updateQty(item.variantId, next);
            }}
            onPressValue={() => requestEditQty(item)}
          />
          <Text style={styles.lineTotal}>₹{lineTotal.toFixed(2)}</Text>
        </View>
      </View>
    );
  };

  return (
    <View
      style={[common.screen, isWideBill && styles.wideRoot]}
      onLayout={(event) => {
        const next = Math.round(event.nativeEvent.layout.width);
        setHostWidth((prev) => (prev === next ? prev : next));
      }}>
      <View style={isWideBill ? styles.productPane : styles.fill}>
      <View style={[styles.header, isWideBill && styles.headerCompact, narrowPhone && styles.headerNarrow]}>
        {!isWideBill ? (
          <View style={styles.actionsRow}>
            <Pressable
              onPress={() => navigation.navigate('ProductForm')}
              style={({ pressed }) => [styles.iconBtn, narrowPhone && styles.iconBtnNarrow, pressed && styles.pressed]}
              accessibilityLabel={t('Add product')}>
              <Icon name="package-variant" size={narrowPhone ? 20 : 24} color={colors.primary} />
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('HeldBills')}
              style={({ pressed }) => [styles.iconBtn, narrowPhone && styles.iconBtnNarrow, pressed && styles.pressed]}
              accessibilityLabel={t('Held bills')}>
              <Icon name="pause-circle-outline" size={narrowPhone ? 20 : 22} color={colors.primary} />
            </Pressable>
            <Pressable
              onPress={() => setCustomOpen(true)}
              style={({ pressed }) => [styles.iconBtn, styles.customBtn, narrowPhone && styles.iconBtnNarrow, pressed && styles.pressed]}
              accessibilityLabel={t('Custom item')}>
              <Icon name="cart-plus" size={narrowPhone ? 20 : 24} color={colors.primary} />
            </Pressable>
            <View style={styles.actionsSpacer} />
            <Pressable
              onPress={() => navigation.navigate('BarcodeScanner')}
              style={({ pressed }) => [styles.scanBtn, narrowPhone && styles.iconBtnNarrow, pressed && styles.pressed]}
              accessibilityLabel={t('Scan barcode')}>
              <Icon name="barcode-scan" size={narrowPhone ? 20 : 24} color={colors.textOnPrimary} />
            </Pressable>
          </View>
        ) : null}
        <View style={[styles.searchRow, narrowPhone && styles.searchRowNarrow]}>
          {isWideBill ? (
            <>
              <Pressable
                onPress={() => navigation.navigate('ProductForm')}
                style={({ pressed }) => [styles.iconBtnSm, pressed && styles.pressed]}
                accessibilityLabel={t('Add product')}>
                <Icon name="package-variant" size={20} color={colors.primary} />
              </Pressable>
              <Pressable
                onPress={() => navigation.navigate('HeldBills')}
                style={({ pressed }) => [styles.iconBtnSm, pressed && styles.pressed]}
                accessibilityLabel={t('Held bills')}>
                <Icon name="pause-circle-outline" size={20} color={colors.primary} />
              </Pressable>
              <Pressable
                onPress={() => setCustomOpen(true)}
                style={({ pressed }) => [styles.iconBtnSm, pressed && styles.pressed]}
                accessibilityLabel={t('Custom item')}>
                <Icon name="cart-plus" size={20} color={colors.primary} />
              </Pressable>
            </>
          ) : null}
          <View style={[styles.searchBox, isWideBill && styles.searchBoxCompact, narrowPhone && styles.searchBoxNarrow]}>
            <Icon name="magnify" size={20} color={colors.textMuted} />
            <TextInput
              ref={searchRef}
              value={search}
              onChangeText={setSearch}
              onSubmitEditing={(e) => {
                void commitScan(e.nativeEvent.text || search);
              }}
              placeholder={t('Search name, SKU, barcode')}
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
              blurOnSubmit={false}
              returnKeyType="search"
            />
            {searchingNow ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : search ? (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <Icon name="close-circle" size={18} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
          {categories.length > 0 ? (
            <Pressable
              onPress={() => {
                Keyboard.dismiss();
                setCategoryPickerOpen(true);
              }}
              style={[
                styles.categoryBtn,
                isWideBill && styles.categoryBtnCompact,
                narrowPhone && styles.categoryBtnNarrow,
                categoryId ? styles.categoryBtnOn : null,
              ]}
              accessibilityLabel={t('Filter by category')}>
              <Icon
                name="shape-outline"
                size={18}
                color={categoryId ? colors.textOnPrimary : colors.primary}
              />
              <Text
                style={[styles.categoryBtnText, categoryId ? styles.categoryBtnTextOn : null]}
                numberOfLines={1}>
                {selectedCategoryLabel}
              </Text>
              {categoryId ? (
                <Pressable
                  onPress={() => setCategoryId(null)}
                  hitSlop={8}
                  accessibilityLabel={t('Clear category')}>
                  <Icon name="close-circle" size={16} color={colors.textOnPrimary} />
                </Pressable>
              ) : (
                <Icon name="chevron-down" size={18} color={colors.primary} />
              )}
            </Pressable>
          ) : null}
          {isWideBill ? (
            <Pressable
              onPress={() => navigation.navigate('BarcodeScanner')}
              style={({ pressed }) => [styles.scanBtnSm, pressed && styles.pressed]}
              accessibilityLabel={t('Scan barcode')}>
              <Icon name="barcode-scan" size={20} color={colors.textOnPrimary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {isWideBill ? (
        <View style={styles.shortcutBar}>
          <Text style={styles.shortcutItem}><Text style={styles.shortcutKey}>F1</Text> {t('New Bill')}</Text>
          <Text style={styles.shortcutItem}><Text style={styles.shortcutKey}>F2</Text> {t('Search')}</Text>
          <Text style={styles.shortcutItem}><Text style={styles.shortcutKey}>F7</Text> {t('Customer')}</Text>
          <Text style={styles.shortcutItem}><Text style={styles.shortcutKey}>F8</Text> {t('Discount')}</Text>
          <Text style={styles.shortcutItem}><Text style={styles.shortcutKey}>F9</Text> {t('Hold')}</Text>
          <Text style={styles.shortcutItem}><Text style={styles.shortcutKey}>F10</Text> {t('Print')}</Text>
          <Text style={styles.shortcutItem}><Text style={styles.shortcutKey}>F12</Text> {t('Complete Bill')}</Text>
        </View>
      ) : null}

      <FlatList
        data={gridItems}
        key={`grid-${cols}`}
        keyExtractor={gridKeyExtractor}
        numColumns={cols}
        style={styles.fill}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        maxToRenderPerBatch={9}
        updateCellsBatchingPeriod={50}
        windowSize={5}
        removeClippedSubviews={Platform.OS !== 'web'}
        contentContainerStyle={gridContentStyle}
        columnWrapperStyle={cols > 1 ? styles.gridRow : undefined}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        ListEmptyComponent={
          loadingCatalog ? (
            <View style={styles.emptyWrap}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.emptySubtitle}>{t('Loading products…')}</Text>
            </View>
          ) : (
            <View style={styles.emptyWrap}>
              <Icon name="package-variant-closed" size={42} color={colors.primary} />
              <Text style={styles.emptyTitle}>
                {loadError
                  ? t('Could not load products')
                  : q
                    ? t('No matching products')
                    : t('No products yet')}
              </Text>
              <Text style={styles.emptySubtitle}>
                {loadError
                  ? loadError
                  : q
                    ? t('Nothing found for “{{query}}”', { query: q })
                    : t('Add a product, or use Custom item')}
              </Text>
              {!loadError ? (
                <View style={styles.emptyActions}>
                  <Button
                    mode="contained"
                    icon="cart-plus"
                    style={styles.emptyAddBtn}
                    onPress={() => setCustomOpen(true)}>
                    {t('Custom item')}
                  </Button>
                  <Button
                    mode="outlined"
                    icon="package-variant"
                    style={styles.emptyAddBtn}
                    onPress={() => navigation.navigate('ProductForm')}>
                    {t('Add product')}
                  </Button>
                </View>
              ) : null}
            </View>
          )
        }
        renderItem={renderProduct}
        extraData={gridExtraData}
      />

      {hasItems && !isWideBill ? (
        <View style={[styles.payBar, narrowPhone && styles.payBarNarrow, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
          <Pressable
            onPress={() => setCartOpen(true)}
            style={({ pressed }) => [styles.billPeek, pressed && styles.pressed]}
            accessibilityLabel={t('Open bill')}>
            <View style={styles.billBadge}>
              <Text style={styles.billBadgeText}>{qtyLabel}</Text>
            </View>
            <View style={styles.billPeekText}>
              <Text style={styles.billPeekLabel} numberOfLines={1}>
                {billTotals.discountAmount > 0
                  ? t('View bill · −₹{{amount}}', { amount: billTotals.discountAmount.toFixed(2) })
                  : t('View bill')}
              </Text>
              <Text style={[styles.billPeekTotal, narrowPhone && styles.billPeekTotalNarrow]} numberOfLines={1}>
                {totalLabel}
              </Text>
            </View>
            {!narrowPhone ? <Icon name="chevron-up" size={20} color={colors.textMuted} /> : null}
          </Pressable>
          <Pressable
            onPress={goPay}
            style={({ pressed }) => [styles.payBtn, narrowPhone && styles.payBtnNarrow, pressed && styles.pressed]}
            accessibilityLabel={t('Proceed to payment')}>
            <Text style={[styles.payBtnText, narrowPhone && styles.payBtnTextNarrow]}>{t('Pay')}</Text>
          </Pressable>
        </View>
      ) : null}

      {isWideBill ? (
        <QuantityEntryDialog
          product={pendingProduct}
          initialQuantity={initialQty}
          editing={!!editingVariantId}
          contained
          onConfirm={confirmQuantity}
          onDismiss={dismissQuantity}
        />
      ) : null}

      </View>

      {isWideBill ? <WideBillPanel /> : null}

      {!isWideBill ? <Modal
        visible={cartOpen}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (discountOpen) setDiscountOpen(false);
          else setCartOpen(false);
        }}>
        <View style={[styles.sheetRoot, keyboardOverlap > 0 && { paddingBottom: keyboardOverlap }]}>
          <Pressable style={styles.sheetOverlay} onPress={() => setCartOpen(false)} />
          <View style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, spacing.md),
              maxHeight: keyboardOverlap > 0 ? Math.max(0, windowHeight - keyboardOverlap - 12) : '78%',
            },
          ]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{t('Current bill')}</Text>
              <Pressable onPress={() => setCartOpen(false)} hitSlop={10}>
                <Icon name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            <View style={styles.sheetActions}>
              <Pressable
                onPress={() => {
                  setCartOpen(false);
                  navigation.navigate('CustomerList', { pickForBill: true });
                }}
                style={styles.sheetAction}>
                <Icon name={customerName ? 'account-check' : 'account-plus-outline'} size={18} color={colors.primary} />
                <Text style={styles.sheetActionText} numberOfLines={1}>
                  {customerName || t('Customer')}
                </Text>
              </Pressable>
              <Pressable onPress={openDiscount} style={styles.sheetAction}>
                <Icon name="percent-outline" size={18} color={hasBillDiscount ? colors.secondary : colors.primary} />
                <Text style={styles.sheetActionText} numberOfLines={1}>
                  {billDiscountPercent > 0
                    ? t('{{percent}}% off', { percent: billDiscountPercent })
                    : billDiscountAmount > 0
                      ? t('₹{{amount}} off', { amount: billDiscountAmount })
                      : t('Discount')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setCartOpen(false);
                  navigation.navigate('HoldBill');
                }}
                style={styles.sheetAction}>
                <Icon name="content-save-outline" size={18} color={colors.primary} />
                <Text style={styles.sheetActionText}>{t('Hold')}</Text>
              </Pressable>
              <Pressable onPress={confirmClear} style={styles.sheetAction}>
                <Icon name="trash-can-outline" size={18} color={colors.error} />
                <Text style={[styles.sheetActionText, { color: colors.error }]}>{t('Clear')}</Text>
              </Pressable>
            </View>

            <FlatList
              data={items}
              keyExtractor={(item) => item.variantId}
              style={styles.sheetList}
              renderItem={renderCartLine}
              keyboardShouldPersistTaps="handled"
            />

            <View style={styles.sheetTotalRow}>
              <Text style={styles.sheetTotalMeta}>
                {billTotals.taxAmount > 0 && billTotals.discountAmount > 0
                  ? t('{{qty}} qty · Tax ₹{{tax}} · Disc -₹{{disc}}', {
                      qty: qtyLabel,
                      tax: billTotals.taxAmount.toFixed(2),
                      disc: billTotals.discountAmount.toFixed(2),
                    })
                  : billTotals.taxAmount > 0
                    ? t('{{qty}} qty · Tax ₹{{tax}}', {
                        qty: qtyLabel,
                        tax: billTotals.taxAmount.toFixed(2),
                      })
                    : billTotals.discountAmount > 0
                      ? t('{{qty}} qty · Disc -₹{{disc}}', {
                          qty: qtyLabel,
                          disc: billTotals.discountAmount.toFixed(2),
                        })
                      : t('{{qty}} qty', { qty: qtyLabel })}
              </Text>
              <Text style={styles.sheetTotal}>{totalLabel}</Text>
            </View>
            {youSaved > 0 ? (
              <View style={styles.sheetSaveRow}>
                <Text style={styles.sheetSaveLbl}>{t('Total saving')}</Text>
                <Text style={styles.sheetSaveVal}>₹{youSaved.toFixed(2)}</Text>
              </View>
            ) : null}

            <Pressable onPress={goPay} style={({ pressed }) => [styles.sheetPay, pressed && styles.pressed]}>
              <Text style={styles.payBtnText}>{t('Pay ₹{{amount}}', { amount: displayTotal.toFixed(2) })}</Text>
            </Pressable>
          </View>

          {discountOpen ? (
            <View style={[styles.discountOverlay, keyboardOverlap > 0 && { paddingBottom: keyboardOverlap }]} pointerEvents="box-none">
              <Pressable style={styles.discountScrim} onPress={() => setDiscountOpen(false)} />
              <View style={[styles.discountCard, { marginBottom: Math.max(insets.bottom, spacing.md) }]}>
                <Text style={styles.discountTitle}>{t('Bill discount')}</Text>
                <Text style={styles.dialogHint}>{t('Apply on the whole bill — pick ₹ amount or %')}</Text>
                <View style={styles.modeRow}>
                  <Pressable
                    onPress={() => {
                      setDiscountMode('amount');
                      setDiscountError('');
                    }}
                    style={[styles.modeBtn, discountMode === 'amount' && styles.modeBtnOn]}>
                    <Text style={[styles.modeBtnText, discountMode === 'amount' && styles.modeBtnTextOn]}>
                      {t('₹ Amount')}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setDiscountMode('percent');
                      setDiscountError('');
                    }}
                    style={[styles.modeBtn, discountMode === 'percent' && styles.modeBtnOn]}>
                    <Text style={[styles.modeBtnText, discountMode === 'percent' && styles.modeBtnTextOn]}>
                      {t('% Percent')}
                    </Text>
                  </Pressable>
                </View>
                <PaperInput
                  label={discountMode === 'percent' ? t('Discount %') : t('Discount ₹')}
                  value={discountInput}
                  onChangeText={(v) => {
                    setDiscountInput(v);
                    setDiscountError('');
                  }}
                  mode="outlined"
                  keyboardType="decimal-pad"
                  style={styles.discountInput}
                  autoFocus
                  right={<PaperInput.Affix text={discountMode === 'percent' ? '%' : '₹'} />}
                />
                {discountError ? <Text style={styles.discountError}>{discountError}</Text> : null}
                <View style={styles.dialogActions}>
                  <Button
                    textColor={colors.error}
                    onPress={clearDiscount}
                    disabled={!hasBillDiscount && !discountInput}>
                    {t('Remove')}
                  </Button>
                  <View style={styles.dialogRight}>
                    <Button onPress={() => setDiscountOpen(false)}>{t('Cancel')}</Button>
                    <Button mode="contained" onPress={applyDiscount}>
                      {t('Apply')}
                    </Button>
                  </View>
                </View>
              </View>
            </View>
          ) : null}
        </View>
      </Modal> : null}

      {!isWideBill ? (
        <QuantityEntryDialog
          product={pendingProduct}
          initialQuantity={initialQty}
          editing={!!editingVariantId}
          onConfirm={confirmQuantity}
          onDismiss={dismissQuantity}
        />
      ) : null}

      <CustomItemDialog
        visible={customOpen}
        onDismiss={() => setCustomOpen(false)}
        onSubmit={addCustomItem}
      />

      <CategoryPickerSheet
        visible={categoryPickerOpen}
        options={categories}
        value={categoryId}
        onSelect={onCategoryChange}
        onClose={() => setCategoryPickerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wideRoot: { flexDirection: 'row' },
  productPane: { flex: 3, minWidth: 0, minHeight: 0, overflow: 'hidden', position: 'relative' },
  fill: { flex: 1, minHeight: 0 },
  header: {
    backgroundColor: colors.surface,
    paddingHorizontal: GRID_PAD,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerCompact: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  headerNarrow: {
    paddingHorizontal: spacing.sm,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  actionsSpacer: {
    flex: 1,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchRowNarrow: {
    flexWrap: 'wrap',
  },
  searchBox: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceVariant,
  },
  searchBoxCompact: {
    height: 38,
    paddingHorizontal: spacing.sm,
  },
  searchBoxNarrow: {
    flexBasis: '100%',
    height: 42,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    color: colors.text,
    paddingVertical: 0,
    ...(Platform.OS === 'web'
      ? ({ outlineStyle: 'none', outlineWidth: 0, outlineColor: 'transparent' } as object)
      : null),
  },
  iconBtnSm: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  scanBtnSm: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  categoryBtn: {
    maxWidth: 140,
    minWidth: 96,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
    flexShrink: 1,
  },
  categoryBtnCompact: {
    height: 38,
    minWidth: 84,
    maxWidth: 120,
  },
  categoryBtnNarrow: {
    flexGrow: 1,
    maxWidth: '100%',
    minWidth: 0,
    height: 42,
  },
  categoryBtnOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryBtnText: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  categoryBtnTextOn: {
    color: colors.textOnPrimary,
  },
  customBtn: {
    backgroundColor: colors.primaryLight,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnNarrow: {
    width: 40,
    height: 40,
  },
  scanBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.88 },
  gridContent: {
    paddingTop: spacing.md,
  },
  gridEmpty: { flexGrow: 1, justifyContent: 'center' },
  gridRow: {
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
    justifyContent: 'flex-start',
    alignItems: 'stretch',
  },
  gridCell: {
    alignSelf: 'stretch',
  },
  emptyWrap: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    gap: spacing.sm,
  },
  emptyActions: {
    marginTop: spacing.md,
    gap: spacing.sm,
    alignItems: 'center',
  },
  emptyAddBtn: {
    marginTop: spacing.sm,
    minWidth: 180,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
  payBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    ...shadow.lg,
  },
  payBarNarrow: {
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  billPeek: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  billBadge: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  billBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textOnPrimary,
  },
  billPeekText: { flex: 1, minWidth: 0 },
  billPeekLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
  billPeekTotal: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  billPeekTotalNarrow: {
    fontSize: 16,
  },
  payBtn: {
    minWidth: 108,
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payBtnNarrow: {
    minWidth: 84,
    paddingHorizontal: spacing.md,
  },
  payBtnText: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.textOnPrimary,
  },
  payBtnTextNarrow: {
    fontSize: 15,
  },
  sheetRoot: { flex: 1, justifyContent: 'flex-end', position: 'relative' },
  sheetOverlay: { flex: 1, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: '78%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  sheetActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sheetAction: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 72,
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceVariant,
  },
  sheetActionText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  sheetList: { maxHeight: 280 },
  line: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lineTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  lineBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lineInfo: { flex: 1, minWidth: 0, paddingRight: spacing.sm },
  lineName: { fontSize: 14, fontWeight: '700', color: colors.text },
  lineMeta: { fontSize: 12, color: colors.textMuted },
  priceTap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  priceEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 4,
    gap: 2,
  },
  pricePrefix: { fontSize: 14, fontWeight: '700', color: colors.text },
  priceInput: {
    minWidth: 88,
    height: 32,
    paddingVertical: 0,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  lineTotal: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.secondary,
    minWidth: 88,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.errorLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.successLight,
  },
  sheetSaveLbl: { fontSize: 13, fontWeight: '700', color: colors.secondaryDark },
  sheetSaveVal: { fontSize: 16, fontWeight: '800', color: colors.secondaryDark },
  sheetTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  sheetTotalMeta: { fontSize: 12, color: colors.textMuted, flex: 1, paddingRight: spacing.sm },
  sheetTotal: { fontSize: 22, fontWeight: '800', color: colors.text },
  sheetPay: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discountOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
    elevation: 20,
    paddingHorizontal: spacing.lg,
  },
  discountScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 27, 72, 0.45)',
  },
  discountCard: {
    width: '100%',
    maxWidth: 380,
    marginHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    zIndex: 21,
    elevation: 21,
  },
  discountTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  dialogHint: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  modeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceVariant,
  },
  modeBtnOn: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  modeBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modeBtnTextOn: { color: colors.primary },
  discountInput: { backgroundColor: colors.surface },
  discountError: {
    marginTop: spacing.sm,
    color: colors.error,
    fontSize: 13,
  },
  dialogActions: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dialogRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  shortcutBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    backgroundColor: colors.surfaceVariant,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: 'center',
  },
  shortcutItem: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  shortcutKey: {
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: colors.surface,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
