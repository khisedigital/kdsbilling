import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import EmptyState from '../../components/ui/EmptyState';
import ScreenSearch from '../../components/ui/ScreenSearch';
import { fetchStockHistory } from '../../services/inventoryService';
import type { StockLedgerEntry } from '../../services/inventoryService';
import { colors } from '../../theme/colors';
import { common, radius, shadow, spacing } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'StockHistory'>;

const TYPE_LABELS: Record<string, string> = {
  OPENING: 'Opening', PURCHASE_IN: 'Purchase', STOCK_IN: 'Stock In', STOCK_OUT: 'Stock Out',
  ADJUSTMENT: 'Adjustment', TRANSFER_IN: 'Transfer In', TRANSFER_OUT: 'Transfer Out', DAMAGE: 'Damaged', SALE: 'Sale',
};

const TYPE_ICONS: Record<string, string> = {
  STOCK_IN: 'arrow-down-bold', STOCK_OUT: 'arrow-up-bold', OPENING: 'archive-plus',
  ADJUSTMENT: 'tune', DAMAGE: 'alert-circle', SALE: 'cart', PURCHASE_IN: 'truck-delivery',
  TRANSFER_IN: 'swap-horizontal', TRANSFER_OUT: 'swap-horizontal',
};

const FILTER_TYPES = [
  { value: '', label: 'All', icon: 'filter-variant' },
  { value: 'STOCK_IN', label: 'In', icon: 'plus' },
  { value: 'STOCK_OUT', label: 'Out', icon: 'minus' },
  { value: 'ADJUSTMENT', label: 'Adjust', icon: 'tune' },
  { value: 'OPENING', label: 'Opening', icon: 'archive' },
  { value: 'DAMAGE', label: 'Damage', icon: 'alert' },
  { value: 'SALE', label: 'Sale', icon: 'cart' },
];

export default function StockHistoryScreen({ route }: Props) {
  const productId = route.params?.productId;
  const productName = route.params?.productName;
  const [items, setItems] = useState<StockLedgerEntry[]>([]);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async (pageNum = 1, append = false) => {
    try {
      setError('');
      const result = await fetchStockHistory({
        page: pageNum,
        movementType: filter || undefined,
        productId: productId || undefined,
      });
      setItems((prev) => (append ? [...prev, ...result.items] : result.items));
      setPage(pageNum);
      setHasMore(result.pagination.page < result.pagination.totalPages);
    } catch {
      setError('Failed to load stock history');
      if (!append) setItems([]);
    } finally {
      setLoading(false);
    }
  }, [filter, productId]);

  React.useEffect(() => {
    setLoading(true);
    load(1, false);
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load(1, false);
    setRefreshing(false);
  };

  const loadMore = () => {
    if (hasMore && !loading) load(page + 1, true);
  };

  const filtered = items.filter((item) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const name = item.variant?.product?.name || '';
    const sku = item.variant?.sku || '';
    const notes = item.notes || '';
    const typeLabel = TYPE_LABELS[item.movement_type] || item.movement_type;
    const creator = item.creator?.name || '';
    return [name, sku, notes, typeLabel, creator].some((v) => v.toLowerCase().includes(q));
  });

  return (
    <View style={common.screen}>
      <View style={styles.topBar}>
        {productName ? (
          <View style={styles.productBanner}>
            <Icon name="package-variant" size={18} color={colors.primary} />
            <Text style={styles.productBannerText} numberOfLines={1}>{productName}</Text>
          </View>
        ) : null}
        <ScreenSearch
          value={search}
          onChangeText={setSearch}
          placeholder={productId ? 'Search SKU, notes...' : 'Search product, SKU, notes...'}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterBar}
          contentContainerStyle={styles.filters}>
          {FILTER_TYPES.map((f) => {
            const on = filter === f.value;
            return (
              <Pressable
                key={f.value || 'all'}
                onPress={() => setFilter(f.value)}
                style={[styles.chip, on && styles.chipOn]}>
                <Icon name={f.icon} size={16} color={on ? colors.primary : colors.textSecondary} />
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <FlatList
        style={styles.listHost}
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={filtered.length === 0 ? styles.emptyList : styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="history"
              title={search.trim() ? 'No matching movements' : 'No movements yet'}
              subtitle={
                search.trim()
                  ? 'Try a different search'
                  : productId
                    ? 'No stock movements for this product yet'
                    : 'Stock add, remove and adjustments will show here'
              }
            />
          )
        }
        renderItem={({ item }) => {
          const change = parseFloat(String(item.quantity_change));
          const positive = change >= 0;
          const date = item.created_at ? new Date(item.created_at) : null;
          const typeLabel = TYPE_LABELS[item.movement_type] || item.movement_type;
          const icon = TYPE_ICONS[item.movement_type] || 'swap-vertical';
          return (
            <View style={styles.card}>
              <View style={[styles.iconWrap, { backgroundColor: positive ? colors.secondaryLight : '#FEE2E2' }]}>
                <Icon name={icon} size={20} color={positive ? colors.secondary : colors.error} />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.variant?.product?.name || 'Product'}
                </Text>
                <View style={styles.metaRow}>
                  <View style={styles.typeBadge}>
                    <Text style={styles.typeBadgeText}>{typeLabel}</Text>
                  </View>
                  <Text style={styles.sku}>{item.variant?.sku}</Text>
                </View>
                {date ? (
                  <Text style={styles.date}>
                    {date.toLocaleDateString()} · {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                ) : null}
                {item.notes ? <Text style={styles.note} numberOfLines={2}>{item.notes}</Text> : null}
                {item.creator?.name ? <Text style={styles.creator}>by {item.creator.name}</Text> : null}
              </View>
              <View style={styles.cardRight}>
                <Text style={[styles.qty, { color: positive ? colors.secondary : colors.error }]}>
                  {positive ? '+' : ''}{change.toFixed(2)}
                </Text>
                <Text style={styles.bal}>Bal {parseFloat(String(item.balance_after)).toFixed(2)}</Text>
              </View>
            </View>
          );
        }}
        ListFooterComponent={hasMore ? <Text style={styles.footer}>Loading more...</Text> : <View style={styles.footerSpace} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Keep search + filters above the scrolling list (overscroll was painting over chips).
  topBar: {
    zIndex: 2,
    elevation: 4,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  productBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
  },
  productBannerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  filterBar: { flexGrow: 0 },
  listHost: { flex: 1, zIndex: 0 },
  filters: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceVariant,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  chipOn: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  chipTextOn: { color: colors.primary },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  emptyList: { flexGrow: 1 },
  error: { textAlign: 'center', color: colors.error, padding: spacing.md },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  typeBadge: { backgroundColor: colors.surfaceVariant, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  typeBadgeText: { fontSize: 11, fontWeight: '600', color: colors.textMuted },
  sku: { fontSize: 12, color: colors.textMuted },
  date: { fontSize: 11, color: colors.textMuted, marginTop: spacing.xs },
  note: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic', marginTop: spacing.xs },
  creator: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  cardRight: { alignItems: 'flex-end', justifyContent: 'center' },
  qty: { fontSize: 18, fontWeight: '700' },
  bal: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  footer: { textAlign: 'center', padding: spacing.lg, color: colors.textMuted },
  footerSpace: { height: spacing.lg },
});
