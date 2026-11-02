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
import QtyStepper from '../../components/ui/QtyStepper';
import CategoryPickerSheet from '../../components/ui/CategoryPickerSheet';
import {
  fetchProducts,
  flattenProductsToVariants,
  matchBarcodeProduct,
  searchProducts,
  type SearchProductResult,
} from '../../services/catalogService';
import { previewBill } from '../../services/businessService';
import { useProductAddToCart } from '../../hooks/useProductAddToCart';
import { useCartStore } from '../../store/cartStore';
import { colors } from '../../theme/colors';
import { common, radius, shadow, spacing } from '../../theme/layout';
import { formatQuantity } from '../../utils/quantity';
import { variantLabel } from '../../utils/variantLabel';
import ProductGridTile from './ProductGridTile';
import QuantityEntryDialog from './QuantityEntryDialog';
import CustomItemDialog from './CustomItemDialog';
import WideBillPanel from './WideBillPanel';

type Props = NativeStackScreenProps<MainStackParamList, 'Billing'>;
type DiscountMode = 'amount' | 'percent';

const GRID_GAP = spacing.sm;
const GRID_PAD = spacing.md;
const COLS = 3;
const BAR_HEIGHT = 64;
const CATALOG_TTL_MS = 60_000;

function cartQtyStep(uomCode?: string) {
  const code = (uomCode || '').toLowerCase();
  if (code === 'g' || code === 'ml') return 50;
  return 1;
}

function productMatches(product: SearchProductResult, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    product.productName.toLowerCase().includes(q) ||
    (product.sku || '').toLowerCase().includes(q) ||
    (product.size || '').toLowerCase().includes(q) ||
    (product.color || '').toLowerCase().includes(q) ||
    (product.barcodes || []).some((b) => b.toLowerCase().includes(q))
  );
}

