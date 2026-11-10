import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Chip, FAB, Searchbar, Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import EmptyState from '../../components/ui/EmptyState';
import SurfaceCard from '../../components/ui/SurfaceCard';
import { fetchStockBalances } from '../../services/inventoryService';
import type { StockBalance } from '../../services/inventoryService';
import { useT } from '../../i18n';
import { apiError } from '../../utils/apiError';
import { colors } from '../../theme/colors';
import { common, radius, spacing, typography } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'StockList'>;

type StockFilter = 'all' | 'low' | 'in_stock';

const FILTERS: Array<{ id: StockFilter; label: string; icon: string }> = [
  { id: 'all', label: 'All', icon: 'view-list' },
  { id: 'low', label: 'Low', icon: 'alert-outline' },
  { id: 'in_stock', label: 'In stock', icon: 'check-circle-outline' },
];

export default function StockListScreen({ navigation }: Props) {
  const t = useT();
  const [items, setItems] = useState<StockBalance[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StockFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const skipNextFocus = useRef(true);

  const isLow = useCallback((item: StockBalance) => {
    const qty = parseFloat(String(item.quantity)) || 0;
    const reorder = parseFloat(String(item.variant?.reorder_level || 0)) || 0;
    if (reorder > 0) return qty <= reorder;
    return qty <= 0;
  }, []);

  const load = useCallback(async () => {
    try {
      // Always fetch full catalog; filter client-side so All / Low / In stock stay consistent.
      const result = await fetchStockBalances({
        page: 1,
        limit: 500,
        search: search.trim() || undefined,
      });
      setItems(result.items || []);
    } catch (err) {
      setItems([]);
      Alert.alert(t('Load failed'), apiError(err, 'Could not load stock'));
    }
  }, [search, t]);

  useEffect(() => {
    setLoading(true);
    if (!search.trim()) {
      load().finally(() => setLoading(false));
      return;
    }
    const timer = setTimeout(() => load().finally(() => setLoading(false)), 300);
    return () => clearTimeout(timer);
  }, [load, search]);

  useFocusEffect(
    useCallback(() => {
      if (skipNextFocus.current) {
        skipNextFocus.current = false;
        return;
      }
      load();
    }, [load]),
  );

  const filteredItems = useMemo(() => {
    if (filter === 'low') return items.filter((i) => isLow(i));
    if (filter === 'in_stock') return items.filter((i) => !isLow(i) && (parseFloat(String(i.quantity)) || 0) > 0);
    return items;
  }, [items, filter, isLow]);

  const stats = useMemo(() => {
    const low = items.filter((i) => isLow(i)).length;
    const inStock = items.filter((i) => (parseFloat(String(i.quantity)) || 0) > 0).length;
    return { total: items.length, low, inStock };
  }, [items, isLow]);

  const emptyTitle =
    filter === 'low' ? t('No low stock items')
      : filter === 'in_stock' ? t('No products in stock')
        : t('No products yet');
  const emptySubtitle =
    filter === 'low' ? t('Nothing is at or below reorder / zero stock')
      : filter === 'in_stock' ? t('Add stock to products to see them here')
        : t('Add products, then stock will show here');

  return (
    <View style={common.screen}>
      <View style={styles.header}>
        <Searchbar
          placeholder={t('Search stock...')}
          value={search}
          onChangeText={setSearch}
          style={styles.search}
          inputStyle={styles.searchInput}
          iconColor={colors.primary}
          elevation={0}
        />
        <View style={styles.statRow}>
          <SurfaceCard style={styles.statCard} padding>
            <Text style={styles.statNum}>{stats.total}</Text>
            <Text style={styles.statLbl}>{t('All')}</Text>
          </SurfaceCard>
          <SurfaceCard style={[styles.statCard, stats.low > 0 ? styles.statWarn : undefined]} padding>
            <Text style={[styles.statNum, stats.low > 0 && { color: colors.error }]}>{stats.low}</Text>
            <Text style={styles.statLbl}>{t('Low')}</Text>
          </SurfaceCard>
          <SurfaceCard style={styles.statCard} padding>
            <Text style={styles.statNum}>{stats.inStock}</Text>
            <Text style={styles.statLbl}>{t('In stock')}</Text>
          </SurfaceCard>
        </View>
        <View style={styles.chips}>
          {FILTERS.map((f) => (
            <Chip
              key={f.id}
              selected={filter === f.id}
              onPress={() => setFilter(f.id)}
              icon={f.icon}
              style={styles.chip}
              showSelectedOverlay
              selectedColor={colors.primary}>
              {t(f.label)}
            </Chip>
          ))}
          <Chip onPress={() => navigation.navigate('StockHistory')} icon="history" style={styles.chip}>
            {t('History')}
          </Chip>
        </View>
      </View>

      <FlatList
        data={filteredItems}
        keyExtractor={(i) => i.id}
        contentContainerStyle={filteredItems.length ? styles.list : styles.emptyList}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} colors={[colors.primary]} />}
        ListEmptyComponent={
          loading
            ? null
            : (
              <EmptyState
                icon="warehouse"
                title={emptyTitle}
                subtitle={emptySubtitle}
              />
            )
        }
        renderItem={({ item }) => {
          const qty = parseFloat(String(item.quantity));
          const low = isLow(item);
          const uom = item.variant?.uom?.code || '';
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => navigation.navigate('StockOperation', {
                mode: 'in',
                variantId: item.variant_id,
                productId: item.variant?.product?.id,
                productName: item.variant?.product?.name || t('Product'),
                sku: item.variant?.sku,
                size: item.variant?.size,
                color: item.variant?.color,
                stockQty: qty,
                uomCode: item.variant?.uom?.code,
              })}>
              <View style={[styles.rowIcon, low && styles.rowIconLow]}>
                <Icon name="cube-outline" size={22} color={low ? colors.error : colors.primary} />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.variant?.product?.name || t('Unknown')}</Text>
                <Text style={styles.rowSub}>{item.variant?.sku}</Text>
              </View>
              <View style={styles.rowRight}>
                <Text style={[styles.rowQty, low && { color: colors.error }]}>{qty.toFixed(qty % 1 ? 2 : 0)}</Text>
                <Text style={styles.rowUom}>{uom}</Text>
                {low && <View style={styles.lowTag}><Text style={styles.lowTagText}>{t('LOW')}</Text></View>}
              </View>
            </Pressable>
          );
        }}
      />

      <FAB icon="plus" label={t('Add')} style={styles.fab} color={colors.textOnPrimary} onPress={() => navigation.navigate('StockOperation', { mode: 'in' })} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { padding: spacing.lg, paddingBottom: spacing.sm },
  search: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  searchInput: { fontSize: 15 },
  statRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  statCard: { flex: 1, marginBottom: 0, alignItems: 'center' },
  statWarn: { borderColor: '#FECACA' },
  statNum: { ...typography.h1, color: colors.primary },
  statLbl: { ...typography.caption, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {},
  list: { paddingHorizontal: spacing.lg, paddingBottom: 100 },
  emptyList: { flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.primaryLight },
  rowIcon: {
    width: 44, height: 44, borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.md,
  },
  rowIconLow: { backgroundColor: colors.errorLight },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  rowQty: { fontSize: 20, fontWeight: '700', color: colors.secondary },
  rowUom: { fontSize: 11, color: colors.textMuted },
  lowTag: { marginTop: spacing.xs, backgroundColor: colors.errorLight, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  lowTagText: { fontSize: 10, fontWeight: '700', color: colors.error },
  fab: { position: 'absolute', right: spacing.lg, bottom: spacing.lg, backgroundColor: colors.primary },
});
