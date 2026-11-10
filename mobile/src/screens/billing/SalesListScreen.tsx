import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Chip, Text } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import { useT } from '../../i18n';
import ReportPeriodFilter from '../../components/reports/ReportPeriodFilter';
import EmptyState from '../../components/ui/EmptyState';
import ListRow from '../../components/ui/ListRow';
import ScreenSearch from '../../components/ui/ScreenSearch';
import SurfaceCard from '../../components/ui/SurfaceCard';
import {
  rangeForPeriod,
  shiftAnchor,
  type PeriodMode,
} from '../../reports/reportDates';
import { fetchBills } from '../../services/businessService';
import { apiError } from '../../utils/apiError';
import { getBillStatus, canProcessReturn } from '../../utils/billStatus';
import { formatBillListDate, getCreatedAt } from '../../utils/formatDate';
import { colors } from '../../theme/colors';
import { common, spacing, typography } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'SalesList'>;

type Bill = {
  id: string;
  bill_number: string;
  total_amount: number;
  status: string;
  is_returnable?: boolean;
  created_at?: string;
  createdAt?: string;
  items?: Array<{
    quantity?: string | number;
    returned_quantity?: string | number;
    returnedQuantity?: string | number;
  }>;
};

const STATUS_FILTERS = ['all', 'completed', 'partially_returned', 'fully_returned', 'void'] as const;

export default function SalesListScreen({ navigation }: Props) {
  const t = useT();
  const [bills, setBills] = useState<Bill[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('all');
  const [periodMode, setPeriodMode] = useState<PeriodMode>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const skipNextFocus = useRef(true);

  const range = useMemo(() => rangeForPeriod(periodMode, anchor), [periodMode, anchor]);

  const load = useCallback(async (query = '') => {
    try {
      const result = await fetchBills(1, {
        limit: 500,
        search: query.trim() || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
        from: range.from,
        to: range.to,
      });
      setBills(result?.items || []);
    } catch (err) {
      setBills([]);
      Alert.alert(t('Load failed'), apiError(err, 'Could not load sales'));
    }
  }, [statusFilter, range.from, range.to, t]);

  React.useEffect(() => {
    setLoading(true);
    const run = () => load(search).finally(() => setLoading(false));
    if (!search.trim()) {
      run();
      return;
    }
    const timer = setTimeout(run, 280);
    return () => clearTimeout(timer);
  }, [load, search]);

  useFocusEffect(
    useCallback(() => {
      if (skipNextFocus.current) {
        skipNextFocus.current = false;
        return;
      }
      load(search);
    }, [load, search]),
  );

  const stats = useMemo(() => {
    const total = bills.reduce((s, b) => s + parseFloat(String(b.total_amount)), 0);
    return { count: bills.length, total };
  }, [bills]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load(search);
    setRefreshing(false);
  };

  const emptyTitle = search || statusFilter !== 'all'
    ? t('No matching bills')
    : t('No sales in this period');

  return (
    <View style={common.screen}>
      <View style={styles.header}>
        <ReportPeriodFilter
          mode={periodMode}
          anchor={anchor}
          onModeChange={setPeriodMode}
          onAnchorChange={setAnchor}
          onShift={(delta) => setAnchor((prev) => shiftAnchor(periodMode, prev, delta))}
        />
        <ScreenSearch value={search} onChangeText={setSearch} placeholder={t('Search bill number...')} embedded />
        <View style={styles.statRow}>
          <SurfaceCard style={styles.statCard} padding>
            <Text style={styles.statNum}>{stats.count}</Text>
            <Text style={styles.statLbl}>{t('Bills')}</Text>
          </SurfaceCard>
          <SurfaceCard style={styles.statCard} padding>
            <Text style={[styles.statNum, { color: colors.secondary }]}>₹{stats.total.toFixed(0)}</Text>
            <Text style={styles.statLbl}>{t('Revenue')}</Text>
          </SurfaceCard>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          style={styles.chipsScroll}>
          {STATUS_FILTERS.map((s) => (
            <Chip
              key={s}
              selected={statusFilter === s}
              onPress={() => setStatusFilter(s)}
              style={styles.chip}
              compact
              showSelectedOverlay>
              {s === 'all' ? t('All') : getBillStatus(s).label}
            </Chip>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={bills}
        keyExtractor={(i) => i.id}
        contentContainerStyle={bills.length ? common.listContent : styles.emptyList}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="receipt-text-outline"
              title={emptyTitle}
              subtitle={t('Try another day, month, or year')}
            />
          )
        }
        renderItem={({ item }) => {
          const st = getBillStatus(item.status);
          return (
            <ListRow
              title={item.bill_number}
              subtitle={formatBillListDate(getCreatedAt(item))}
              icon={st.icon}
              iconColor={st.color}
              iconBg={st.bg}
              badge={{ label: st.label, color: st.color, bg: st.bg }}
              right={`₹${parseFloat(String(item.total_amount)).toFixed(2)}`}
              onPress={() => navigation.navigate('SaleDetail', { billId: item.id })}
              onLongPress={() => {
                if (!canProcessReturn(item)) return;
                navigation.navigate('Return', { billId: item.id });
              }}
            />
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  statCard: { flex: 1, marginBottom: 0, alignItems: 'center' },
  statNum: { ...typography.h2, fontSize: 20, color: colors.primary },
  statLbl: { ...typography.caption, marginTop: 2 },
  chipsScroll: { marginHorizontal: -spacing.lg },
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  chip: { backgroundColor: colors.surface },
  emptyList: { flexGrow: 1 },
});
