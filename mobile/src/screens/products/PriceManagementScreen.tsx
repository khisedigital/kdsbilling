import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Text, TextInput as PaperInput } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import AppTextInput from '../../components/ui/AppTextInput';
import EmptyState from '../../components/ui/EmptyState';
import ProductSearchField from '../../components/ProductSearchField';
import CategoryPickerSheet from '../../components/ui/CategoryPickerSheet';
import { useT } from '../../i18n';
import { useLanguageStore } from '../../i18n/languageStore';
import { fillMarathiFromEnglish } from '../../hooks/useAutoMarathi';
import { useKeyboardOverlap } from '../../hooks/useKeyboardOverlap';
import {
  getCatalogRevision,
  isCatalogCacheEnabled,
  readCachedCategories,
  readCachedProducts,
  subscribeCatalogChanges,
  type CatalogPricePatch,
} from '../../services/catalogCache';
import {
  bulkUpdateVariantPricing,
  fetchCategories,
  fetchProduct,
  fetchProducts,
  isProductFavorite,
  setProductFavorite,
  setProductsFavoriteBulk,
  mainBarcodeOf,
  plainBarcodesOf,
  syncCatalogFromMaster,
  type PriceBulkItem,
  type SearchProductResult,
} from '../../services/catalogService';
import type { Category, Product } from '../../types/catalog';
import { apiError } from '../../utils/apiError';
import { localizedLabel } from '../../utils/productName';
import { variantLabel } from '../../utils/variantLabel';
import { colors } from '../../theme/colors';
import { common, radius, shadow, spacing } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'PriceManagement'>;

const PAGE_SIZE = 80;

type PriceRow = {
  key: string;
  productId: string;
  variantId: string;
  name: string;
  nameMr: string;
  isFavorite: boolean;
  variantLabel: string;
  categoryId: string | null;
  categoryName: string;
  brandId: string | null;
  brandName: string;
  costPrice: string;
  mrp: string;
  sellingPrice: string;
  barcode: string;
  extraBarcodes: string[];
  stockQty: string;
  original: {
    name: string;
    nameMr: string;
    costPrice: string;
    mrp: string;
    sellingPrice: string;
    barcode: string;
    extraBarcodes: string[];
    stockQty: string;
  };
};

type StockFilter = 'all' | 'in_stock' | 'low' | 'out';
type IssueFilter = 'all' | 'missing_mrp' | 'below_cost' | 'no_barcode' | 'no_selling_price';
type ViewMode = 'products' | 'variants';
type FocusField = 'name' | 'nameMr' | 'cost' | 'mrp' | 'selling' | 'barcode' | 'stock' | null;

type ProductGroup = {
  productId: string;
  name: string;
  nameMr: string;
  isFavorite: boolean;
  categoryName: string;
  brandName: string;
  variants: PriceRow[];
};

function moneyStr(value: string | number | null | undefined): string {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (Number.isNaN(n)) return '';
  return String(n);
}

function toRows(products: Product[]): PriceRow[] {
  const rows: PriceRow[] = [];
  for (const product of products) {
    for (const variant of product.variants || []) {
      const costPrice = moneyStr(variant.cost_price ?? (variant as any).costPrice);
      const mrp = moneyStr(variant.mrp);
      const sellingPrice = moneyStr(variant.selling_price ?? (variant as any).sellingPrice);
      const plains = plainBarcodesOf(variant);
      const barcode = plains[0] || mainBarcodeOf(variant) || '';
      const extraBarcodes = plains.slice(1);
      const stockQty = moneyStr(
        (variant as { stockQty?: number; stock_qty?: number }).stockQty
          ?? (variant as { stock_qty?: number }).stock_qty
          ?? 0,
      ) || '0';
      const name = product.name || '';
      const nameMr = product.name_mr || (product as any).nameMr || '';
      const isFavorite = isProductFavorite(product);
      const label = variantLabel(variant.size, variant.color) || 'Default';
      rows.push({
        key: variant.id,
        productId: product.id,
        variantId: variant.id,
        name,
        nameMr,
        isFavorite,
        variantLabel: label,
        categoryId: product.category_id || product.category?.id || null,
        categoryName: product.category?.name || '',
        brandId: product.brand_id || product.brand?.id || null,
        brandName: product.brand?.name || '',
        costPrice,
        mrp,
        sellingPrice,
        barcode,
        extraBarcodes,
        stockQty,
        original: { name, nameMr, costPrice, mrp, sellingPrice, barcode, extraBarcodes: [...extraBarcodes], stockQty },
      });
    }
  }
  // Keep server/page order while starring — client re-sort jumps the row away.
  return rows;
}

function sameExtras(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  return a.every((code, i) => code === b[i]);
}

function isDirty(row: PriceRow): boolean {
  const o = row.original;
  return (
    row.name !== o.name
    || row.nameMr !== o.nameMr
    || row.costPrice !== o.costPrice
    || row.mrp !== o.mrp
    || row.sellingPrice !== o.sellingPrice
    || row.barcode !== o.barcode
    || !sameExtras(row.extraBarcodes || [], o.extraBarcodes || [])
    || row.stockQty !== o.stockQty
  );
}

function moneyRange(values: string[]) {
  const nums = values
    .map((v) => parseFloat(v))
    .filter((n) => !Number.isNaN(n) && n > 0);
  if (!nums.length) return '—';
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min === max) return `₹${min.toFixed(2)}`;
  return `₹${min.toFixed(0)}–${max.toFixed(0)}`;
}

function groupByProduct(rows: PriceRow[]): ProductGroup[] {
  const order: string[] = [];
  const map = new Map<string, ProductGroup>();
  for (const row of rows) {
    let group = map.get(row.productId);
    if (!group) {
      group = {
        productId: row.productId,
        name: row.name,
        nameMr: row.nameMr,
        isFavorite: row.isFavorite,
        categoryName: row.categoryName,
        brandName: row.brandName,
        variants: [],
      };
      map.set(row.productId, group);
      order.push(row.productId);
    }
    group.variants.push(row);
    group.name = row.name;
    group.nameMr = row.nameMr;
    group.isFavorite = row.isFavorite;
  }
  // Keep the loaded list order while editing — re-sorting by name makes rows jump away.
  return order.map((id) => map.get(id)!);
}

