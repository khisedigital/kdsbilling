import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FAB } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import CategoryPickerSheet from '../../components/ui/CategoryPickerSheet';
import EmptyState from '../../components/ui/EmptyState';
import ListRow from '../../components/ui/ListRow';
import { useT } from '../../i18n';
import { useLanguageStore } from '../../i18n/languageStore';
import {
  getCatalogRevision,
  isCatalogCacheEnabled,
  readCachedCategories,
  readCachedProducts,
  subscribeCatalogChanges,
} from '../../services/catalogCache';
import {
  deleteAllProducts,
  deleteProduct,
  fetchCategories,
  fetchProducts,
  isProductFavorite,
  mainBarcodeOf,
  matchBarcodeProduct,
  searchProducts,
  setProductFavorite,
  setProductsFavoriteBulk,
  syncCatalogFromMaster,
} from '../../services/catalogService';
import type { Category, Product } from '../../types/catalog';
import { apiError } from '../../utils/apiError';
import { localizedLabel, resolveNameMr } from '../../utils/productName';
import { variantLabel } from '../../utils/variantLabel';
import { colors } from '../../theme/colors';
import { common, radius, spacing } from '../../theme/layout';
import { formatQuantity } from '../../utils/quantity';

type Props = NativeStackScreenProps<MainStackParamList, 'ProductList'>;

function numericBarcode(value: string) {
  return value.replace(/\D/g, '').slice(0, 18);
}

/** Looks like a scanner code (not a short name search). */
function looksLikeBarcode(value: string) {
  const raw = value.trim();
  if (raw.length < 6) return false;
  const digits = numericBarcode(raw);
  return digits.length >= 6 && digits.length / raw.length >= 0.8;
}

const IS_WEB = Platform.OS === 'web';
/** Keep first paint fast; scroll loads more. */
const PAGE_SIZE = IS_WEB ? 100 : 40;
const PRODUCT_LIST_TTL_MS = 2 * 60_000;

function formatPrice(product: Product) {
  const variants = product.variants || [];
  if (!variants.length) return '—';
  if (variants.length === 1) {
    const p = parseFloat(String(variants[0].selling_price ?? (variants[0] as any).sellingPrice));
    return Number.isFinite(p) ? `₹${p.toFixed(2)}` : '—';
  }
  const prices = variants.map((v) => parseFloat(String(v.selling_price ?? (v as any).sellingPrice)) || 0);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) return `₹${min.toFixed(2)}`;
  return `₹${min.toFixed(0)}–${max.toFixed(0)}`;
}

function stockQtyOf(product: Product) {
  const variants = product.variants || [];
  if (variants.length) {
    return variants.reduce((sum, v) => {
      const raw = (v as { stockQty?: number; stock_qty?: number }).stockQty
        ?? (v as { stock_qty?: number }).stock_qty;
      return sum + (Number(raw) || 0);
    }, 0);
  }
  return Number(
    product.stockQty ?? (product as { stock_qty?: number }).stock_qty,
  ) || 0;
}

function formatStock(product: Product) {
  const qty = stockQtyOf(product);
  const uom = product.uom;
  return formatQuantity(qty, uom ? { code: uom.code, type: uom.type } : { code: 'pcs', type: 'count' });
}

function variantSummary(
  product: Product,
  tr: (text: string, vars?: Record<string, string | number>) => string,
) {
  const variants = product.variants || [];
  if (!variants.length) return '—';
  if (variants.length === 1) {
    return variantLabel(variants[0].size, variants[0].color) || tr('Single');
  }
  return tr('{{count}} variants', { count: variants.length });
}

function primaryBarcode(product: Product) {
  const first = product.variants?.[0];
  if (!first) return '—';
  return mainBarcodeOf(first) || '—';
}

type MobileProductRowProps = {
  product: Product;
  ui: 'en' | 'mr';
  t: (text: string, vars?: Record<string, string | number>) => string;
  onOpen: (productId: string) => void;
  onEdit: (productId: string) => void;
  onFavorite: (product: Product) => void;
  onDelete: (product: Product) => void;
};

