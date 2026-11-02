import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Keyboard,
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
import { fetchCategories, fetchProducts } from '../../services/catalogService';
import type { Category, Product } from '../../types/catalog';
import { apiError } from '../../utils/apiError';
import { colors } from '../../theme/colors';
import { common, radius, spacing } from '../../theme/layout';
import { formatQuantity } from '../../utils/quantity';

type Props = NativeStackScreenProps<MainStackParamList, 'ProductList'>;

export default function ProductListScreen({ navigation }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [fabOpen, setFabOpen] = useState(false);
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
    if (!categoryId) return 'All';
    return categories.find((c) => c.id === categoryId)?.name || 'All';
  }, [categories, categoryId]);

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
        limit: 100,
        search: query || undefined,
        categoryId: catId || undefined,
      });
      setProducts(result?.items || []);
    } catch (err) {
      setProducts([]);
      const message = apiError(err, 'Could not load products');
      setLoadError(message);
      Alert.alert('Load failed', message);
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
    const t = setTimeout(run, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
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

  const formatPrice = (product: Product) => {
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
  };

  const formatStock = (product: Product) => {
    const qty =
      product.stockQty ??
      product.variants?.reduce((sum, v) => sum + (v.stockQty || 0), 0) ??
      0;
    const uom = product.uom;
    return formatQuantity(qty, uom ? { code: uom.code, type: uom.type } : { code: 'pcs', type: 'count' });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadCategories(), load(search, categoryId)]);
    setRefreshing(false);
  };

  return (
    <View style={common.screen}>
      <View style={styles.filterBar}>
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Icon name="magnify" size={20} color={colors.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search products..."
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
        </View>
      </View>

      <FlatList
        data={products}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={products.length ? common.listContent : styles.emptyList}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon={loadError ? 'alert-circle-outline' : 'package-variant-closed'}
              title={loadError ? 'Could not load products' : 'No products found'}
              subtitle={
                loadError ||
                (categoryId
                  ? 'Try another category or clear the filter'
                  : 'Tap + to add your first product')
              }
            />
          )
        }
        renderItem={({ item }) => {
          const stock = item.stockQty ?? 0;
          const low = stock <= 0;
          const sizeCount = item.variants?.length || 0;
          return (
            <ListRow
              title={item.name}
              subtitle={`${item.category?.name || 'No category'}${
                sizeCount > 1 ? ` · ${sizeCount} sizes` : ''
              } · Stock ${formatStock(item)}`}
              icon="package-variant"
              iconColor={low ? colors.warning : colors.primary}
              iconBg={low ? colors.warningLight : colors.primaryLight}
              right={formatPrice(item)}
              badge={
                low
                  ? { label: 'No stock', color: colors.warning, bg: colors.warningLight }
                  : undefined
              }
              onPress={() => navigation.navigate('ProductDetail', { productId: item.id })}
              onLongPress={() => navigation.navigate('ProductForm', { productId: item.id })}
            />
          );
        }}
      />

      <FAB.Group
        open={fabOpen}
        visible
        icon={fabOpen ? 'close' : 'plus'}
        actions={[
          {
            icon: 'download',
            label: 'Import master',
            onPress: () => navigation.navigate('ImportMasterProducts'),
          },
          {
            icon: 'plus',
            label: 'Add product',
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

const styles = StyleSheet.create({
  emptyList: { flexGrow: 1 },
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
  fabGroup: {
    paddingBottom: spacing.sm,
    paddingRight: spacing.sm,
  },
  // Do not use absolute positioning here — FAB.Group stacks actions above the main button.
  fabGroupButton: {
    backgroundColor: colors.primary,
  },
});