export default function BillingScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [hostWidth, setHostWidth] = useState(windowWidth);
  const layoutWidth = hostWidth || windowWidth;
  const isWideBill = Platform.OS === 'web' && layoutWidth >= 900;
  const productWidth = isWideBill ? layoutWidth * 0.6 : layoutWidth;
  const cols = !isWideBill ? COLS : productWidth >= 1100 ? 4 : 3;
  const tileWidth = useMemo(() => {
    const inner = productWidth - GRID_PAD * 2 - GRID_GAP * (cols - 1);
    return Math.max(120, Math.floor(inner / cols));
  }, [productWidth, cols]);

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<SearchProductResult[]>([]);
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
  } | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountMode, setDiscountMode] = useState<DiscountMode>('amount');
  const [discountInput, setDiscountInput] = useState('');
  const [discountError, setDiscountError] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [debouncedQ, setDebouncedQ] = useState('');
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);

  const items = useCartStore((s) => s.items);
  const addItem = useCartStore((s) => s.addItem);
  const updateQty = useCartStore((s) => s.updateQty);
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
    if (!categoryId) return 'All';
    return categories.find((c) => c.id === categoryId)?.label || 'All';
  }, [categories, categoryId]);

  const onCategoryChange = useCallback((id: string | null) => {
    setCategoryId(id);
  }, []);

  const hasBillDiscount = billDiscountPercent > 0 || billDiscountAmount > 0;
  const runningTotal = useMemo(
    () => items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    [items],
  );

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

  const loadCatalog = useCallback(async (force = false) => {
    if (
      !force &&
      catalogLoadedAt.current > 0 &&
      Date.now() - catalogLoadedAt.current < CATALOG_TTL_MS
    ) {
      return;
    }
    try {
      setLoadError('');
      const result = await fetchProducts({ page: 1, limit: 500, status: 'active' });
      const flattened = flattenProductsToVariants(result?.items || []);
      catalogLoadedAt.current = Date.now();
      setCatalog(flattened);
      syncFromCatalog(flattened);
    } catch {
      setCatalog([]);
      setLoadError('Could not load products');
    }
  }, [syncFromCatalog]);

  useEffect(() => {
    setLoadingCatalog(true);
    loadCatalog(true).finally(() => setLoadingCatalog(false));
  }, [loadCatalog]);

  useFocusEffect(
    useCallback(() => {
      if (skipNextFocusLoad.current) {
        skipNextFocusLoad.current = false;
        return;
      }
      if (refreshAfterProductEdit.current) {
        refreshAfterProductEdit.current = false;
        void loadCatalog(true);
        return;
      }
      // Soft refresh — skipped when catalog is fresh (avoids lag after scan / back)
      loadCatalog(false);
    }, [loadCatalog]),
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
        discountAmount: i.discountAmount,
        discountPercent: i.discountPercent,
        isCustom: i.isCustom === true,
        productName: i.productName,
      })),
      billDiscountAmount,
      billDiscountPercent,
    };

    const timer = setTimeout(async () => {
      try {
        const result = await previewBill(snapshot);
        if (requestId !== previewReqId.current) return;
        setPreview({
          totalAmount: Number(result.totalAmount) || 0,
          taxAmount: Number(result.taxAmount) || 0,
          subtotal: Number(result.subtotal) || 0,
          discountAmount: Number(result.discountAmount) || 0,
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
    const t = setTimeout(() => setDebouncedQ(q), q ? 120 : 0);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (q.length < 2) {
      setRemoteResults([]);
      setSearching(false);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        setRemoteResults(await searchProducts(q));
      } catch {
        setRemoteResults([]);
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [q]);

  const gridItems = useMemo(() => {
    const inCategory = (p: SearchProductResult) =>
      !categoryId || p.categoryId === categoryId;

    if (debouncedQ) {
      const code = debouncedQ.trim();
      const local = catalog
        .filter((p) => inCategory(p) && productMatches(p, debouncedQ))
        .map((p) => matchBarcodeProduct([p], code) || p);
      if (debouncedQ.length < 2) return local;
      const seen = new Set(local.map((p) => p.variantId));
      const extra = remoteResults.filter((p) => inCategory(p) && !seen.has(p.variantId));
      return extra.length ? [...local, ...extra] : local;
    }
    if (!categoryId) return catalog;
    return catalog.filter(inCategory);
  }, [catalog, debouncedQ, remoteResults, categoryId]);

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
      setDiscountError('Enter a valid number');
      return;
    }
    if (discountMode === 'percent') {
      if (value > 100) {
        setDiscountError('Percent cannot exceed 100');
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

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    let buffer = '';
    let lastKey = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (pendingProduct || discountOpen || customOpen) {
        buffer = '';
        return;
      }
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const typingInField =
        tag === 'INPUT' || tag === 'TEXTAREA' || !!el?.isContentEditable;

      const now = Date.now();
      if (now - lastKey > 80) buffer = '';
      lastKey = now;

      if (event.key === 'Enter') {
        const code = buffer.trim();
        buffer = '';
        if (code.length >= 3) {
          // Scanner wedge: digits then Enter (works even when search input is focused).
          event.preventDefault();
          void commitScan(code);
        }
        return;
      }

      if (typingInField) {
        // Still capture fast wedge keystrokes while search is focused; input also receives them.
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
  }, [commitScan, customOpen, discountOpen, pendingProduct]);

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
    Alert.alert('Clear bill?', 'Remove all items from this bill?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
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

  const addCustomItem = (item: { name: string; price: number; quantity: number }) => {
    addItem({
      variantId: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      productName: item.name,
      sku: 'CUSTOM',
      quantity: item.quantity,
      unitPrice: item.price,
      isCustom: true,
      allowDecimalQty: true,
      stockQty: 0,
    });
    setCustomOpen(false);
  };

  const goPay = () => {
    setCartOpen(false);
    navigation.navigate('Payment');
  };

  const renderProduct = useCallback(
    ({ item }: { item: SearchProductResult }) => (
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
    ),
    [qtyByVariant, tileWidth, addProduct, handleIncrease, handleDecrease, handleEditQty, handleEditProduct],
  );

  const searchingNow = searching && q.length >= 2;
  const barPad = !isWideBill && hasItems
    ? BAR_HEIGHT + Math.max(insets.bottom, spacing.sm) + spacing.md
    : spacing.lg;
  const qtyLabel = itemCount % 1 === 0 ? String(itemCount) : itemCount.toFixed(2);
  const gridContentStyle = useMemo(
    () => [styles.gridContent, { paddingBottom: barPad }, !gridItems.length && styles.gridEmpty],
    [barPad, gridItems.length],
  );

  const renderCartLine = ({ item }: { item: (typeof items)[number] }) => {
    const lineTotal = item.unitPrice * item.quantity;
    const size = variantLabel(item.size, item.color);
    return (
      <View style={styles.line}>
        <View style={styles.lineTop}>
          <View style={styles.lineInfo}>
            <Text style={styles.lineName} numberOfLines={1}>
              {item.productName}
              {item.isCustom ? ' · Custom' : size ? ` · ${size}` : ''}
            </Text>
            <Text style={styles.lineMeta}>₹{item.unitPrice}{item.uom?.code ? `/${item.uom.code}` : ''}</Text>
          </View>
          <Pressable onPress={() => removeItem(item.variantId)} hitSlop={10} style={styles.removeBtn}>
            <Icon name="close" size={16} color={colors.textMuted} />
          </Pressable>
        </View>
        <View style={styles.lineBottom}>
          <QtyStepper
            value={
              item.allowDecimalQty
                ? formatQuantity(item.quantity, item.uom)
                : item.quantity
            }
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
      <View style={[styles.header, isWideBill && styles.headerCompact]}>
        {!isWideBill ? (
          <View style={styles.actionsRow}>
            <Pressable
              onPress={() => navigation.navigate('ProductForm')}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
              accessibilityLabel="Add product">
              <Icon name="package-variant" size={24} color={colors.primary} />
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('HeldBills')}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
              accessibilityLabel="Held bills">
              <Icon name="pause-circle-outline" size={22} color={colors.primary} />
            </Pressable>
            <Pressable
              onPress={() => setCustomOpen(true)}
              style={({ pressed }) => [styles.iconBtn, styles.customBtn, pressed && styles.pressed]}
              accessibilityLabel="Custom item">
              <Icon name="cart-plus" size={24} color={colors.primary} />
            </Pressable>
            <View style={styles.actionsSpacer} />
            <Pressable
              onPress={() => navigation.navigate('BarcodeScanner')}
              style={({ pressed }) => [styles.scanBtn, pressed && styles.pressed]}
              accessibilityLabel="Scan barcode">
              <Icon name="barcode-scan" size={24} color={colors.textOnPrimary} />
            </Pressable>
          </View>
        ) : null}
        <View style={styles.searchRow}>
          {isWideBill ? (
            <>
              <Pressable
                onPress={() => navigation.navigate('ProductForm')}
                style={({ pressed }) => [styles.iconBtnSm, pressed && styles.pressed]}
                accessibilityLabel="Add product">
                <Icon name="package-variant" size={20} color={colors.primary} />
              </Pressable>
              <Pressable
                onPress={() => navigation.navigate('HeldBills')}
                style={({ pressed }) => [styles.iconBtnSm, pressed && styles.pressed]}
                accessibilityLabel="Held bills">
                <Icon name="pause-circle-outline" size={20} color={colors.primary} />
              </Pressable>
              <Pressable
                onPress={() => setCustomOpen(true)}
                style={({ pressed }) => [styles.iconBtnSm, pressed && styles.pressed]}
                accessibilityLabel="Custom item">
                <Icon name="cart-plus" size={20} color={colors.primary} />
              </Pressable>
            </>
          ) : null}
          <View style={[styles.searchBox, isWideBill && styles.searchBoxCompact]}>
            <Icon name="magnify" size={20} color={colors.textMuted} />
            <TextInput
              ref={searchRef}
              value={search}
              onChangeText={setSearch}
              onSubmitEditing={(e) => {
                void commitScan(e.nativeEvent.text || search);
              }}
              placeholder="Search name, SKU, barcode"
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
                categoryId ? styles.categoryBtnOn : null,
              ]}
              accessibilityLabel="Filter by category">
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
                  accessibilityLabel="Clear category">
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
              accessibilityLabel="Scan barcode">
              <Icon name="barcode-scan" size={20} color={colors.textOnPrimary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        data={gridItems}
        key={`grid-${cols}`}
        keyExtractor={(item) => item.variantId}
        numColumns={cols}
        style={styles.fill}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        maxToRenderPerBatch={9}
        updateCellsBatchingPeriod={50}
        windowSize={5}
        removeClippedSubviews
        contentContainerStyle={gridContentStyle}
        columnWrapperStyle={styles.gridRow}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        ListEmptyComponent={
          loadingCatalog ? (
            <View style={styles.emptyWrap}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.emptySubtitle}>Loading products…</Text>
            </View>
          ) : (
            <View style={styles.emptyWrap}>
              <Icon name="package-variant-closed" size={42} color={colors.primary} />
              <Text style={styles.emptyTitle}>
                {loadError || (q ? 'No matching products' : 'No products yet')}
              </Text>
              <Text style={styles.emptySubtitle}>
                {loadError
                  ? 'Pull to refresh, or scan a barcode'
                  : q
                    ? `Nothing found for “${q}”`
                    : 'Add a product, or use Custom item'}
              </Text>
              {!loadError ? (
                <View style={styles.emptyActions}>
                  <Button
                    mode="contained"
                    icon="cart-plus"
                    style={styles.emptyAddBtn}
                    onPress={() => setCustomOpen(true)}>
                    Custom item
                  </Button>
                  <Button
                    mode="outlined"
                    icon="package-variant"
                    style={styles.emptyAddBtn}
                    onPress={() => navigation.navigate('ProductForm')}>
                    Add product
                  </Button>
                </View>
              ) : null}
            </View>
          )
        }
        renderItem={renderProduct}
        extraData={qtyByVariant}
      />

      {hasItems && !isWideBill ? (
        <View style={[styles.payBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
          <Pressable
            onPress={() => setCartOpen(true)}
            style={({ pressed }) => [styles.billPeek, pressed && styles.pressed]}
            accessibilityLabel="Open bill">
            <View style={styles.billBadge}>
              <Text style={styles.billBadgeText}>{qtyLabel}</Text>
            </View>
            <View style={styles.billPeekText}>
              <Text style={styles.billPeekLabel}>
                View bill
                {billTotals.discountAmount > 0
                  ? ` · −₹${billTotals.discountAmount.toFixed(2)}`
                  : ''}
              </Text>
              <Text style={styles.billPeekTotal}>{totalLabel}</Text>
            </View>
            <Icon name="chevron-up" size={20} color={colors.textMuted} />
          </Pressable>
          <Pressable
            onPress={goPay}
            style={({ pressed }) => [styles.payBtn, pressed && styles.pressed]}
            accessibilityLabel="Proceed to payment">
            <Text style={styles.payBtnText}>Pay</Text>
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
        <View style={styles.sheetRoot}>
          <Pressable style={styles.sheetOverlay} onPress={() => setCartOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Current bill</Text>
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
                  {customerName || 'Customer'}
                </Text>
              </Pressable>
              <Pressable onPress={openDiscount} style={styles.sheetAction}>
                <Icon name="percent-outline" size={18} color={hasBillDiscount ? colors.secondary : colors.primary} />
                <Text style={styles.sheetActionText} numberOfLines={1}>
                  {billDiscountPercent > 0
                    ? `${billDiscountPercent}% off`
                    : billDiscountAmount > 0
                      ? `₹${billDiscountAmount} off`
                      : 'Discount'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setCartOpen(false);
                  navigation.navigate('HoldBill');
                }}
                style={styles.sheetAction}>
                <Icon name="content-save-outline" size={18} color={colors.primary} />
                <Text style={styles.sheetActionText}>Hold</Text>
              </Pressable>
              <Pressable onPress={confirmClear} style={styles.sheetAction}>
                <Icon name="trash-can-outline" size={18} color={colors.error} />
                <Text style={[styles.sheetActionText, { color: colors.error }]}>Clear</Text>
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
                {qtyLabel} qty
                {billTotals.taxAmount > 0 ? ` · Tax ₹${billTotals.taxAmount.toFixed(2)}` : ''}
                {billTotals.discountAmount > 0 ? ` · Disc -₹${billTotals.discountAmount.toFixed(2)}` : ''}
              </Text>
              <Text style={styles.sheetTotal}>{totalLabel}</Text>
            </View>

            <Pressable onPress={goPay} style={({ pressed }) => [styles.sheetPay, pressed && styles.pressed]}>
              <Text style={styles.payBtnText}>Pay {totalLabel}</Text>
            </Pressable>
          </View>

          {discountOpen ? (
            <View style={styles.discountOverlay} pointerEvents="box-none">
              <Pressable style={styles.discountScrim} onPress={() => setDiscountOpen(false)} />
              <View style={[styles.discountCard, { marginBottom: Math.max(insets.bottom, spacing.md) }]}>
                <Text style={styles.discountTitle}>Bill discount</Text>
                <Text style={styles.dialogHint}>Apply on the whole bill — pick ₹ amount or %</Text>
                <View style={styles.modeRow}>
                  <Pressable
                    onPress={() => {
                      setDiscountMode('amount');
                      setDiscountError('');
                    }}
                    style={[styles.modeBtn, discountMode === 'amount' && styles.modeBtnOn]}>
                    <Text style={[styles.modeBtnText, discountMode === 'amount' && styles.modeBtnTextOn]}>
                      ₹ Amount
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setDiscountMode('percent');
                      setDiscountError('');
                    }}
                    style={[styles.modeBtn, discountMode === 'percent' && styles.modeBtnOn]}>
                    <Text style={[styles.modeBtnText, discountMode === 'percent' && styles.modeBtnTextOn]}>
                      % Percent
                    </Text>
                  </Pressable>
                </View>
                <PaperInput
                  label={discountMode === 'percent' ? 'Discount %' : 'Discount ₹'}
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
                    Remove
                  </Button>
                  <View style={styles.dialogRight}>
                    <Button onPress={() => setDiscountOpen(false)}>Cancel</Button>
                    <Button mode="contained" onPress={applyDiscount}>
                      Apply
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
    borderBottomColor: colors.borderLight,
  },
  headerCompact: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
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
  searchBox: {
    flex: 1,
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
  searchInput: {
    flex: 1,
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
  },
  categoryBtnCompact: {
    height: 38,
    minWidth: 84,
    maxWidth: 120,
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
    paddingHorizontal: GRID_PAD,
    paddingTop: spacing.md,
  },
  gridEmpty: { flexGrow: 1, justifyContent: 'center' },
  gridRow: {
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
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
    borderTopColor: colors.borderLight,
    ...shadow.lg,
  },
  billPeek: {
    flex: 1,
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
  billPeekText: { flex: 1 },
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
  payBtn: {
    minWidth: 108,
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payBtnText: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.textOnPrimary,
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
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sheetAction: {
    flex: 1,
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
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
  lineMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  lineTotal: { fontSize: 16, fontWeight: '800', color: colors.secondary },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    justifyContent: 'flex-end',
    zIndex: 20,
    elevation: 20,
  },
  discountScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 27, 72, 0.45)',
  },
  discountCard: {
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
});