const MobileProductRow = memo(function MobileProductRow({
  product,
  ui,
  t,
  onOpen,
  onEdit,
  onFavorite,
  onDelete,
}: MobileProductRowProps) {
  const stock = stockQtyOf(product);
  const low = stock <= 0;
  const sizeCount = product.variants?.length || 0;
  const favorite = isProductFavorite(product);
  return (
    <ListRow
      title={localizedLabel(product.name, product, ui)}
      titleLines={3}
      subtitle={
        sizeCount > 1
          ? t('{{category}} · {{count}} sizes', {
              category: product.category?.name || t('No category'),
              count: sizeCount,
            })
          : (product.category?.name || t('No category'))
      }
      icon={null}
      right={(
        <View style={styles.mobileRight}>
          <Text style={styles.mobilePrice}>{formatPrice(product)}</Text>
          <Text
            style={[styles.mobileStock, low && styles.mobileStockLow]}
            numberOfLines={1}>
            {low ? t('No stock') : formatStock(product)}
          </Text>
        </View>
      )}
      showChevron={false}
      onPress={() => onOpen(product.id)}
      onLongPress={() => onEdit(product.id)}
      trailing={(
        <View style={styles.trailingRow}>
          <Pressable
            onPress={() => onFavorite(product)}
            style={styles.iconBtn}
            hitSlop={8}
            accessibilityLabel={favorite ? t('Remove from favorites') : t('Add to favorites')}>
            <Icon
              name={favorite ? 'star' : 'star-outline'}
              size={20}
              color={favorite ? colors.warning : colors.textSecondary}
            />
          </Pressable>
          <Pressable
            onPress={() => onEdit(product.id)}
            style={styles.iconBtn}
            hitSlop={8}
            accessibilityLabel={t('Edit {{name}}', { name: product.name })}>
            <Icon name="pencil-outline" size={18} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => onDelete(product)}
            style={styles.iconBtn}
            hitSlop={8}
            accessibilityLabel={t('Delete {{name}}', { name: product.name })}>
            <Icon name="trash-can-outline" size={18} color={colors.error} />
          </Pressable>
        </View>
      )}
    />
  );
});

const productKeyExtractor = (item: Product) => item.id;

