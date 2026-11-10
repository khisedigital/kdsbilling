import React, { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/MainNavigator';
import SurfaceCard from '../components/ui/SurfaceCard';
import { fetchDashboard } from '../services/businessService';
import { paymentLabel, useT } from '../i18n';
import { apiError } from '../utils/apiError';
import { colors } from '../theme/colors';
import { common, radius, spacing, typography } from '../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'Dashboard'>;

interface DashboardData {
  todaySales: number;
  yesterdaySales: number;
  salesDeltaPct: number;
  monthSales: number;
  ordersCount: number;
  yesterdayOrdersCount: number;
  monthOrdersCount: number;
  avgTicket: number;
  todayProfit: number;
  monthProfit: number;
  todayExpenses: number;
  monthExpenses: number;
  heldCount: number;
  customersCount: number;
  returnsToday: number;
  outOfStockCount: number;
  lowStockCount: number;
  lowStock: Array<{
    id?: string;
    sku?: string | null;
    name: string;
    quantity: number;
    reorderLevel: number;
  }>;
  bestSellers: Array<{ product_name: string; totalQty: number; revenue: number }>;
  paymentBreakdown: Array<{ mode: string; amount: number; count: number }>;
  hourlySales: Array<{ hour: number; revenue: number; orders: number }>;
  weekTrend: Array<{ day: string; revenue: number; orders: number }>;
  recentTransactions: Array<{
    id: string;
    bill_number: string;
    total_amount: number;
    created_at?: string;
    customerName?: string | null;
  }>;
}

function money(n: number, compact = false): string {
  const v = Number(n) || 0;
  if (compact && Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (compact && Math.abs(v) >= 1000) return `₹${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return `₹${v.toFixed(0)}`;
}

function StatTile({
  label,
  value,
  icon,
  tint,
  hint,
}: {
  label: string;
  value: string;
  icon: string;
  tint: string;
  hint?: string;
}) {
  return (
    <SurfaceCard style={styles.statTile} padding>
      <View style={[styles.statIcon, { backgroundColor: `${tint}15` }]}>
        <Icon name={icon} size={18} color={tint} />
      </View>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
      {hint ? <Text style={styles.statHint} numberOfLines={1}>{hint}</Text> : null}
    </SurfaceCard>
  );
}

function BarChart({
  values,
  labels,
  maxHeight = 72,
  color = colors.primary,
}: {
  values: number[];
  labels: string[];
  maxHeight?: number;
  color?: string;
}) {
  const max = Math.max(...values, 1);
  return (
    <View style={styles.chartRow}>
      {values.map((v, i) => {
        const h = Math.max(4, Math.round((v / max) * maxHeight));
        return (
          <View key={`${labels[i]}-${i}`} style={styles.chartCol}>
            <View style={[styles.chartBarTrack, { height: maxHeight }]}>
              <View style={[styles.chartBar, { height: h, backgroundColor: color }]} />
            </View>
            <Text style={styles.chartLabel}>{labels[i]}</Text>
          </View>
        );
      })}
    </View>
  );
}

function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={typography.label}>{title}</Text>
      {actionLabel && onAction ? (
        <TouchableOpacity onPress={onAction} hitSlop={8}>
          <Text style={styles.sectionAction}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function QuickAction({
  icon,
  label,
  tint,
  onPress,
}: {
  icon: string;
  label: string;
  tint: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.quickItem} onPress={onPress} activeOpacity={0.85}>
      <View style={[styles.quickIcon, { backgroundColor: `${tint}18` }]}>
        <Icon name={icon} size={22} color={tint} />
      </View>
      <Text style={styles.quickLabel} numberOfLines={2}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function DashboardScreen({ navigation }: Props) {
  const t = useT();
  const [data, setData] = useState<DashboardData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = async () => {
    try {
      setLoadError('');
      setData(await fetchDashboard());
    } catch (err) {
      setLoadError(apiError(err, t('Could not load dashboard')));
      setData(null);
    }
  };

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, []),
  );

  const weekLabels = useMemo(() => {
    if (!data?.weekTrend?.length) return [];
    return data.weekTrend.map((d) => {
      const dt = new Date(`${d.day}T12:00:00`);
      return dt.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2);
    });
  }, [data?.weekTrend]);

  const hourLabels = useMemo(() => {
    if (!data?.hourlySales?.length) return [];
    return data.hourlySales.map((h) => (h.hour % 2 === 0 ? String(h.hour) : ''));
  }, [data?.hourlySales]);

  const payTotal = data?.paymentBreakdown?.reduce((s, p) => s + (p.amount || 0), 0) || 0;
  const deltaUp = (data?.salesDeltaPct || 0) >= 0;
  const deltaColor = deltaUp ? colors.success : colors.error;

  return (
    <View style={common.screen}>
      <ScrollView
        contentContainerStyle={common.screenPad}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            colors={[colors.primary]}
          />
        }>
        {data ? (
        <View style={styles.welcome}>
          <View style={styles.welcomeTop}>
            <View style={styles.welcomeBody}>
              <Text style={styles.heroLabel}>{t("Today's sales")}</Text>
              <Text style={styles.heroValue}>{money(data.todaySales)}</Text>
              <View style={styles.deltaRow}>
                <View style={[styles.deltaBadge, { backgroundColor: `${deltaColor}22` }]}>
                  <Icon name={deltaUp ? 'trending-up' : 'trending-down'} size={14} color={deltaColor} />
                  <Text style={[styles.deltaText, { color: deltaColor }]}>
                    {Math.abs(data.salesDeltaPct).toFixed(1)}%
                  </Text>
                </View>
                <Text style={styles.deltaHint}>
                  {t('vs yesterday')} · {money(data.yesterdaySales, true)}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.refreshChip}
              onPress={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}>
              <Icon name="refresh" size={18} color={colors.textOnPrimary} />
            </TouchableOpacity>
          </View>
        </View>
        ) : null}

        {loadError ? (
          <SurfaceCard padding style={styles.block}>
            <Text style={styles.alertTitle}>{loadError}</Text>
            <Button mode="text" onPress={load} textColor={colors.primary}>{t('Retry')}</Button>
          </SurfaceCard>
        ) : null}

        <View style={styles.quickRow}>
          <QuickAction
            icon="point-of-sale"
            label={t('New Bill')}
            tint={colors.secondary}
            onPress={() => navigation.navigate('Billing', { fresh: true })}
          />
          <QuickAction
            icon="pause-circle-outline"
            label={t('Held bills')}
            tint={colors.accent}
            onPress={() => navigation.navigate('HeldBills')}
          />
          <QuickAction
            icon="cash-minus"
            label={t('Expenses')}
            tint={colors.error}
            onPress={() => navigation.navigate('Expenses')}
          />
          <QuickAction
            icon="chart-box-outline"
            label={t('Reports')}
            tint={colors.primary}
            onPress={() => navigation.navigate('Reports')}
          />
          <QuickAction
            icon="calculator-variant-outline"
            label={t('Close register')}
            tint={colors.success}
            onPress={() => navigation.navigate('DailyClosing')}
          />
        </View>

        {data ? (
          <View style={styles.statsGrid}>
            <StatTile
              label={t('Orders today')}
              value={String(data.ordersCount)}
              icon="receipt"
              tint={colors.accent}
              hint={t('Yesterday: {{count}}', { count: data.yesterdayOrdersCount })}
            />
            <StatTile
              label={t('Avg. ticket')}
              value={money(data.avgTicket)}
              icon="ticket-percent-outline"
              tint={colors.secondary}
              hint={t('This month: {{count}} bills', { count: data.monthOrdersCount })}
            />
            <StatTile
              label={t("Today's profit")}
              value={money(data.todayProfit)}
              icon="trending-up"
              tint={colors.success}
              hint={t('Month {{amount}}', { amount: money(data.monthProfit, true) })}
            />
            <StatTile
              label={t("Today's expenses")}
              value={money(data.todayExpenses)}
              icon="cash-remove"
              tint={colors.error}
              hint={t('Month {{amount}}', { amount: money(data.monthExpenses, true) })}
            />
          </View>
        ) : null}

        {data ? (
          <View style={styles.kpiRow}>
            <SurfaceCard style={styles.kpiChip} padding>
              <Text style={styles.kpiVal}>{money(data.monthSales, true)}</Text>
              <Text style={styles.kpiLabel}>{t('Month sales')}</Text>
            </SurfaceCard>
            <SurfaceCard style={styles.kpiChip} padding>
              <Text style={styles.kpiVal}>{data.heldCount}</Text>
              <Text style={styles.kpiLabel}>{t('Held')}</Text>
            </SurfaceCard>
            <SurfaceCard style={styles.kpiChip} padding>
              <Text style={styles.kpiVal}>{data.customersCount}</Text>
              <Text style={styles.kpiLabel}>{t('Customers')}</Text>
            </SurfaceCard>
            <SurfaceCard style={styles.kpiChip} padding>
              <Text style={[styles.kpiVal, data.returnsToday > 0 && { color: colors.warning }]}>
                {data.returnsToday}
              </Text>
              <Text style={styles.kpiLabel}>{t('Returns')}</Text>
            </SurfaceCard>
          </View>
        ) : null}

        {data?.weekTrend?.length ? (
          <>
            <SectionHeader title={t('7-day sales')} actionLabel={t('Reports')} onAction={() => navigation.navigate('Reports')} />
            <SurfaceCard padding style={styles.block}>
              <BarChart
                values={data.weekTrend.map((d) => d.revenue)}
                labels={weekLabels}
                color={colors.primary}
              />
              <Text style={styles.chartCaption}>
                {t('Peak day {{amount}}', {
                  amount: money(Math.max(...data.weekTrend.map((d) => d.revenue), 0), true),
                })}
              </Text>
            </SurfaceCard>
          </>
        ) : null}

        {data?.hourlySales?.length ? (
          <>
            <SectionHeader title={t("Today's hourly sales")} />
            <SurfaceCard padding style={styles.block}>
              <BarChart
                values={data.hourlySales.map((h) => h.revenue)}
                labels={hourLabels}
                maxHeight={56}
                color={colors.secondary}
              />
            </SurfaceCard>
          </>
        ) : null}

        {data?.paymentBreakdown?.length ? (
          <>
            <SectionHeader title={t('Payments today')} />
            <SurfaceCard padding style={styles.block}>
              {data.paymentBreakdown.map((p, i) => {
                const pct = payTotal > 0 ? (p.amount / payTotal) * 100 : 0;
                return (
                  <View key={p.mode} style={[styles.payRow, i > 0 && styles.rowBorder]}>
                    <View style={styles.payLeft}>
                      <Text style={styles.payMode}>{paymentLabel(p.mode, t)}</Text>
                      <Text style={styles.payMeta}>{t('{{count}} payments', { count: p.count })}</Text>
                    </View>
                    <View style={styles.payRight}>
                      <Text style={styles.payAmt}>{money(p.amount)}</Text>
                      <View style={styles.payTrack}>
                        <View style={[styles.payFill, { width: `${Math.max(4, pct)}%` }]} />
                      </View>
                    </View>
                  </View>
                );
              })}
            </SurfaceCard>
          </>
        ) : null}

        {data && (data.lowStockCount > 0 || data.outOfStockCount > 0) ? (
          <SurfaceCard style={styles.block} onPress={() => navigation.navigate('StockList')}>
            <View style={styles.alertRow}>
              <View style={styles.alertIcon}>
                <Icon name="alert-outline" size={22} color={colors.warning} />
              </View>
              <View style={styles.alertBody}>
                <Text style={styles.alertTitle}>
                  {data.lowStockCount > 0
                    ? t('{{count}} items low on stock', { count: data.lowStockCount })
                    : t('{{count}} out of stock · Tap to manage inventory', { count: data.outOfStockCount })}
                </Text>
                <Text style={styles.alertSub}>
                  {data.lowStockCount > 0 && data.outOfStockCount > 0
                    ? t('{{count}} out of stock · Tap to manage inventory', { count: data.outOfStockCount })
                    : t('Tap to view inventory')}
                </Text>
              </View>
              <Icon name="chevron-right" size={22} color={colors.textMuted} />
            </View>
            {data.lowStock?.slice(0, 3).map((item) => (
              <View key={item.id || item.name} style={styles.lowRow}>
                <Text style={styles.lowName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.lowQty}>{item.quantity}</Text>
              </View>
            ))}
          </SurfaceCard>
        ) : null}

        {data?.bestSellers?.length ? (
          <>
            <SectionHeader title={t('Best sellers (month)')} />
            <SurfaceCard padding style={styles.block}>
              {data.bestSellers.map((item, i) => (
                <View key={`${item.product_name}-${i}`} style={[styles.sellerRow, i > 0 && styles.rowBorder]}>
                  <View style={styles.rankBadge}>
                    <Text style={styles.rankText}>{i + 1}</Text>
                  </View>
                  <View style={styles.sellerBody}>
                    <Text style={styles.sellerName} numberOfLines={1}>{item.product_name}</Text>
                    <Text style={styles.sellerMeta}>
                      {t('{{qty}} sold', { qty: Number(item.totalQty).toFixed(0) })}
                    </Text>
                  </View>
                  <Text style={styles.sellerAmt}>{money(item.revenue, true)}</Text>
                </View>
              ))}
            </SurfaceCard>
          </>
        ) : null}

        {data?.recentTransactions?.length ? (
          <>
            <SectionHeader
              title={t('Recent sales')}
              actionLabel={t('View all')}
              onAction={() => navigation.navigate('SalesList')}
            />
            <SurfaceCard padding style={styles.block}>
              {data.recentTransactions.slice(0, 6).map((tx, i) => (
                <TouchableOpacity
                  key={tx.id}
                  style={[styles.txRow, i > 0 && styles.rowBorder]}
                  onPress={() => navigation.navigate('SaleDetail', { billId: tx.id })}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txNo}>{tx.bill_number}</Text>
                    {tx.customerName ? (
                      <Text style={styles.txCustomer} numberOfLines={1}>{tx.customerName}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.txAmt}>{money(Number(tx.total_amount))}</Text>
                </TouchableOpacity>
              ))}
            </SurfaceCard>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  welcome: {
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginBottom: spacing.lg,
  },
  welcomeTop: { flexDirection: 'row', alignItems: 'flex-start' },
  welcomeBody: { flex: 1 },
  refreshChip: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '600', letterSpacing: 0.4 },
  heroValue: { color: colors.textOnPrimary, fontSize: 34, fontWeight: '800', marginTop: 4, letterSpacing: -0.5 },
  deltaRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, gap: spacing.sm },
  deltaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  deltaText: { fontSize: 12, fontWeight: '700' },
  deltaHint: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  quickItem: {
    width: '18%',
    minWidth: 64,
    flexGrow: 1,
    alignItems: 'center',
  },
  quickIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  quickLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.md },
  statTile: { width: '47%', marginBottom: 0 },
  statIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  statLabel: { ...typography.caption },
  statValue: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 2 },
  statHint: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  kpiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  kpiChip: { flexGrow: 1, minWidth: '22%', marginBottom: 0, alignItems: 'center', paddingVertical: spacing.md },
  kpiVal: { fontSize: 16, fontWeight: '700', color: colors.text },
  kpiLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2, textAlign: 'center' },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  sectionAction: { fontSize: 13, fontWeight: '600', color: colors.primary },
  block: { marginBottom: spacing.lg },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 4 },
  chartCol: { flex: 1, alignItems: 'center' },
  chartBarTrack: { width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  chartBar: { width: '70%', maxWidth: 28, borderRadius: 6, minHeight: 4 },
  chartLabel: { fontSize: 10, color: colors.textMuted, marginTop: 6, fontWeight: '600' },
  chartCaption: { ...typography.caption, marginTop: spacing.md },
  payRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  payLeft: { flex: 1 },
  payMode: { fontSize: 14, fontWeight: '600', color: colors.text },
  payMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  payRight: { width: 110, alignItems: 'flex-end' },
  payAmt: { fontSize: 14, fontWeight: '700', color: colors.secondary },
  payTrack: {
    width: '100%',
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceVariant,
    marginTop: 6,
    overflow: 'hidden',
  },
  payFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 2 },
  alertRow: { flexDirection: 'row', alignItems: 'center' },
  alertIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.warningLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  alertBody: { flex: 1 },
  alertTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  alertSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  lowRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
  },
  lowName: { flex: 1, fontSize: 13, color: colors.textSecondary, marginRight: spacing.md },
  lowQty: { fontSize: 13, fontWeight: '700', color: colors.warning },
  sellerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  rankBadge: {
    width: 26,
    height: 26,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  rankText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  sellerBody: { flex: 1 },
  sellerName: { fontSize: 14, fontWeight: '600', color: colors.text },
  sellerMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  sellerAmt: { fontSize: 14, fontWeight: '700', color: colors.secondary },
  txRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm + 2 },
  txNo: { fontSize: 14, fontWeight: '600', color: colors.text },
  txCustomer: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  txAmt: { fontSize: 15, fontWeight: '700', color: colors.secondary },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.borderLight },
});