function Field({
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  align = 'left',
  prefix,
  focused,
  onFocus,
  onBlur,
  mono,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  align?: 'left' | 'right';
  prefix?: string;
  focused?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  mono?: boolean;
}) {
  return (
    <View style={[styles.field, focused && styles.fieldFocused]}>
      {prefix ? <Text style={styles.fieldPrefix}>{prefix}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        onFocus={onFocus}
        onBlur={onBlur}
        numberOfLines={1}
        style={[
          styles.fieldInput,
          align === 'right' && styles.fieldRight,
          mono && styles.fieldMono,
        ]}
      />
    </View>
  );
}

function FilterPill({
  label,
  active,
  tone = 'default',
  onPress,
}: {
  label: string;
  active: boolean;
  tone?: 'default' | 'warn' | 'danger';
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.pill,
        active && styles.pillOn,
        active && tone === 'warn' && styles.pillWarn,
        active && tone === 'danger' && styles.pillDanger,
      ]}>
      <Text
        style={[
          styles.pillText,
          active && styles.pillTextOn,
          active && tone === 'warn' && styles.pillTextWarn,
          active && tone === 'danger' && styles.pillTextDanger,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Column / field label with a red * for required fields. */
function RequiredLabel({
  label,
  required,
  style,
}: {
  label: string;
  required?: boolean;
  style?: object | object[];
}) {
  if (!required) return <Text style={style}>{label}</Text>;
  return (
    <Text style={style}>
      {label}
      <Text style={styles.reqMark}> *</Text>
    </Text>
  );
}

function requiredFieldLabel(label: string) {
  return (
    <Text>
      {label}
      <Text style={styles.reqMark}> *</Text>
    </Text>
  );
}

export default function PriceManagementScreen({ navigation, route }: Props) {
  const t = useT();
  const ui = useLanguageStore((s) => s.ui);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keyboardOverlap = useKeyboardOverlap();
  /** Phone / narrow: lookup one product (scan/search), then edit — not a full catalog table. */
  const compact = width < 720;
  const tRef = useRef(t);
  tRef.current = t;
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [issueFilter, setIssueFilter] = useState<IssueFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('products');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [favoritingAll, setFavoritingAll] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [focusField, setFocusField] = useState<FocusField>(null);
  const [loading, setLoading] = useState(!compact);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const skipNextFocus = useRef(true);
  const loadingMoreRef = useRef(false);
  const searchRef = useRef(search);
  searchRef.current = search;
  const selectedProductIdRef = useRef(selectedProductId);
  selectedProductIdRef.current = selectedProductId;
  const listRef = useRef<FlatList>(null);
  const scrollYRef = useRef(0);
  const pinScrollRef = useRef(false);
  const editingRef = useRef(false);
  const hydratedFromCacheRef = useRef(false);
  const lastLoadedAtRef = useRef(0);
  const catalogRevisionSeen = useRef(getCatalogRevision());
  /** Bumps on each list fetch so a slow search cannot wipe results after clear. */
  const loadSeqRef = useRef(0);
  const handledScanNonce = useRef<number | null>(null);

  const loadMeta = useCallback(async () => {
    // Disk cache first so filters paint without waiting on the network.
    const cached = await readCachedCategories().catch(() => null);
    if (cached?.length) setCategories(cached);
    setCategories((await fetchCategories().catch(() => cached || [] as Category[])) || []);
    void syncCatalogFromMaster().then(async () => {
      setCategories((await fetchCategories().catch(() => [] as Category[])) || []);
    }).catch(() => null);
  }, []);

  const hydrateFromCache = useCallback(async () => {
    if (!isCatalogCacheEnabled()) return false;
    // Desktop local DB: never paint stock from disk cache — always wait for SQLite load.
    try {
      const { shouldUseLocalCatalog } = await import('../../offline/localCatalog');
      if (shouldUseLocalCatalog()) {
        const cachedCats = await readCachedCategories();
        if (cachedCats?.length) setCategories(cachedCats);
        return false;
      }
    } catch {
      /* fall through */
    }
    const [cachedCats, cachedProducts] = await Promise.all([
      readCachedCategories(),
      readCachedProducts(),
    ]);
    if (cachedCats?.length) {
      setCategories(cachedCats);
    }
    // Only treat as hydrated when products are present — categories alone must not
    // block the empty-list reload after clearing search.
    if (cachedProducts?.items?.length) {
      const active = cachedProducts.items.filter((p) => p.status !== 'inactive');
      setRows(toRows(active.slice(0, PAGE_SIZE)));
      setTotalCount(cachedProducts.total);
      setPage(1);
      setHasMore(cachedProducts.total > PAGE_SIZE);
      setLoading(false);
      hydratedFromCacheRef.current = true;
      return true;
    }
    return false;
  }, []);

  const loadSelectedProduct = useCallback(async (productId: string) => {
    if (!productId) return;
    setLookupLoading(true);
    setLoading(true);
    setToast(null);
    try {
      const product = await fetchProduct(productId);
      const nextRows = toRows([product]);
      setRows(nextRows);
      setSelectedProductId(product.id);
      setTotalCount(1);
      setPage(1);
      setHasMore(false);
      setExpandedIds(new Set(
        nextRows.length > 1 ? [product.id] : [],
      ));
      setViewMode('products');
      setStockFilter('all');
      setIssueFilter('all');
      setSearch('');
    } catch (err) {
      setToast({ type: 'err', text: apiError(err, tRef.current('Could not load products')) });
    } finally {
      setLookupLoading(false);
      setLoading(false);
    }
  }, []);

  const selectProductById = useCallback((productId: string) => {
    if (!productId) return;
    const switching = selectedProductIdRef.current
      && selectedProductIdRef.current !== productId;
    const dirty = switching ? rows.filter(isDirty).length : 0;
    if (dirty) {
      Alert.alert(
        tRef.current('Discard edits?'),
        dirty === 1
          ? tRef.current('{{count}} unsaved change will be lost.', { count: dirty })
          : tRef.current('{{count}} unsaved changes will be lost.', { count: dirty }),
        [
          { text: tRef.current('Keep editing'), style: 'cancel' },
          {
            text: tRef.current('Discard'),
            style: 'destructive',
            onPress: () => { void loadSelectedProduct(productId); },
          },
        ],
      );
      return;
    }
    void loadSelectedProduct(productId);
  }, [loadSelectedProduct, rows]);

  const clearSelectedProduct = useCallback(() => {
    setRows([]);
    setSelectedProductId(null);
    setTotalCount(0);
    setHasMore(false);
    setExpandedIds(new Set());
    setToast(null);
  }, []);

  const requestClearSelectedProduct = useCallback(() => {
    const dirty = rows.filter(isDirty).length;
    if (!dirty) {
      clearSelectedProduct();
      return;
    }
    Alert.alert(
      t('Discard edits?'),
      dirty === 1
        ? t('{{count}} unsaved change will be lost.', { count: dirty })
        : t('{{count}} unsaved changes will be lost.', { count: dirty }),
      [
        { text: t('Keep editing'), style: 'cancel' },
        { text: t('Discard'), style: 'destructive', onPress: clearSelectedProduct },
      ],
    );
  }, [clearSelectedProduct, rows, t]);

  const onPickSearchProduct = useCallback((item: SearchProductResult) => {
    if (!item.productId) {
      Alert.alert(t('Error'), t('Selected product has no id.'));
      return;
    }
    void selectProductById(item.productId);
  }, [selectProductById, t]);

  const openPriceScanner = useCallback(() => {
    navigation.navigate('BarcodeScanner', { purpose: 'priceManagement' });
  }, [navigation]);

  const load = useCallback(async (
    query = '',
    pageNum = 1,
    append = false,
  ) => {
    const seq = append ? loadSeqRef.current : ++loadSeqRef.current;
    const result = await fetchProducts({
      page: pageNum,
      limit: PAGE_SIZE,
      search: query.trim() || undefined,
      categoryId: categoryId || undefined,
      status: 'active',
    });
    if (seq !== loadSeqRef.current) return;
    const items = result?.items || [];
    const total = result?.pagination?.total ?? items.length;
    const totalPages = result?.pagination?.totalPages || 1;
    const nextRows = toRows(items);
    setTotalCount(total);
    setPage(pageNum);
    setHasMore(pageNum < totalPages);
    setRows((prev) => (append ? [...prev, ...nextRows] : nextRows));
    if (!append) {
      lastLoadedAtRef.current = Date.now();
      catalogRevisionSeen.current = getCatalogRevision();
    }
  }, [categoryId]);

  const loadMore = useCallback(async () => {
    if (compact) return;
    // Don't fetch more while typing — layout changes jump the list away from the row.
    if (editingRef.current || pinScrollRef.current) return;
    if (loadingMoreRef.current || loading || refreshing || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      await load(searchRef.current, page + 1, true);
    } catch {
      // Keep already loaded rows.
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [compact, hasMore, load, loading, page, refreshing]);

  // Categories once per mount (desktop filters + mobile lookup category picker).
  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  // Desktop catalog browse. Mobile waits for scan/search instead of loading everything.
  useEffect(() => {
    if (compact) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      const browsingDefault = !search.trim() && !categoryId;
      if (browsingDefault && !hydratedFromCacheRef.current) {
        const hit = await hydrateFromCache();
        if (cancelled) return;
        if (!hit) {
          setLoading(true);
          setHasMore(false);
        }
      } else if (!browsingDefault) {
        setLoading(true);
        setHasMore(false);
      }

      try {
        await load(search, 1, false);
      } catch (err) {
        if (!cancelled && !hydratedFromCacheRef.current) {
          setRows([]);
          setTotalCount(0);
          setToast({ type: 'err', text: apiError(err, tRef.current('Could not load products')) });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (!search.trim()) {
      void run();
    } else {
      timer = setTimeout(() => {
        void run();
      }, 280);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [compact, hydrateFromCache, load, search, categoryId]);

  // Scanner returns here with a product id.
  useEffect(() => {
    if (!compact) return;
    const productId = route.params?.scannedProductId;
    const nonce = route.params?.scanNonce;
    if (!productId || !nonce) return;
    if (handledScanNonce.current === nonce) return;
    handledScanNonce.current = nonce;
    void selectProductById(productId);
  }, [compact, route.params?.scannedProductId, route.params?.scanNonce, selectProductById]);

  const dirtyCount = useMemo(() => rows.filter(isDirty).length, [rows]);
  const dirtyCountRef = useRef(0);
  dirtyCountRef.current = dirtyCount;

  /** Live stock/price patches (e.g. Add stock on Product Detail) — update visible rows immediately. */
  useEffect(() => {
    return subscribeCatalogChanges((revision, pricePatches) => {
      if (revision === catalogRevisionSeen.current) return;
      catalogRevisionSeen.current = revision;
      const stockPatches = (pricePatches || []).filter(
        (p: CatalogPricePatch) => p.variantId && p.stockQty !== undefined,
      );
      if (stockPatches.length && dirtyCountRef.current === 0) {
        const byVariant = new Map(stockPatches.map((p) => [p.variantId, p]));
        setRows((prev) => {
          let changed = false;
          const next = prev.map((row) => {
            const patch = byVariant.get(row.variantId);
            if (!patch || patch.stockQty === undefined) return row;
            const stockQty = moneyStr(patch.stockQty) || '0';
            if (stockQty === row.stockQty) return row;
            changed = true;
            return {
              ...row,
              stockQty,
              original: { ...row.original, stockQty },
            };
          });
          return changed ? next : prev;
        });
      }
      // Also refresh from SQLite so list/search aren't stuck on disk cache.
      if (dirtyCountRef.current > 0 || compact) return;
      load(searchRef.current, 1, false).catch(() => {});
    });
  }, [compact, load]);

  useFocusEffect(
    useCallback(() => {
      if (compact) return;
      if (skipNextFocus.current) {
        skipNextFocus.current = false;
        return;
      }
      // Never wipe in-progress price edits on tab focus.
      if (dirtyCountRef.current > 0) return;
      const revision = getCatalogRevision();
      const stale =
        revision !== catalogRevisionSeen.current
        || !lastLoadedAtRef.current
        || Date.now() - lastLoadedAtRef.current > 2 * 60_000;
      if (!stale) return;
      catalogRevisionSeen.current = revision;
      load(searchRef.current, 1, false).catch(() => {});
    }, [compact, load]),
  );

  const stats = useMemo(() => {
    let belowCost = 0;
    let noBarcode = 0;
    let noSellingPrice = 0;
    let out = 0;
    const productIds = new Set<string>();
    for (const row of rows) {
      productIds.add(row.productId);
      const cost = parseFloat(row.costPrice) || 0;
      const selling = parseFloat(row.sellingPrice) || 0;
      const stock = parseFloat(row.stockQty) || 0;
      if (selling > 0 && cost > 0 && selling < cost) belowCost += 1;
      if (!row.barcode.trim()) noBarcode += 1;
      if (!(selling > 0)) noSellingPrice += 1;
      if (stock <= 0) out += 1;
    }
    return {
      products: productIds.size,
      variants: rows.length,
      belowCost,
      noBarcode,
      noSellingPrice,
      out,
      dirty: dirtyCount,
    };
  }, [rows, dirtyCount]);

  const filtered = useMemo(() => {
    // Search/category already applied by the API — only apply local stock/issue filters.
    const needsLocalFilter = stockFilter !== 'all' || issueFilter !== 'all';
    if (!needsLocalFilter) return rows;
    return rows.filter((row) => {
      // Keep in-progress edits on screen even if filters no longer match.
      if (isDirty(row)) return true;

      const stock = parseFloat(row.stockQty) || 0;
      if (stockFilter === 'in_stock' && stock <= 0) return false;
      if (stockFilter === 'out' && stock > 0) return false;
      if (stockFilter === 'low' && !(stock > 0 && stock <= 5)) return false;

      const cost = parseFloat(row.costPrice) || 0;
      const selling = parseFloat(row.sellingPrice) || 0;
      if (issueFilter === 'missing_mrp' && row.mrp.trim()) return false;
      if (issueFilter === 'no_barcode' && row.barcode.trim()) return false;
      if (issueFilter === 'no_selling_price' && selling > 0) return false;
      if (issueFilter === 'below_cost' && !(selling > 0 && cost > 0 && selling < cost)) return false;
      return true;
    });
  }, [rows, stockFilter, issueFilter]);

  const productGroups = useMemo(() => groupByProduct(filtered), [filtered]);

  const toggleExpanded = useCallback((productId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (viewMode !== 'products') return;
    const q = search.trim().toLowerCase();
    if (!q) return;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const group of productGroups) {
        if (group.variants.length <= 1) continue;
        const hit = group.variants.some((row) => (
          row.variantLabel.toLowerCase().includes(q)
          || row.barcode.toLowerCase().includes(q)
        ));
        if (hit && !next.has(group.productId)) {
          next.add(group.productId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // Only re-expand when the search string changes — not on every keystroke edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, viewMode]);

  const categoryOptions = useMemo(
    () => categories.map((c) => {
      const label = localizedLabel(c.name, c, ui);
      const other = ui === 'mr' ? (c.name || '') : (c.name_mr || c.nameMr || '');
      return {
        id: c.id,
        label,
        searchText: other && other !== label ? String(other) : undefined,
      };
    }),
    [categories, ui],
  );

  const patchRow = (key: string, patch: Partial<PriceRow>) => {
    pinScrollRef.current = true;
    editingRef.current = true;
    setRows((prev) => {
      const target = prev.find((row) => row.key === key);
      if (!target) return prev;
      return prev.map((row) => {
        if (row.key === key) return { ...row, ...patch };
        if (patch.name !== undefined && row.productId === target.productId) {
          return { ...row, name: patch.name };
        }
        if (patch.nameMr !== undefined && row.productId === target.productId) {
          return { ...row, nameMr: patch.nameMr };
        }
        return row;
      });
    });
  };

  const nameTranslateTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  /** Patch English name and auto-fill Marathi when that field is still empty. */
  const patchName = (key: string, name: string) => {
    patchRow(key, { name });
    const timers = nameTranslateTimers.current;
    if (timers[key]) clearTimeout(timers[key]);
    timers[key] = setTimeout(() => {
      void (async () => {
        const mr = await fillMarathiFromEnglish(name);
        if (!mr) return;
        setRows((prev) => {
          const target = prev.find((row) => row.key === key);
          if (!target || target.name !== name) return prev;
          if (target.nameMr.trim()) return prev;
          return prev.map((row) => (
            row.productId === target.productId ? { ...row, nameMr: mr } : row
          ));
        });
      })();
    }, 550);
  };

  const discardChanges = () => {
    setRows((prev) => prev.map((row) => ({
      ...row,
      name: row.original.name,
      nameMr: row.original.nameMr,
      costPrice: row.original.costPrice,
      mrp: row.original.mrp,
      sellingPrice: row.original.sellingPrice,
      barcode: row.original.barcode,
      extraBarcodes: [...(row.original.extraBarcodes || [])],
      stockQty: row.original.stockQty,
    })));
    setToast(null);
  };

  const saveChanges = async () => {
    const dirty = rows.filter(isDirty);
    if (!dirty.length) return;
    const items: PriceBulkItem[] = [];
    for (const row of dirty) {
      if (!row.name.trim()) {
        setToast({ type: 'err', text: t('Product name is required') });
        return;
      }
      const selling = parseFloat(row.sellingPrice);
      if (!(selling > 0)) {
        setToast({ type: 'err', text: t('Selling price required · {{name}}', { name: row.name }) });
        return;
      }
      const stock = parseFloat(row.stockQty);
      if (Number.isNaN(stock) || stock < 0) {
        setToast({ type: 'err', text: t('Invalid stock · {{name}}', { name: row.name }) });
        return;
      }
      const barcodes = [
        row.barcode.trim(),
        ...(row.extraBarcodes || []).map((c) => c.trim()).filter(Boolean),
      ].filter(Boolean);
      items.push({
        variantId: row.variantId,
        productId: row.productId,
        name: row.name.trim(),
        nameMr: row.nameMr.trim() || null,
        sellingPrice: selling,
        costPrice: parseFloat(row.costPrice) || 0,
        mrp: row.mrp.trim() === '' ? null : (parseFloat(row.mrp) || 0),
        barcode: barcodes[0] || undefined,
        barcodes: barcodes.length ? barcodes : undefined,
        stockQty: stock,
      });
    }

    setSaving(true);
    setToast(null);
    try {
      await bulkUpdateVariantPricing(items);
      // Mark saved rows clean locally — avoid a full catalog refetch that drops scroll/pages.
      const savedKeys = new Set(items.map((item) => item.variantId));
      setRows((prev) => prev.map((row) => {
        if (!savedKeys.has(row.variantId)) return row;
        return {
          ...row,
          original: {
            name: row.name,
            nameMr: row.nameMr,
            costPrice: row.costPrice,
            mrp: row.mrp,
            sellingPrice: row.sellingPrice,
            barcode: row.barcode,
            extraBarcodes: [...(row.extraBarcodes || [])],
            stockQty: row.stockQty,
          },
        };
      }));
      setToast({
        type: 'ok',
        text: items.length === 1
          ? t('Saved {{count}} update', { count: items.length })
          : t('Saved {{count}} updates', { count: items.length }),
      });
    } catch (err) {
      setToast({ type: 'err', text: apiError(err, t('Save failed')) });
    } finally {
      setSaving(false);
    }
  };

  const confirmDiscard = () => {
    if (!dirtyCount) return;
    Alert.alert(
      t('Discard edits?'),
      dirtyCount === 1
        ? t('{{count}} unsaved change will be lost.', { count: dirtyCount })
        : t('{{count}} unsaved changes will be lost.', { count: dirtyCount }),
      [
        { text: t('Keep editing'), style: 'cancel' },
        { text: t('Discard'), style: 'destructive', onPress: discardChanges },
      ],
    );
  };

  const onRefresh = async () => {
    const run = async () => {
      setRefreshing(true);
      try {
        if (compact) {
          if (selectedProductIdRef.current) {
            await loadSelectedProduct(selectedProductIdRef.current);
          }
        } else {
          await Promise.all([loadMeta(), load(search, 1, false)]);
        }
      } finally {
        setRefreshing(false);
      }
    };
    if (dirtyCount) {
      Alert.alert(t('Unsaved changes'), t('Refresh will discard edits.'), [
        { text: t('Cancel'), style: 'cancel' },
        { text: t('Refresh'), style: 'destructive', onPress: run },
      ]);
      return;
    }
    await run();
  };

  const focus = (key: string, field: FocusField) => {
    editingRef.current = true;
    setFocusKey(key);
    setFocusField(field);
  };
  const blur = () => {
    editingRef.current = false;
    setFocusKey(null);
    setFocusField(null);
  };

  const toggleFavorite = async (productId: string, currentlyFavorite: boolean) => {
    const next = !currentlyFavorite;
    // Update star only — do not re-sort or the row jumps away mid-edit.
    pinScrollRef.current = true;
    setRows((prev) => prev.map((row) => (
      row.productId === productId ? { ...row, isFavorite: next } : row
    )));
    try {
      await setProductFavorite(productId, next);
    } catch (err) {
      setRows((prev) => prev.map((row) => (
        row.productId === productId ? { ...row, isFavorite: currentlyFavorite } : row
      )));
      Alert.alert(t('Update failed'), apiError(err, t('Could not update favorite')));
    }
  };

  const selectedCategoryLabel = useMemo(() => {
    if (!categoryId) return t('All categories');
    const cat = categories.find((c) => c.id === categoryId);
    return cat ? localizedLabel(cat.name, cat, ui) : t('All categories');
  }, [categories, categoryId, t, ui]);

  const openCategoryPicker = useCallback(() => {
    Keyboard.dismiss();
    setCategoryOpen(true);
  }, []);

  const confirmFavoriteAllInCategory = useCallback(() => {
    if (!categoryId || favoritingAll) return;
    const name = selectedCategoryLabel || t('Category');
    Alert.alert(
      t('Favorite all in category?'),
      t('Mark every product in "{{name}}" as favorite?', { name }),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Favorite all'),
          onPress: async () => {
            setFavoritingAll(true);
            try {
              const result = await setProductsFavoriteBulk({
                categoryId,
                isFavorite: true,
              });
              pinScrollRef.current = true;
              setRows((prev) => prev.map((row) => (
                row.categoryId === categoryId ? { ...row, isFavorite: true } : row
              )));
              setToast({
                type: 'ok',
                text: result.updated === 1
                  ? t('{{count}} product marked favorite', { count: result.updated })
                  : t('{{count}} products marked favorite', { count: result.updated }),
              });
            } catch (err) {
              setToast({
                type: 'err',
                text: apiError(err, t('Could not update favorite')),
              });
            } finally {
              setFavoritingAll(false);
            }
          },
        },
      ],
    );
  }, [categoryId, favoritingAll, selectedCategoryLabel, t]);

  const renderCompactCard = (
    item: PriceRow,
    opts?: { hideProductName?: boolean; showFavorite?: boolean },
  ) => {
    const dirty = isDirty(item);
    const stock = parseFloat(item.stockQty) || 0;
    const cost = parseFloat(item.costPrice) || 0;
    const selling = parseFloat(item.sellingPrice) || 0;
    const belowCost = selling > 0 && cost > 0 && selling < cost;
    const hideProductName = opts?.hideProductName;
    const showFavorite = opts?.showFavorite !== false && !hideProductName;
    const profit = selling > 0 && cost > 0 ? Math.round((selling - cost) * 100) / 100 : null;
    const margin = profit != null && selling > 0 ? Math.round((profit / selling) * 1000) / 10 : null;

    return (
      <View
        key={item.key}
        style={[
          hideProductName ? styles.cardVariant : styles.card,
          dirty && styles.cardDirty,
          item.isFavorite && !hideProductName && styles.cardFavorite,
        ]}>
        {hideProductName ? (
          <View style={styles.cardVariantHead}>
            <Icon name="subdirectory-arrow-right" size={16} color={colors.textMuted} />
            <View style={styles.variantBadge}>
              <Text style={styles.variantBadgeText} numberOfLines={1}>
                {item.variantLabel === 'Default' ? t('Default') : item.variantLabel}
              </Text>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.cardTitleRow}>
              {showFavorite ? (
                <Pressable
                  onPress={() => toggleFavorite(item.productId, item.isFavorite)}
                  style={styles.favBtn}
                  hitSlop={6}
                  accessibilityLabel={item.isFavorite ? t('Remove from favorites') : t('Add to favorites')}>
                  <Icon
                    name={item.isFavorite ? 'star' : 'star-outline'}
                    size={20}
                    color={item.isFavorite ? colors.warning : colors.textSecondary}
                  />
                </Pressable>
              ) : null}
              <View style={styles.cardTitleBody}>
                <AppTextInput
                  label={requiredFieldLabel(t('Product name'))}
                  value={item.name}
                  onChangeText={(name) => patchName(item.key, name)}
                  mode="outlined"
                  dense
                  style={styles.cardInput}
                  autoCapitalize="words"
                />
              </View>
            </View>
            <AppTextInput
              label={t('Product name (Marathi)')}
              value={item.nameMr}
              onChangeText={(nameMr) => patchRow(item.key, { nameMr })}
              mode="outlined"
              dense
              style={styles.cardInput}
              placeholder={t('मराठी नाव')}
            />
            <View style={styles.cardMeta}>
              {item.variantLabel && item.variantLabel !== 'Default' ? (
                <View style={styles.variantBadge}>
                  <Text style={styles.variantBadgeText} numberOfLines={1}>
                    {item.variantLabel}
                  </Text>
                </View>
              ) : null}
              <Text style={styles.meta} numberOfLines={1}>
                {[item.categoryName, item.brandName].filter(Boolean).join(' · ') || '—'}
              </Text>
            </View>
          </>
        )}

        <Text style={styles.cardSection}>{t('Price')}</Text>
        <AppTextInput
          label={requiredFieldLabel(t('Selling price'))}
          value={item.sellingPrice}
          onChangeText={(sellingPrice) => patchRow(item.key, { sellingPrice })}
          keyboardType="decimal-pad"
          mode="outlined"
          dense
          style={styles.cardInput}
          left={<PaperInput.Affix text="₹" />}
        />
        <View style={styles.cardPriceRow}>
          <AppTextInput
            label={t('Cost')}
            value={item.costPrice}
            onChangeText={(costPrice) => patchRow(item.key, { costPrice })}
            keyboardType="decimal-pad"
            mode="outlined"
            dense
            style={[styles.cardInput, styles.cardHalf]}
            left={<PaperInput.Affix text="₹" />}
          />
          <AppTextInput
            label={t('MRP')}
            value={item.mrp}
            onChangeText={(mrp) => patchRow(item.key, { mrp })}
            keyboardType="decimal-pad"
            mode="outlined"
            dense
            style={[styles.cardInput, styles.cardHalf]}
            left={<PaperInput.Affix text="₹" />}
          />
        </View>
        {belowCost ? <Text style={styles.cardWarn}>{t('Below cost')}</Text> : null}
        {profit != null && margin != null ? (
          <Text style={[styles.cardProfit, profit < 0 && styles.cardWarn]}>
            {profit >= 0
              ? t('Profit ₹{{amount}} · {{margin}}% margin', {
                  amount: Math.abs(profit).toFixed(2),
                  margin: margin.toFixed(1),
                })
              : t('Loss ₹{{amount}}', { amount: Math.abs(profit).toFixed(2) })}
          </Text>
        ) : null}

        <AppTextInput
          label={t('Stock')}
          value={item.stockQty}
          onChangeText={(stockQty) => patchRow(item.key, { stockQty })}
          keyboardType="decimal-pad"
          mode="outlined"
          dense
          style={styles.cardInput}
        />
        {stock <= 0 ? <Text style={styles.cardWarn}>{t('Out of stock')}</Text> : null}

        <AppTextInput
          label={t('Barcode')}
          value={item.barcode}
          onChangeText={(barcode) => patchRow(item.key, {
            barcode: barcode.replace(/\D/g, '').slice(0, 18),
          })}
          keyboardType="number-pad"
          mode="outlined"
          dense
          style={styles.cardInput}
        />
        {(item.extraBarcodes || []).map((code, index) => (
          <View key={`${item.key}-extra-${index}`} style={styles.extraBarcodeRow}>
            <View style={styles.extraBarcodeField}>
              <AppTextInput
                label={t('Barcode {{n}}', { n: index + 2 })}
                value={code}
                onChangeText={(value) => {
                  const next = [...(item.extraBarcodes || [])];
                  next[index] = value.replace(/\D/g, '').slice(0, 18);
                  patchRow(item.key, { extraBarcodes: next });
                }}
                keyboardType="number-pad"
                mode="outlined"
                dense
                style={styles.cardInput}
              />
            </View>
            <Pressable
              onPress={() => {
                const next = (item.extraBarcodes || []).filter((_, i) => i !== index);
                patchRow(item.key, { extraBarcodes: next });
              }}
              hitSlop={6}
              style={styles.extraRemoveCard}>
              <Icon name="close" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
        ))}
        <Pressable
          onPress={() => patchRow(item.key, { extraBarcodes: [...(item.extraBarcodes || []), ''] })}
          hitSlop={6}
          style={styles.moreBarcodes}>
          <Text style={styles.moreBarcodesText}>{t('+ Add barcode')}</Text>
        </Pressable>
      </View>
    );
  };

  const renderVariantRow = (
    item: PriceRow,
    index: number,
    opts?: { indented?: boolean; hideProductName?: boolean },
  ) => {
    if (compact) {
      return renderCompactCard(item, { hideProductName: opts?.hideProductName });
    }

    const dirty = isDirty(item);
    const stock = parseFloat(item.stockQty) || 0;
    const cost = parseFloat(item.costPrice) || 0;
    const selling = parseFloat(item.sellingPrice) || 0;
    const belowCost = selling > 0 && cost > 0 && selling < cost;
    const focused = focusKey === item.key;
    const indented = opts?.indented;
    const hideProductName = opts?.hideProductName;

    return (
      <View
        key={item.key}
        style={[
          styles.row,
          index % 2 === 1 && styles.rowAlt,
          dirty && styles.rowDirty,
          focused && styles.rowFocused,
          indented && styles.rowVariant,
          item.isFavorite && !indented && styles.rowFavorite,
        ]}>
        <View style={styles.colProduct}>
          {hideProductName ? (
            <View style={styles.variantTitleRow}>
              <Icon name="subdirectory-arrow-right" size={16} color={colors.textMuted} />
              <View style={styles.variantBadge}>
                <Text style={styles.variantBadgeText} numberOfLines={1}>
                  {item.variantLabel === 'Default' ? t('Default') : item.variantLabel}
                </Text>
              </View>
            </View>
          ) : (
            <>
              <View style={styles.productTitleRow}>
                <Pressable
                  onPress={() => toggleFavorite(item.productId, item.isFavorite)}
                  style={styles.favBtn}
                  hitSlop={6}
                  accessibilityLabel={item.isFavorite ? t('Remove from favorites') : t('Add to favorites')}>
                  <Icon
                    name={item.isFavorite ? 'star' : 'star-outline'}
                    size={18}
                    color={item.isFavorite ? colors.warning : colors.textSecondary}
                  />
                </Pressable>
                <View style={styles.productTitleBody}>
                  <Field
                    value={item.name}
                    onChangeText={(name) => patchName(item.key, name)}
                    placeholder={t('Product name')}
                    focused={focused && focusField === 'name'}
                    onFocus={() => focus(item.key, 'name')}
                    onBlur={blur}
                  />
                </View>
              </View>
              <View style={styles.productMeta}>
                {item.variantLabel && item.variantLabel !== 'Default' ? (
                  <View style={styles.variantBadge}>
                    <Text style={styles.variantBadgeText} numberOfLines={1}>
                      {item.variantLabel === 'Default' ? t('Default') : item.variantLabel}
                    </Text>
                  </View>
                ) : null}
                <Text style={styles.meta} numberOfLines={1}>
                  {[item.categoryName, item.brandName].filter(Boolean).join(' · ') || '—'}
                </Text>
              </View>
            </>
          )}
        </View>

        <View style={styles.colNameMr}>
          {hideProductName ? null : (
            <Field
              value={item.nameMr}
              onChangeText={(nameMr) => patchRow(item.key, { nameMr })}
              placeholder={t('Marathi name')}
              focused={focused && focusField === 'nameMr'}
              onFocus={() => focus(item.key, 'nameMr')}
              onBlur={blur}
            />
          )}
        </View>

        <View style={styles.colMoney}>
          <Field
            value={item.costPrice}
            onChangeText={(costPrice) => patchRow(item.key, { costPrice })}
            placeholder="0"
            keyboardType="decimal-pad"
            align="right"
            prefix="₹"
            focused={focused && focusField === 'cost'}
            onFocus={() => focus(item.key, 'cost')}
            onBlur={blur}
          />
        </View>

        <View style={styles.colMoney}>
          <Field
            value={item.mrp}
            onChangeText={(mrp) => patchRow(item.key, { mrp })}
            placeholder="—"
            keyboardType="decimal-pad"
            align="right"
            prefix="₹"
            focused={focused && focusField === 'mrp'}
            onFocus={() => focus(item.key, 'mrp')}
            onBlur={blur}
          />
        </View>

        <View style={styles.colMoney}>
          <Field
            value={item.sellingPrice}
            onChangeText={(sellingPrice) => patchRow(item.key, { sellingPrice })}
            placeholder="0"
            keyboardType="decimal-pad"
            align="right"
            prefix="₹"
            focused={focused && focusField === 'selling'}
            onFocus={() => focus(item.key, 'selling')}
            onBlur={blur}
          />
          {belowCost ? <Text style={styles.hintWarn}>{t('Below cost')}</Text> : null}
        </View>

        <View style={styles.colBarcode}>
          <Field
            value={item.barcode}
            onChangeText={(barcode) => patchRow(item.key, {
              barcode: barcode.replace(/\D/g, '').slice(0, 18),
            })}
            placeholder={t('Barcode')}
            keyboardType="number-pad"
            mono
            focused={focused && focusField === 'barcode'}
            onFocus={() => focus(item.key, 'barcode')}
            onBlur={blur}
          />
          {(item.extraBarcodes || []).map((code, index) => (
            <View key={`${item.key}-extra-${index}`} style={styles.extraBarcodeRow}>
              <View style={styles.extraBarcodeField}>
                <Field
                  value={code}
                  onChangeText={(value) => {
                    const next = [...(item.extraBarcodes || [])];
                    next[index] = value.replace(/\D/g, '').slice(0, 18);
                    patchRow(item.key, { extraBarcodes: next });
                  }}
                  placeholder={t('Barcode {{n}}', { n: index + 2 })}
                  keyboardType="number-pad"
                  mono
                  focused={focused && focusField === 'barcode'}
                  onFocus={() => focus(item.key, 'barcode')}
                  onBlur={blur}
                />
              </View>
              <Pressable
                onPress={() => {
                  const next = (item.extraBarcodes || []).filter((_, i) => i !== index);
                  patchRow(item.key, { extraBarcodes: next });
                }}
                hitSlop={6}
                style={styles.extraRemove}>
                <Icon name="close" size={14} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
          <Pressable
            onPress={() => patchRow(item.key, { extraBarcodes: [...(item.extraBarcodes || []), ''] })}
            hitSlop={6}
            style={styles.moreBarcodes}>
            <Text style={styles.moreBarcodesText}>{t('+ Add barcode')}</Text>
          </Pressable>
        </View>

        <View style={styles.colStock}>
          <Field
            value={item.stockQty}
            onChangeText={(stockQty) => patchRow(item.key, { stockQty })}
            placeholder="0"
            keyboardType="decimal-pad"
            align="right"
            focused={focused && focusField === 'stock'}
            onFocus={() => focus(item.key, 'stock')}
            onBlur={blur}
          />
          {stock <= 0 ? <Text style={styles.hintWarn}>{t('Out')}</Text> : null}
        </View>
      </View>
    );
  };

  const shownLabel = viewMode === 'products'
    ? (
      totalCount > productGroups.length
        ? t('Showing {{loaded}} of {{total}}', { loaded: productGroups.length, total: totalCount })
        : (productGroups.length === 1
          ? t('{{count}} product', { count: productGroups.length })
          : t('{{count}} products', { count: productGroups.length }))
    )
    : (filtered.length === 1
      ? t('{{count}} variant', { count: filtered.length })
      : t('{{count}} variants', { count: filtered.length }));

  const selectedProductLabel = rows[0]
    ? (ui === 'mr' && rows[0].nameMr ? rows[0].nameMr : rows[0].name)
    : '';

  return (
    <KeyboardAvoidingView
      style={common.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}>
      {compact ? (
        <View style={styles.mobileLookup}>
          {selectedProductId ? (
            <View style={styles.mobileSelectedBar}>
              <View style={styles.mobileSelectedText}>
                <Text style={styles.mobileSelectedLabel}>{t('Selected product')}</Text>
                <Text style={styles.mobileSelectedName} numberOfLines={1}>
                  {selectedProductLabel || t('Product')}
                </Text>
              </View>
              <Pressable
                onPress={openPriceScanner}
                style={styles.mobileScanBtn}
                accessibilityLabel={t('Scan barcode')}>
                <Icon name="barcode-scan" size={20} color={colors.primary} />
              </Pressable>
              <Pressable onPress={requestClearSelectedProduct} style={styles.mobileChangeBtn}>
                <Text style={styles.mobileChangeText} numberOfLines={1}>{t('Find another')}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={styles.mobileHint}>
                {t('Scan or search a product to edit price and stock')}
              </Text>
              <Pressable
                onPress={openCategoryPicker}
                style={[styles.categoryBtn, categoryId ? styles.categoryBtnOn : null, styles.mobileCategorySelect]}
                accessibilityLabel={t('Category')}>
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
              {categoryId ? (
                <Pressable
                  onPress={confirmFavoriteAllInCategory}
                  disabled={favoritingAll}
                  style={[styles.favoriteAllBtn, styles.mobileFavoriteAll, favoritingAll && styles.favoriteAllBtnBusy]}
                  accessibilityLabel={t('Favorite all in category')}>
                  {favoritingAll ? (
                    <ActivityIndicator size="small" color={colors.warning} />
                  ) : (
                    <Icon name="star" size={18} color={colors.warning} />
                  )}
                  <Text style={styles.favoriteAllText}>{t('Favorite all')}</Text>
                </Pressable>
              ) : null}
              <View style={styles.mobileScanRow}>
                <Pressable
                  onPress={openPriceScanner}
                  style={styles.mobileScanCta}
                  accessibilityLabel={t('Scan barcode')}>
                  <Icon name="barcode-scan" size={22} color={colors.textOnPrimary} />
                  <Text style={styles.mobileScanCtaText}>{t('Scan barcode')}</Text>
                </Pressable>
              </View>
              <ProductSearchField
                label="Search by name, SKU or barcode"
                onSelect={onPickSearchProduct}
                categoryId={categoryId}
                groupByProduct
                minChars={1}
              />
            </>
          )}
        </View>
      ) : (
        <>
          <View style={styles.toolbar}>
            <View style={styles.searchBox}>
              <Icon name="magnify" size={18} color={colors.textMuted} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={t('Search product, barcode, size…')}
                placeholderTextColor={colors.textMuted}
                style={styles.searchInput}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
              />
              {search ? (
                <Pressable onPress={() => setSearch('')} hitSlop={8}>
                  <Icon name="close-circle" size={16} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>

            <Pressable
              onPress={openCategoryPicker}
              style={[styles.categoryBtn, categoryId ? styles.categoryBtnOn : null, styles.toolbarSelect]}
              accessibilityLabel={t('Category')}>
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

            {categoryId ? (
              <Pressable
                onPress={confirmFavoriteAllInCategory}
                disabled={favoritingAll || !rows.length}
                style={[styles.favoriteAllBtn, favoritingAll && styles.favoriteAllBtnBusy]}
                accessibilityLabel={t('Favorite all in category')}>
                {favoritingAll ? (
                  <ActivityIndicator size="small" color={colors.warning} />
                ) : (
                  <Icon name="star" size={18} color={colors.warning} />
                )}
                <Text style={styles.favoriteAllText} numberOfLines={1}>
                  {t('Favorite all')}
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={onRefresh}
              disabled={refreshing || loading}
              style={styles.reloadBtn}
              accessibilityLabel={t('Refresh')}>
              {refreshing ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Icon name="refresh" size={20} color={colors.primary} />
              )}
            </Pressable>
          </View>

          <View style={styles.stats}>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{stats.products}</Text>
              <Text style={styles.statLbl}>{t('Products')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statNum}>{stats.variants}</Text>
              <Text style={styles.statLbl}>{t('Variants')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={[styles.statNum, stats.dirty ? styles.statAccent : null]}>{stats.dirty}</Text>
              <Text style={styles.statLbl}>{t('Edited')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={[styles.statNum, stats.belowCost ? styles.statWarn : null]}>{stats.belowCost}</Text>
              <Text style={styles.statLbl}>{t('Below cost')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={[styles.statNum, stats.noBarcode ? styles.statMuted : null]}>{stats.noBarcode}</Text>
              <Text style={styles.statLbl}>{t('No barcode')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={[styles.statNum, stats.out ? styles.statWarn : null]}>{stats.out}</Text>
              <Text style={styles.statLbl}>{t('Out of stock')}</Text>
            </View>
          </View>

          <View style={styles.filterBlock}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
              <FilterPill
                label={t('Products')}
                active={viewMode === 'products'}
                onPress={() => setViewMode('products')}
              />
              <FilterPill
                label={t('All variants')}
                active={viewMode === 'variants'}
                onPress={() => setViewMode('variants')}
              />
              <View style={styles.pillSep} />
              <FilterPill label={t('All stock')} active={stockFilter === 'all'} onPress={() => setStockFilter('all')} />
              <FilterPill label={t('In stock')} active={stockFilter === 'in_stock'} onPress={() => setStockFilter('in_stock')} />
              <FilterPill label={t('Low ≤5')} active={stockFilter === 'low'} tone="warn" onPress={() => setStockFilter('low')} />
              <FilterPill label={t('Out of stock')} active={stockFilter === 'out'} tone="danger" onPress={() => setStockFilter('out')} />
              <View style={styles.pillSep} />
              <FilterPill label={t('All issues')} active={issueFilter === 'all'} onPress={() => setIssueFilter('all')} />
              <FilterPill label={t('No MRP')} active={issueFilter === 'missing_mrp'} onPress={() => setIssueFilter('missing_mrp')} />
              <FilterPill label={t('No selling price')} active={issueFilter === 'no_selling_price'} tone="warn" onPress={() => setIssueFilter('no_selling_price')} />
              <FilterPill label={t('Below cost')} active={issueFilter === 'below_cost'} tone="warn" onPress={() => setIssueFilter('below_cost')} />
              <FilterPill label={t('No barcode')} active={issueFilter === 'no_barcode'} onPress={() => setIssueFilter('no_barcode')} />
            </ScrollView>
          </View>
        </>
      )}

      {toast ? (
        <Pressable
          onPress={() => setToast(null)}
          style={[styles.toast, toast.type === 'ok' ? styles.toastOk : styles.toastErr]}>
          <Icon
            name={toast.type === 'ok' ? 'check-circle' : 'alert-circle'}
            size={16}
            color={toast.type === 'ok' ? colors.success : colors.error}
          />
          <Text style={styles.toastText}>{toast.text}</Text>
        </Pressable>
      ) : null}

      <View style={[styles.tableCard, compact && styles.tableCardCompact]}>
        {compact ? null : (
          <View style={styles.head}>
            <RequiredLabel
              label={t('PRODUCTS')}
              required
              style={[styles.headCell, styles.colProduct]}
            />
            <RequiredLabel
              label={t('Marathi name')}
              style={[styles.headCell, styles.colNameMr]}
            />
            <RequiredLabel
              label={t('COST')}
              style={[styles.headCell, styles.colMoney, styles.headRight]}
            />
            <RequiredLabel
              label={t('MRP')}
              style={[styles.headCell, styles.colMoney, styles.headRight]}
            />
            <RequiredLabel
              label={t('SELLING')}
              required
              style={[styles.headCell, styles.colMoney, styles.headRight]}
            />
            <RequiredLabel
              label={t('BARCODE')}
              style={[styles.headCell, styles.colBarcode]}
            />
            <RequiredLabel
              label={t('STOCK')}
              style={[styles.headCell, styles.colStock, styles.headRight]}
            />
          </View>
        )}

        <FlatList
          ref={listRef}
          style={styles.tableBody}
          data={viewMode === 'variants' ? filtered : productGroups}
          keyExtractor={(item) => (
            viewMode === 'variants'
              ? (item as PriceRow).key
              : (item as ProductGroup).productId
          )}
          initialNumToRender={compact ? 8 : 12}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews={Platform.OS !== 'web'}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onEndReached={() => { if (!editingRef.current) void loadMore(); }}
          onEndReachedThreshold={0.35}
          onScroll={({ nativeEvent }) => {
            scrollYRef.current = nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={32}
          onContentSizeChange={() => {
            if (!pinScrollRef.current) return;
            const y = scrollYRef.current;
            pinScrollRef.current = false;
            requestAnimationFrame(() => {
              listRef.current?.scrollToOffset({ offset: y, animated: false });
            });
          }}
          refreshControl={(
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
          )}
          contentContainerStyle={[
            !productGroups.length && !loading ? styles.emptyGrow : undefined,
            compact && styles.cardList,
            { paddingBottom: spacing.xxl },
          ]}
          ListEmptyComponent={(
            (loading || lookupLoading) && !rows.length ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.loadingText}>
                  {compact ? t('Loading product…') : t('Loading catalog…')}
                </Text>
              </View>
            ) : (!loading && !lookupLoading && !(compact && !selectedProductId) ? (
              <EmptyState
                icon={compact ? 'barcode-scan' : 'currency-inr'}
                title={compact
                  ? t('Find a product to edit')
                  : t('No matching products')}
                subtitle={compact
                  ? t('Scan a barcode or search by name')
                  : t('Clear filters or try another search')}
              />
            ) : null)
          )}
          ListFooterComponent={loadingMore ? (
            <View style={styles.footerLoading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null}
          renderItem={({ item, index }) => {
            if (viewMode === 'variants') {
              return renderVariantRow(item as PriceRow, index);
            }
            const group = item as ProductGroup;
            const groupIndex = index;
              const multi = group.variants.length > 1;
              const expanded = expandedIds.has(group.productId);
              const anyDirty = group.variants.some(isDirty);
              const first = group.variants[0];

              if (!multi) {
                return renderVariantRow(first, groupIndex);
              }

              const totalStock = group.variants.reduce(
                (sum, row) => sum + (parseFloat(row.stockQty) || 0),
                0,
              );
              const sellingSummary = moneyRange(group.variants.map((row) => row.sellingPrice));
              const costSummary = moneyRange(group.variants.map((row) => row.costPrice));
              const mrpSummary = moneyRange(group.variants.map((row) => row.mrp));
              const focused = focusKey === `product:${group.productId}`;

              if (compact) {
                return (
                  <View
                    key={group.productId}
                    style={[
                      styles.card,
                      styles.cardGroup,
                      anyDirty && styles.cardDirty,
                      group.isFavorite && styles.cardFavorite,
                    ]}>
                    <View style={styles.cardTitleRow}>
                      <Pressable
                        onPress={() => toggleFavorite(group.productId, group.isFavorite)}
                        style={styles.favBtn}
                        hitSlop={6}
                        accessibilityLabel={group.isFavorite ? t('Remove from favorites') : t('Add to favorites')}>
                        <Icon
                          name={group.isFavorite ? 'star' : 'star-outline'}
                          size={20}
                          color={group.isFavorite ? colors.warning : colors.textSecondary}
                        />
                      </Pressable>
                      <View style={styles.cardTitleBody}>
                        <AppTextInput
                          label={requiredFieldLabel(t('Product name'))}
                          value={group.name}
                          onChangeText={(name) => patchName(first.key, name)}
                          mode="outlined"
                          dense
                          style={styles.cardInput}
                          autoCapitalize="words"
                        />
                      </View>
                    </View>
                    <AppTextInput
                      label={t('Product name (Marathi)')}
                      value={group.nameMr}
                      onChangeText={(nameMr) => patchRow(first.key, { nameMr })}
                      mode="outlined"
                      dense
                      style={styles.cardInput}
                      placeholder={t('मराठी नाव')}
                    />
                    <Pressable
                      onPress={() => toggleExpanded(group.productId)}
                      style={styles.cardExpand}>
                      <View style={styles.variantBadge}>
                        <Text style={styles.variantBadgeText}>
                          {t('{{count}} variants', { count: group.variants.length })}
                        </Text>
                      </View>
                      <Text style={styles.meta} numberOfLines={1}>
                        {[group.categoryName, group.brandName].filter(Boolean).join(' · ') || '—'}
                      </Text>
                      <Text style={styles.expandHint}>
                        {expanded ? t('Hide variants') : t('Show variants')}
                      </Text>
                      <Icon
                        name={expanded ? 'chevron-up' : 'chevron-down'}
                        size={18}
                        color={colors.primary}
                      />
                    </Pressable>
                    {!expanded ? (
                      <Text style={styles.cardSummary}>
                        {`${t('SELLING')} ${sellingSummary} · ${t('STOCK')} ${totalStock}`}
                        {costSummary !== '—' ? ` · ${t('COST')} ${costSummary}` : ''}
                        {mrpSummary !== '—' ? ` · ${t('MRP')} ${mrpSummary}` : ''}
                      </Text>
                    ) : null}
                    {expanded
                      ? group.variants.map((item) => (
                        renderCompactCard(item, { hideProductName: true })
                      ))
                      : null}
                  </View>
                );
              }

              return (
                <View key={group.productId}>
                  <View
                    style={[
                      styles.row,
                      styles.rowProduct,
                      groupIndex % 2 === 1 && styles.rowAlt,
                      anyDirty && styles.rowDirty,
                      expanded && styles.rowExpanded,
                      group.isFavorite && styles.rowFavorite,
                    ]}>
                    <View style={styles.colProduct}>
                      <View style={styles.productTitleRow}>
                        <Pressable
                          onPress={() => toggleFavorite(group.productId, group.isFavorite)}
                          style={styles.favBtn}
                          hitSlop={6}
                          accessibilityLabel={group.isFavorite ? t('Remove from favorites') : t('Add to favorites')}>
                          <Icon
                            name={group.isFavorite ? 'star' : 'star-outline'}
                            size={18}
                            color={group.isFavorite ? colors.warning : colors.textSecondary}
                          />
                        </Pressable>
                        <Pressable
                          onPress={() => toggleExpanded(group.productId)}
                          style={styles.expandHit}
                          hitSlop={8}
                          accessibilityLabel={expanded ? t('Hide variants') : t('Show variants')}>
                          <Icon
                            name={expanded ? 'chevron-down' : 'chevron-right'}
                            size={20}
                            color={colors.primary}
                          />
                        </Pressable>
                        <View style={styles.productTitleBody}>
                          <Field
                            value={group.name}
                            onChangeText={(name) => patchName(first.key, name)}
                            placeholder={t('Product name')}
                            focused={focused && focusField === 'name'}
                            onFocus={() => focus(`product:${group.productId}`, 'name')}
                            onBlur={blur}
                          />
                          <Pressable
                            onPress={() => toggleExpanded(group.productId)}
                            style={styles.productMeta}>
                            <View style={styles.variantBadge}>
                              <Text style={styles.variantBadgeText}>
                                {t('{{count}} variants', { count: group.variants.length })}
                              </Text>
                            </View>
                            <Text style={styles.meta} numberOfLines={1}>
                              {[group.categoryName, group.brandName].filter(Boolean).join(' · ') || '—'}
                            </Text>
                            <Text style={styles.expandHint}>
                              {expanded ? t('Hide variants') : t('Show variants')}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>

                    <View style={styles.colNameMr}>
                      <Field
                        value={group.nameMr}
                        onChangeText={(nameMr) => patchRow(first.key, { nameMr })}
                        placeholder={t('Marathi name')}
                        focused={focused && focusField === 'nameMr'}
                        onFocus={() => focus(`product:${group.productId}`, 'nameMr')}
                        onBlur={blur}
                      />
                    </View>

                    <Pressable
                      onPress={() => toggleExpanded(group.productId)}
                      style={styles.colMoney}>
                      <Text style={[styles.summaryValue, styles.alignRight]} numberOfLines={1}>
                        {costSummary}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => toggleExpanded(group.productId)}
                      style={styles.colMoney}>
                      <Text style={[styles.summaryValue, styles.alignRight]} numberOfLines={1}>
                        {mrpSummary}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => toggleExpanded(group.productId)}
                      style={styles.colMoney}>
                      <Text style={[styles.summaryValue, styles.summaryAccent, styles.alignRight]} numberOfLines={1}>
                        {sellingSummary}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => toggleExpanded(group.productId)}
                      style={styles.colBarcode}>
                      <Text style={styles.summaryMuted} numberOfLines={1}>
                        {t('Select to edit each')}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => toggleExpanded(group.productId)}
                      style={styles.colStock}>
                      <Text style={[styles.summaryValue, styles.alignRight]} numberOfLines={1}>
                        {totalStock}
                      </Text>
                      {totalStock <= 0 ? <Text style={styles.hintWarn}>{t('Out')}</Text> : null}
                    </Pressable>
                  </View>

                  {expanded
                    ? group.variants.map((variantRow, variantIndex) => (
                      renderVariantRow(variantRow, variantIndex, { indented: true, hideProductName: true })
                    ))
                    : null}
                </View>
              );
          }}
        />
      </View>

      <View
        style={[
          styles.footer,
          compact && styles.footerCompact,
          dirtyCount ? styles.footerActive : null,
          {
            paddingBottom: Math.max(insets.bottom, spacing.md) + keyboardOverlap,
          },
        ]}>
        <View style={[styles.footerLeft, compact && styles.footerLeftCompact]}>
          <Text style={styles.footerCount} numberOfLines={2}>
            {shownLabel}
            {dirtyCount ? t(' · {{count}} edited', { count: dirtyCount }) : ''}
          </Text>
          {dirtyCount ? (
            <Pressable onPress={confirmDiscard} disabled={saving} hitSlop={6}>
              <Text style={styles.discardLink}>{t('Discard')}</Text>
            </Pressable>
          ) : (
            <Text style={styles.footerHint} numberOfLines={2}>
              {compact
                ? (selectedProductId
                  ? t('Edit details, then save')
                  : t('Scan or search a product to edit price and stock'))
                : (viewMode === 'products'
                  ? t('Select a product to edit variants')
                  : t('Edit cells, then save'))}
            </Text>
          )}
        </View>
        <Pressable
          onPress={saveChanges}
          disabled={!dirtyCount || saving}
          style={[
            styles.saveBtn,
            compact && styles.saveBtnCompact,
            (!dirtyCount || saving) && styles.saveBtnDisabled,
          ]}>
          {saving ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <>
              <Icon name="content-save-outline" size={18} color={colors.textOnPrimary} />
              <Text style={styles.saveText} numberOfLines={1}>
                {dirtyCount ? t('Save {{count}}', { count: dirtyCount }) : t('Save')}
              </Text>
            </>
          )}
        </Pressable>
      </View>

      <CategoryPickerSheet
        visible={categoryOpen}
        options={categoryOptions}
        value={categoryId}
        onSelect={setCategoryId}
        onClose={() => setCategoryOpen(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  mobileLookup: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  mobileHint: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  mobileCategorySelect: {
    marginBottom: spacing.sm,
    width: '100%',
  },
  mobileFavoriteAll: {
    marginBottom: spacing.sm,
    alignSelf: 'stretch',
  },
  categoryBtn: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  categoryBtnOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryBtnText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  categoryBtnTextOn: {
    color: colors.textOnPrimary,
  },
  mobileScanRow: {
    marginBottom: spacing.sm,
  },
  mobileScanCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
  },
  mobileScanCtaText: {
    color: colors.textOnPrimary,
    fontWeight: '700',
    fontSize: 15,
  },
  reloadBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  mobileSelectedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  mobileSelectedText: {
    flex: 1,
    minWidth: 0,
  },
  mobileSelectedLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  mobileSelectedName: {
    marginTop: 2,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  mobileScanBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  mobileChangeBtn: {
    flexShrink: 1,
    maxWidth: '46%',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  mobileChangeText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    zIndex: 20,
  },
  toolbarSelect: {
    flex: 1,
    minWidth: 140,
    marginTop: 0,
    zIndex: 21,
  },
  favoriteAllBtn: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.surface,
  },
  favoriteAllBtnBusy: { opacity: 0.6 },
  favoriteAllText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.warning,
  },
  toolbarCompact: {
    flexWrap: 'wrap',
  },
  tableCardCompact: {
    borderTopWidth: 0,
    backgroundColor: colors.background,
  },
  cardList: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  cardGroup: {
    marginBottom: spacing.md,
  },
  cardVariant: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  cardDirty: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  cardFavorite: {
    borderColor: colors.warning,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  cardTitleBody: {
    flex: 1,
    minWidth: 0,
  },
  cardVariantHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  cardInput: {
    backgroundColor: colors.surface,
    marginBottom: 2,
  },
  cardPriceRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cardHalf: {
    flex: 1,
    minWidth: 0,
  },
  cardSection: {
    marginTop: spacing.sm,
    marginBottom: 2,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: spacing.xs,
  },
  cardExpand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.xs,
  },
  cardSummary: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  cardProfit: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.secondary,
  },
  cardWarn: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.warning,
  },
  extraRemoveCard: {
    width: 36,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  searchBox: {
    flex: 1,
    minWidth: 180,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 42,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    paddingVertical: 0,
    ...Platform.select({ web: { outlineStyle: 'none' } as object, default: {} }),
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    ...shadow.sm,
  },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  statDivider: { width: 1, height: 28, backgroundColor: colors.borderLight },
  statNum: { fontSize: 18, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
  statLbl: { fontSize: 10, fontWeight: '600', color: colors.textMuted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },
  statAccent: { color: colors.primary },
  statWarn: { color: colors.warning },
  statMuted: { color: colors.textSecondary },

  filterBlock: { paddingBottom: spacing.sm },
  pillRow: {
    paddingHorizontal: spacing.lg,
    gap: 6,
    alignItems: 'center',
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillOn: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  pillWarn: {
    backgroundColor: colors.warningLight,
    borderColor: colors.warning,
  },
  pillDanger: {
    backgroundColor: colors.errorLight,
    borderColor: colors.error,
  },
  pillText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  pillTextOn: { color: colors.primary },
  pillTextWarn: { color: colors.warning },
  pillTextDanger: { color: colors.error },
  pillSep: {
    width: 1,
    height: 18,
    backgroundColor: colors.border,
    marginHorizontal: 4,
  },

  toast: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toastOk: { backgroundColor: colors.successLight },
  toastErr: { backgroundColor: colors.errorLight },
  toastText: { flex: 1, fontSize: 13, fontWeight: '500', color: colors.text },

  tableCard: {
    flex: 1,
    width: '100%',
    marginBottom: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  tableBody: { flex: 1, width: '100%' },
  emptyGrow: { flexGrow: 1 },
  footerLoading: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  head: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    ...Platform.select({
      web: {
        display: 'grid' as unknown as 'flex',
        gridTemplateColumns: 'minmax(0, 2.2fr) minmax(120px, 1.4fr) repeat(3, minmax(96px, 1fr)) minmax(140px, 1.5fr) minmax(88px, 0.9fr)',
        gap: 12,
      } as object,
      default: {},
    }),
  },
  headCell: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.7,
  },
  headRight: { textAlign: 'right' },
  reqMark: {
    color: colors.error,
    fontWeight: '800',
  },
  row: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    ...Platform.select({
      web: {
        display: 'grid' as unknown as 'flex',
        gridTemplateColumns: 'minmax(0, 2.2fr) minmax(120px, 1.4fr) repeat(3, minmax(96px, 1fr)) minmax(140px, 1.5fr) minmax(88px, 0.9fr)',
        gap: 12,
      } as object,
      default: {},
    }),
  },
  rowAlt: { backgroundColor: '#FAFBFD' },
  rowFavorite: {
    backgroundColor: colors.warningLight,
  },
  favBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  rowDirty: {
    backgroundColor: colors.primaryLight,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    paddingLeft: spacing.lg - 3,
  },
  rowFocused: {
    backgroundColor: '#F0F6FF',
  },
  rowProduct: {
    backgroundColor: '#F7F9FC',
  },
  rowExpanded: {
    borderBottomColor: colors.primaryLight,
  },
  rowVariant: {
    backgroundColor: colors.surface,
    paddingLeft: spacing.xl,
  },
  productTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    minWidth: 0,
  },
  productTitleBody: {
    flex: 1,
    minWidth: 0,
  },
  expandHit: {
    width: 28,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  variantTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 36,
  },
  expandHint: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
  },
  summaryValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    paddingVertical: 8,
  },
  summaryAccent: { color: colors.secondary },
  summaryMuted: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
    paddingVertical: 8,
  },
  alignRight: { textAlign: 'right' },
  colNameMr: {
    flexGrow: 1.4,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    overflow: 'hidden',
    ...Platform.select({ web: { width: 'auto', minWidth: 0, maxWidth: '100%' } as object, default: {} }),
  },
  colProduct: {
    flexGrow: 2.6,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    overflow: 'hidden',
    ...Platform.select({ web: { width: 'auto', minWidth: 0, maxWidth: '100%' } as object, default: {} }),
  },
  colMoney: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    overflow: 'hidden',
    ...Platform.select({ web: { width: 'auto', minWidth: 0, maxWidth: '100%' } as object, default: {} }),
  },
  colBarcode: {
    flexGrow: 1.5,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    overflow: 'hidden',
    ...Platform.select({ web: { width: 'auto', minWidth: 0, maxWidth: '100%' } as object, default: {} }),
  },
  moreBarcodes: { marginTop: 4 },
  moreBarcodesText: { fontSize: 11, fontWeight: '600', color: colors.primary },
  extraBarcodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  extraBarcodeField: { flex: 1, minWidth: 0 },
  extraRemove: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colStock: {
    flexGrow: 0.9,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    overflow: 'hidden',
    ...Platform.select({ web: { width: 'auto', minWidth: 0, maxWidth: '100%' } as object, default: {} }),
  },
  productMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    minHeight: 22,
    minWidth: 0,
  },
  meta: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    color: colors.textMuted,
  },
  variantBadge: {
    flexShrink: 0,
    backgroundColor: colors.surfaceVariant,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  variantBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  hintWarn: {
    marginTop: 3,
    fontSize: 10,
    fontWeight: '700',
    color: colors.warning,
    textAlign: 'right',
  },
  field: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxSizing: 'border-box' } as object,
      default: {},
    }),
  },
  fieldFocused: {
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    ...shadow.sm,
  },
  fieldPrefix: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginRight: 2,
  },
  fieldInput: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    width: '100%',
    maxWidth: '100%',
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    paddingVertical: Platform.OS === 'web' ? 8 : 6,
    ...Platform.select({
      web: {
        outlineStyle: 'none',
        boxSizing: 'border-box',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      } as object,
      default: {},
    }),
  },
  fieldRight: { textAlign: 'right' },
  fieldMono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  loadingBox: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 320,
  },
  loadingText: { fontSize: 13, color: colors.textMuted },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  footerCompact: {
    flexWrap: 'wrap',
    alignItems: 'stretch',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  footerActive: {
    ...shadow.md,
  },
  footerLeft: { flex: 1, gap: 2, minHeight: 36, minWidth: 0, justifyContent: 'center' },
  footerLeftCompact: { flexBasis: '100%', flexGrow: 1 },
  footerCount: { fontSize: 13, fontWeight: '700', color: colors.text },
  footerHint: { fontSize: 12, color: colors.textMuted },
  discardLink: { fontSize: 13, fontWeight: '600', color: colors.error, marginTop: 2 },
  saveBtn: {
    minWidth: 120,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    gap: 8,
    paddingHorizontal: spacing.lg,
  },
  saveBtnCompact: {
    flexGrow: 1,
    flexBasis: '100%',
    width: '100%',
    minWidth: 0,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveText: { flexShrink: 1, fontSize: 14, fontWeight: '700', color: colors.textOnPrimary },
});