export default function ProductListScreen({ navigation }: Props) {
  const t = useT();
  const ui = useLanguageStore((s) => s.ui);
  const tRef = useRef(t);
  tRef.current = t;
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [favoritingAll, setFavoritingAll] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const searchRef = useRef(search);
  const categoryRef = useRef(categoryId);
  searchRef.current = search;
  categoryRef.current = categoryId;
  const skipNextFocusLoad = useRef(true);
  const loadingMoreRef = useRef(false);
  const hydratedFromCacheRef = useRef(false);
  /** Bumps on each list fetch so a slow search cannot wipe results after clear. */
  const loadSeqRef = useRef(0);
  const lastLoadedAtRef = useRef(0);
  const catalogRevisionSeen = useRef(getCatalogRevision());
  const lastScanRef = useRef({ code: '', at: 0 });
  const categoryOpenRef = useRef(categoryOpen);
  categoryOpenRef.current = categoryOpen;

  const categoryOptions = useMemo(
    () => categories.map((c) => {
      const label = localizedLabel(c.name, c, ui);
      const other = ui === 'mr' ? (c.name || '') : resolveNameMr(c);
      return {
        id: c.id,
        label,
        searchText: other && other !== label ? other : undefined,
      };
    }),
    [categories, ui],
  );

  const selectedCategoryLabel = useMemo(() => {
    if (!categoryId) return t('All');
    const cat = categories.find((c) => c.id === categoryId);
    return cat ? localizedLabel(cat.name, cat, ui) : t('All');
  }, [categories, categoryId, t, ui]);

  const loadCategories = useCallback(async (opts?: { syncMaster?: boolean }) => {
    try {
      // Categories first (fast). Master sync is throttled and optional — it was blocking every open.
      const rows = await fetchCategories();
      setCategories(rows || []);
      if (opts?.syncMaster !== false) {
        void syncCatalogFromMaster().then(async () => {
          try {
            setCategories((await fetchCategories()) || []);
          } catch {
            // keep current categories
          }
        }).catch(() => null);
      }
    } catch {
      setCategories([]);
    }
  }, []);

  const hydrateFromCache = useCallback(async () => {
    if (!isCatalogCacheEnabled()) return false;
    const { shouldUseLocalCatalog } = await import('../../offline/localCatalog');
    if (shouldUseLocalCatalog()) return false;
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
      setProducts(cachedProducts.items.slice(0, PAGE_SIZE));
      setTotalCount(cachedProducts.total);
      setPage(1);
      setHasMore(cachedProducts.total > PAGE_SIZE);
      setLoading(false);
      hydratedFromCacheRef.current = true;
      return true;
    }
    return false;
  }, []);

  const load = useCallback(async (
    query = '',
    catId: string | null = null,
    pageNum = 1,
    append = false,
  ) => {
    const seq = append ? loadSeqRef.current : ++loadSeqRef.current;
    try {
      setLoadError('');
      const result = await fetchProducts({
        page: pageNum,
        limit: PAGE_SIZE,
        search: query || undefined,
        categoryId: catId || undefined,
      });
      if (seq !== loadSeqRef.current) return;
      const items = result?.items || [];
      const total = result?.pagination?.total ?? items.length;
      const totalPages = result?.pagination?.totalPages || 1;
      setTotalCount(total);
      setPage(pageNum);
      setHasMore(pageNum < totalPages);
      setProducts((prev) => (append ? [...prev, ...items] : items));
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      if (!append && !hydratedFromCacheRef.current) {
        setProducts([]);
        setTotalCount(0);
        setHasMore(false);
      }
      const message = apiError(err, tRef.current('Could not load products'));
      setLoadError(message);
      if (!append && !hydratedFromCacheRef.current) {
        Alert.alert(tRef.current('Load failed'), message);
      }
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || loading || refreshing || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      await load(searchRef.current, categoryRef.current, page + 1, true);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, loading, load, page, refreshing]);

  const toggleFavorite = useCallback(async (product: Product) => {
    const next = !isProductFavorite(product);
    // Update star only — do not move the row or the next item jumps away.
    setProducts((prev) => prev.map((p) => (
      p.id === product.id
        ? { ...p, is_favorite: next, isFavorite: next }
        : p
    )));
    try {
      await setProductFavorite(product.id, next);
    } catch (err) {
      setProducts((prev) => prev.map((p) => (
        p.id === product.id
          ? { ...p, is_favorite: !next, isFavorite: !next }
          : p
      )));
      Alert.alert(t('Update failed'), apiError(err, t('Could not update favorite')));
    }
  }, [t]);

  const confirmFavoriteAllInCategory = useCallback(() => {
    if (!categoryId || favoritingAll) return;
    const label = selectedCategoryLabel;
    Alert.alert(
      t('Favorite all in category?'),
      t('Mark every product in "{{name}}" as favorite?', { name: label }),
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
              setProducts((prev) => prev.map((p) => (
                (p.category_id || p.category?.id) === categoryId
                  ? { ...p, is_favorite: true, isFavorite: true }
                  : p
              )));
              Alert.alert(
                t('Done'),
                result.updated === 1
                  ? t('{{count}} product marked favorite', { count: result.updated })
                  : t('{{count}} products marked favorite', { count: result.updated }),
              );
            } catch (err) {
              Alert.alert(t('Update failed'), apiError(err, t('Could not update favorite')));
            } finally {
              setFavoritingAll(false);
            }
          },
        },
      ],
    );
  }, [categoryId, favoritingAll, selectedCategoryLabel, t]);

  // Categories once per mount — not on every search keystroke.
  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
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

      await load(search, categoryId, 1, false);
      if (!cancelled) {
        setLoading(false);
        lastLoadedAtRef.current = Date.now();
        catalogRevisionSeen.current = getCatalogRevision();
      }
    };

    if (!search.trim()) {
      void run();
    } else {
      timer = setTimeout(() => {
        void run();
      }, 300);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hydrateFromCache, load, search, categoryId]);

  useFocusEffect(
    useCallback(() => {
      if (skipNextFocusLoad.current) {
        skipNextFocusLoad.current = false;
        return;
      }
      const revision = getCatalogRevision();
      const stale =
        revision !== catalogRevisionSeen.current
        || !lastLoadedAtRef.current
        || Date.now() - lastLoadedAtRef.current > PRODUCT_LIST_TTL_MS;
      if (!stale) return;
      // Soft product refresh only — do not re-sync master on every tab focus.
      void load(searchRef.current, categoryRef.current, 1, false).then(() => {
        lastLoadedAtRef.current = Date.now();
        catalogRevisionSeen.current = getCatalogRevision();
      });
    }, [load]),
  );

  // After Sync / price edits, reload from SQLite + refreshed cache immediately.
  useEffect(() => {
    return subscribeCatalogChanges((revision) => {
      if (revision === catalogRevisionSeen.current) return;
      catalogRevisionSeen.current = revision;
      hydratedFromCacheRef.current = false;
      void load(searchRef.current, categoryRef.current, 1, false).then(() => {
        lastLoadedAtRef.current = Date.now();
        catalogRevisionSeen.current = getCatalogRevision();
      });
    });
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await syncCatalogFromMaster({ force: true }).catch(() => null);
    await Promise.all([
      loadCategories({ syncMaster: false }),
      load(search, categoryId, 1, false),
    ]);
    setRefreshing(false);
  };

  const openAddWithBarcode = useCallback((raw: string) => {
    const digits = numericBarcode(raw);
    if (!digits) {
      Alert.alert(t('Barcode'), t('Scan a number barcode'));
      return;
    }
    navigation.navigate('ProductForm', {
      scannedBarcode: digits,
      scanTarget: 'primary',
      scanNonce: Date.now(),
    });
  }, [navigation, t]);

  /** Scan on Product List: open product if found, otherwise Add Product with barcode filled. */
  const handleBarcodeScan = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (code.length < 3) return false;
    const now = Date.now();
    if (
      lastScanRef.current.code.toLowerCase() === code.toLowerCase()
      && now - lastScanRef.current.at < 800
    ) {
      return true;
    }
    lastScanRef.current = { code, at: now };

    try {
      const results = await searchProducts(code);
      const hit = results.length
        ? (matchBarcodeProduct(results, code) || results[0])
        : null;
      if (hit?.productId) {
        setSearch('');
        navigation.navigate('ProductDetail', { productId: hit.productId });
        return true;
      }
      setSearch('');
      openAddWithBarcode(code);
      return true;
    } catch {
      lastScanRef.current = { code: '', at: 0 };
      Alert.alert(t('Error'), t('Failed to look up product. Check your connection and try again.'));
      return false;
    }
  }, [navigation, openAddWithBarcode, t]);

  // USB / Bluetooth wedge scanner while Product List is open (desktop).
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    let buffer = '';
    let lastKey = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (categoryOpenRef.current) {
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

      if (event.key === 'Enter' || event.key === 'NumpadEnter') {
        const code = buffer.trim();
        buffer = '';
        if (code.length >= 6 && looksLikeBarcode(code)) {
          event.preventDefault();
          event.stopPropagation();
          void handleBarcodeScan(code);
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
  }, [handleBarcodeScan]);

  const confirmDeleteAll = () => {
    if (deletingAll) return;
    setFabOpen(false);
    Alert.alert(
      t('Delete all products?'),
      t('This removes every product in this shop. Saved bills stay as they are. This cannot be undone.'),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Delete all'),
          style: 'destructive',
          onPress: async () => {
            setDeletingAll(true);
            try {
              const result = await deleteAllProducts();
              setProducts([]);
              setSearch('');
              setCategoryId(null);
              Alert.alert(
                t('Products deleted'),
                result.deleted
                  ? t('Deleted {{count}} products', { count: result.deleted })
                  : t('No products to delete'),
              );
            } catch (err) {
              Alert.alert(t('Delete failed'), apiError(err, t('Could not delete products')));
            } finally {
              setDeletingAll(false);
            }
          },
        },
      ],
    );
  };

  const openProduct = useCallback((productId: string) => {
    navigation.navigate('ProductDetail', { productId });
  }, [navigation]);

  const editProduct = useCallback((productId: string) => {
    navigation.navigate('ProductForm', { productId });
  }, [navigation]);

  const confirmDelete = useCallback((product: Product) => {
    Alert.alert(
      t('Delete product?'),
      t('Remove "{{name}}"? This cannot be undone.', { name: product.name }),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProduct(product.id);
              setProducts((prev) => prev.filter((p) => p.id !== product.id));
            } catch (err) {
              Alert.alert(t('Delete failed'), apiError(err, t('Could not delete product')));
            }
          },
        },
      ],
    );
  }, [t]);

  const renderMobileProduct = useCallback(({ item }: { item: Product }) => (
    <MobileProductRow
      product={item}
      ui={ui}
      t={t}
      onOpen={openProduct}
      onEdit={editProduct}
      onFavorite={toggleFavorite}
      onDelete={confirmDelete}
    />
  ), [ui, t, openProduct, editProduct, toggleFavorite, confirmDelete]);

  const empty = !loading ? (
    <EmptyState
      icon={loadError ? 'alert-circle-outline' : 'package-variant-closed'}
      title={loadError ? t('Could not load products') : t('No products found')}
      subtitle={
        loadError ||
        (categoryId
          ? t('Try another category or clear the filter')
          : t('Tap + to add your first product'))
      }
    />
  ) : null;

  return (
    <View style={common.screen}>
      <View style={styles.filterBar}>
        <View style={styles.toolbar}>
          <View style={styles.searchBox}>
            <Icon name="magnify" size={18} color={colors.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={t('Search products...')}
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={() => {
                const q = search.trim();
                if (looksLikeBarcode(q)) void handleBarcodeScan(q);
              }}
            />
            {search ? (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <Icon name="close-circle" size={16} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          <Pressable
            onPress={() => navigation.navigate('BarcodeScanner', { purpose: 'productList' })}
            style={styles.scanBtn}
            accessibilityLabel={t('Scan barcode')}>
            <Icon name="barcode-scan" size={20} color={colors.textOnPrimary} />
          </Pressable>

          {categoryOptions.length > 0 ? (
            <Pressable
              onPress={() => {
                Keyboard.dismiss();
                setCategoryOpen(true);
              }}
              style={[styles.categoryBtn, categoryId ? styles.categoryBtnOn : null]}
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
                  <Icon
                    name="close-circle"
                    size={16}
                    color={categoryId ? colors.textOnPrimary : colors.textMuted}
                  />
                </Pressable>
              ) : (
                <Icon name="chevron-down" size={18} color={colors.primary} />
              )}
            </Pressable>
          ) : null}
        </View>

        {categoryId ? (
          <Pressable
            onPress={confirmFavoriteAllInCategory}
            disabled={favoritingAll || !products.length}
            style={[styles.favoriteAllBtn, favoritingAll && styles.deleteAllBtnBusy]}
            accessibilityLabel={t('Favorite all in category')}>
            {favoritingAll ? (
              <ActivityIndicator size="small" color={colors.warning} />
            ) : (
              <Icon name="star" size={18} color={colors.warning} />
            )}
            <Text style={styles.favoriteAllText}>{t('Favorite all')}</Text>
          </Pressable>
        ) : null}

        <View style={styles.actionsRow}>
          <Text style={styles.countLine} numberOfLines={1}>
            {totalCount === 1
              ? t('{{count}} product', { count: totalCount })
              : t('{{count}} products', { count: totalCount })}
            {products.length < totalCount
              ? ` · ${t('Showing {{loaded}}', { loaded: products.length })}`
              : ''}
            {categoryId ? ` · ${selectedCategoryLabel}` : ''}
          </Text>
          <Pressable
            onPress={onRefresh}
            disabled={refreshing}
            style={[styles.reloadBtn, refreshing && styles.deleteAllBtnBusy]}
            accessibilityLabel={t('Refresh')}>
            {refreshing ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Icon name="refresh" size={20} color={colors.primary} />
            )}
          </Pressable>
          <Pressable
            onPress={confirmDeleteAll}
            disabled={deletingAll}
            style={[styles.deleteAllBtn, deletingAll && styles.deleteAllBtnBusy]}
            accessibilityLabel={t('Delete all')}>
            <Icon name="delete-sweep" size={18} color={colors.error} />
            <Text style={styles.deleteAllText}>{t('Delete all')}</Text>
          </Pressable>
        </View>
      </View>

      {IS_WEB ? (
        <View style={styles.tableCard}>
          <View style={styles.head}>
            <Text style={[styles.headCell, styles.colProduct]}>{t('PRODUCT')}</Text>
            <Text style={[styles.headCell, styles.colCategory]}>{t('CATEGORY')}</Text>
            <Text style={[styles.headCell, styles.colVariant]}>{t('VARIANT')}</Text>
            <Text style={[styles.headCell, styles.colPrice, styles.headRight]}>{t('PRICE')}</Text>
            <Text style={[styles.headCell, styles.colStock, styles.headRight]}>{t('STOCK')}</Text>
            <Text style={[styles.headCell, styles.colBarcode]}>{t('BARCODE')}</Text>
            <Text style={[styles.headCell, styles.colActions, styles.headRight]}>{t('ACTIONS')}</Text>
          </View>

          <FlatList
            style={styles.tableBody}
            data={products}
            keyExtractor={(item) => item.id}
            initialNumToRender={24}
            maxToRenderPerBatch={24}
            windowSize={7}
            removeClippedSubviews
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={!products.length && !loading ? styles.emptyGrow : undefined}
            refreshControl={(
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={[colors.primary]}
              />
            )}
            ListEmptyComponent={empty}
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              loadingMore ? (
                <View style={styles.footerLoading}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : null
            }
            renderItem={({ item, index }) => {
              const stock = stockQtyOf(item);
              const low = stock <= 0;
              const favorite = isProductFavorite(item);
              return (
                <Pressable
                  onPress={() => navigation.navigate('ProductDetail', { productId: item.id })}
                  style={[styles.row, index % 2 === 1 && styles.rowAlt, favorite && styles.rowFavorite]}>
                  <View style={styles.colProduct}>
                    <View style={styles.nameRow}>
                      <Pressable
                        onPress={() => toggleFavorite(item)}
                        style={styles.favBtn}
                        hitSlop={6}
                        accessibilityLabel={favorite ? t('Remove from favorites') : t('Add to favorites')}>
                        <Icon
                          name={favorite ? 'star' : 'star-outline'}
                          size={18}
                          color={favorite ? colors.warning : colors.textSecondary}
                        />
                      </Pressable>
                      <View style={styles.nameTextWrap}>
                        <Text style={styles.productName} numberOfLines={2}>
                          {localizedLabel(item.name, item, ui)}
                        </Text>
                        <Text style={styles.productMeta} numberOfLines={1}>
                          {item.brand?.name || item.uom?.code || '—'}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.colCategory}>
                    <Text style={styles.cellText} numberOfLines={1}>
                      {item.category?.name || '—'}
                    </Text>
                  </View>
                  <View style={styles.colVariant}>
                    <View style={styles.variantBadge}>
                      <Text style={styles.variantBadgeText} numberOfLines={1}>
                        {variantSummary(item, t)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.colPrice}>
                    <Text style={[styles.priceText, styles.alignRight]} numberOfLines={1}>
                      {formatPrice(item)}
                    </Text>
                  </View>
                  <View style={styles.colStock}>
                    <Text
                      style={[
                        styles.stockText,
                        styles.alignRight,
                        low && styles.stockLow,
                      ]}
                      numberOfLines={1}>
                      {formatStock(item)}
                    </Text>
                    {low ? <Text style={styles.outTag}>{t('Out')}</Text> : null}
                  </View>
                  <View style={styles.colBarcode}>
                    <Text style={styles.barcodeText} numberOfLines={1}>
                      {primaryBarcode(item)}
                    </Text>
                  </View>
                  <View style={styles.colActions}>
                    <Pressable
                      onPress={() => navigation.navigate('ProductDetail', { productId: item.id })}
                      style={styles.iconBtn}
                      hitSlop={6}
                      accessibilityLabel={t('View {{name}}', { name: item.name })}>
                      <Icon name="eye-outline" size={18} color={colors.primary} />
                    </Pressable>
                    <Pressable
                      onPress={() => navigation.navigate('ProductForm', { productId: item.id })}
                      style={styles.iconBtn}
                      hitSlop={6}
                      accessibilityLabel={t('Edit {{name}}', { name: item.name })}>
                      <Icon name="pencil-outline" size={18} color={colors.textSecondary} />
                    </Pressable>
                    <Pressable
                      onPress={() => confirmDelete(item)}
                      style={styles.iconBtn}
                      hitSlop={6}
                      accessibilityLabel={t('Delete {{name}}', { name: item.name })}>
                      <Icon name="trash-can-outline" size={18} color={colors.error} />
                    </Pressable>
                  </View>
                </Pressable>
              );
            }}
          />
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={productKeyExtractor}
          initialNumToRender={16}
          maxToRenderPerBatch={16}
          windowSize={7}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={products.length ? common.listContent : styles.emptyList}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[colors.primary]}
            />
          )}
          ListEmptyComponent={empty}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoading}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null
          }
          renderItem={renderMobileProduct}
        />
      )}

      <FAB.Group
        open={fabOpen}
        visible
        icon={fabOpen ? 'close' : 'plus'}
        actions={[
          {
            icon: 'barcode-scan',
            label: t('Scan barcode'),
            onPress: () => navigation.navigate('BarcodeScanner', { purpose: 'productList' }),
          },
          {
            icon: 'download',
            label: t('Import products'),
            onPress: () => navigation.navigate('ImportMasterProducts'),
          },
          {
            icon: 'plus',
            label: t('Add product'),
            onPress: () => navigation.navigate('ProductForm'),
          },
        ]}
        onStateChange={({ open }) => setFabOpen(open)}
        style={styles.fabGroup}
        fabStyle={styles.fabGroupButton}
        color={colors.textOnPrimary}
      />

      <CategoryPickerSheet
        visible={categoryOpen}
        options={categoryOptions}
        value={categoryId}
        onSelect={setCategoryId}
        onClose={() => setCategoryOpen(false)}
      />
    </View>
  );
}

