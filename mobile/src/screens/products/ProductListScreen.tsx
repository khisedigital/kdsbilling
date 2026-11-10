import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
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
import {
  deleteAllProducts,
  deleteProduct,
  fetchCategories,
  fetchProducts,
  mainBarcodeOf,
} from '../../services/catalogService';
import type { Category, Product } from '../../types/catalog';
import { apiError } from '../../utils/apiError';
import { variantLabel } from '../../utils/variantLabel';
import { colors } from '../../theme/colors';
import { common, radius, spacing } from '../../theme/layout';
import { formatQuantity } from '../../utils/quantity';

type Props = NativeStackScreenProps<MainStackParamList, 'ProductList'>;

const IS_WEB = Platform.OS === 'web';

function formatPrice(product: Product) {
  const variants = product.variants || [];
  if (!variants.length) return '—';
  if (variants.length === 1) {
    return `₹${parseFloat(String(variants[0].selling_price)).toFixed(2)}`;
  }
  const prices = variants.map((v) => parseFloat(String(v.selling_price)) || 0);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) return `₹${min.toFixed(2)}`;
  return `₹${min.toFixed(0)}–${max.toFixed(0)}`;
}

function formatStock(product: Product) {
  const qty =
    product.stockQty ??
    product.variants?.reduce((sum, v) => sum + (v.stockQty || 0), 0) ??
    0;
  const uom = product.uom;
  return formatQuantity(qty, uom ? { code: uom.code, type: uom.type } : { code: 'pcs', type: 'count' });
}

function stockQtyOf(product: Product) {
  return (
    product.stockQty ??
    product.variants?.reduce((sum, v) => sum + (v.stockQty || 0), 0) ??
    0
  );
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

export default function ProductListScreen({ navigation }: Props) {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [fabOpen, setFabOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const searchRef = useRef(search);
  const categoryRef = useRef(categoryId);
  searchRef.current = search;
  categoryRef.current = categoryId;
  const skipNextFocusLoad = useRef(true);

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ id: c.id, label: c.name })),
    [categories],
  );

  const selectedCategoryLabel = useMemo(() => {
    if (!categoryId) return t('All');
    return categories.find((c) => c.id === categoryId)?.name || t('All');
  }, [categories, categoryId, t]);

  const loadCategories = useCallback(async () => {
    try {
      setCategories((await fetchCategories()) || []);
    } catch {
      setCategories([]);
    }
  }, []);

  const load = useCallback(async (query = '', catId: string | null = null) => {
    try {
      setLoadError('');
      const result = await fetchProducts({
        page: 1,
        limit: IS_WEB ? 500 : 100,
        search: query || undefined,
        categoryId: catId || undefined,
      });
      setProducts(result?.items || []);
    } catch (err) {
      setProducts([]);
      const message = apiError(err, tRef.current('Could not load products'));
      setLoadError(message);
      Alert.alert(tRef.current('Load failed'), message);
    }
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const run = () => {
      load(search, categoryId).finally(() => {
        if (!cancelled) setLoading(false);
      });
    };
    if (!search.trim()) {
      run();
      return () => {
        cancelled = true;
      };
    }
    const timer = setTimeout(run, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load, search, categoryId]);

  useFocusEffect(
    useCallback(() => {
      if (skipNextFocusLoad.current) {
        skipNextFocusLoad.current = false;
        return;
      }
      loadCategories();
      load(searchRef.current, categoryRef.current);
    }, [load, loadCategories]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadCategories(), load(search, categoryId)]);
    setRefreshing(false);
  };

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

  const confirmDelete = (product: Product) => {
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
  };

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
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Icon name="magnify" size={20} color={colors.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={t('Search products...')}
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {search ? (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <Icon name="close-circle" size={18} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
          {categoryOptions.length > 0 ? (
            <Pressable
              onPress={() => {
                Keyboard.dismiss();
                setCategoryPickerOpen(true);
              }}
              style={[styles.categoryBtn, categoryId ? styles.categoryBtnOn : null]}
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
        {IS_WEB ? (
          <Text style={styles.countLine}>
            {products.length === 1
              ? t('{{count}} product', { count: products.length })
              : t('{{count}} products', { count: products.length })}
            {categoryId ? ` · ${selectedCategoryLabel}` : ''}
          </Text>
        ) : null}
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

          <ScrollView
            style={styles.tableBody}
            contentContainerStyle={!products.length && !loading ? styles.emptyGrow : undefined}
            keyboardShouldPersistTaps="handled"
            refreshControl={(
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={[colors.primary]}
              />
            )}>
            {!products.length ? empty : null}

            {products.map((item, index) => {
              const stock = stockQtyOf(item);
              const low = stock <= 0;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => navigation.navigate('ProductDetail', { productId: item.id })}
                  style={[styles.row, index % 2 === 1 && styles.rowAlt]}>
                  <View style={styles.colProduct}>
                    <Text style={styles.productName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.productMeta} numberOfLines={1}>
                      {item.brand?.name || item.uom?.code || '—'}
                    </Text>
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
            })}
          </ScrollView>
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.id}
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
          renderItem={({ item }) => {
            const stock = stockQtyOf(item);
            const low = stock <= 0;
            const sizeCount = item.variants?.length || 0;
            return (
              <ListRow
                title={item.name}
                subtitle={
                  sizeCount > 1
                    ? t('{{category}} · {{count}} sizes · Stock {{stock}}', {
                        category: item.category?.name || t('No category'),
                        count: sizeCount,
                        stock: formatStock(item),
                      })
                    : t('{{category}} · Stock {{stock}}', {
                        category: item.category?.name || t('No category'),
                        stock: formatStock(item),
                      })
                }
                icon="package-variant"
                iconColor={low ? colors.warning : colors.primary}
                iconBg={low ? colors.warningLight : colors.primaryLight}
                right={formatPrice(item)}
                badge={
                  low
                    ? { label: t('No stock'), color: colors.warning, bg: colors.warningLight }
                    : undefined
                }
                onPress={() => navigation.navigate('ProductDetail', { productId: item.id })}
                onLongPress={() => navigation.navigate('ProductForm', { productId: item.id })}
                trailing={(
                  <Pressable
                    onPress={() => confirmDelete(item)}
                    style={styles.iconBtn}
                    hitSlop={8}
                    accessibilityLabel={t('Delete {{name}}', { name: item.name })}>
                    <Icon name="trash-can-outline" size={18} color={colors.error} />
                  </Pressable>
                )}
              />
            );
          }}
        />
      )}

      <FAB.Group
        open={fabOpen}
        visible
        icon={fabOpen ? 'close' : 'plus'}
        actions={[
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
        visible={categoryPickerOpen}
        options={categoryOptions}
        value={categoryId}
        onSelect={setCategoryId}
        onClose={() => setCategoryPickerOpen(false)}
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
  filterBar: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
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
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    paddingVertical: 0,
    ...Platform.select({ web: { outlineStyle: 'none' } as object, default: {} }),
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
  reloadBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  deleteAllBtn: {
    height: 44,
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
    marginTop: spacing.sm,
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