const webGrid = Platform.select({
  web: {
    display: 'grid' as unknown as 'flex',
    gridTemplateColumns:
      'minmax(0, 2.4fr) minmax(0, 1.2fr) minmax(0, 1fr) minmax(96px, 1fr) minmax(88px, 0.9fr) minmax(120px, 1.3fr) minmax(120px, 1fr)',
    gap: 12,
  } as object,
  default: {},
});

const styles = StyleSheet.create({
  emptyList: { flexGrow: 1 },
  emptyGrow: { flexGrow: 1 },
  footerLoading: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBar: {
    zIndex: 20,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    zIndex: 30,
  },
  categoryBtn: {
    flex: 1,
    minWidth: 120,
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
  searchBox: {
    flex: 1.4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 42,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceVariant,
  },
  scanBtn: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    paddingVertical: 0,
    ...Platform.select({ web: { outlineStyle: 'none' } as object, default: {} }),
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
  favoriteAllText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.warning,
  },
  reloadBtn: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  deleteAllBtn: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.surface,
  },
  deleteAllBtnBusy: { opacity: 0.6 },
  deleteAllText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.error,
  },
  countLine: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  tableCard: {
    flex: 1,
    width: '100%',
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  tableBody: { flex: 1, width: '100%' },
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
    ...webGrid,
  },
  headCell: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.7,
  },
  headRight: { textAlign: 'right' },
  row: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    backgroundColor: colors.surface,
    ...webGrid,
  },
  rowAlt: { backgroundColor: '#FAFBFD' },
  rowFavorite: { backgroundColor: colors.warningLight },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  nameTextWrap: { flex: 1, minWidth: 0 },
  favBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  trailingRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  mobileRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 2,
  },
  mobilePrice: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.secondary,
    textAlign: 'right',
  },
  mobileStock: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textAlign: 'right',
  },
  mobileStockLow: {
    color: colors.warning,
  },
  colProduct: {
    flexGrow: 2.4,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    overflow: 'hidden',
  },
  colCategory: {
    flexGrow: 1.2,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    overflow: 'hidden',
  },
  colVariant: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    overflow: 'hidden',
  },
  colPrice: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    overflow: 'hidden',
  },
  colStock: {
    flexGrow: 0.9,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    overflow: 'hidden',
  },
  colBarcode: {
    flexGrow: 1.3,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    overflow: 'hidden',
  },
  colActions: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 4,
  },
  productName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    flexShrink: 1,
  },
  productMeta: {
    marginTop: 3,
    fontSize: 11,
    color: colors.textMuted,
  },
  cellText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  variantBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceVariant,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  variantBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  priceText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.secondary,
  },
  stockText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  stockLow: { color: colors.warning },
  outTag: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '700',
    color: colors.warning,
    textAlign: 'right',
  },
  barcodeText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  alignRight: { textAlign: 'right' },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceVariant,
  },
  fabGroup: {
    paddingBottom: spacing.sm,
    paddingRight: spacing.sm,
  },
  fabGroupButton: {
    backgroundColor: colors.primary,
  },
});
