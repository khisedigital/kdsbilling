import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import EmptyState from '../../components/ui/EmptyState';
import ListRow from '../../components/ui/ListRow';
import ReportPeriodFilter from '../../components/reports/ReportPeriodFilter';
import ScreenSearch from '../../components/ui/ScreenSearch';
import SurfaceCard from '../../components/ui/SurfaceCard';
import { getReportConfig, type ReportType } from '../../reports/reportConfig';
import { exportReportToExcel } from '../../reports/reportExport';
import {
  periodSummaryLabel,
  rangeForPeriod,
  shiftAnchor,
  type PeriodMode,
} from '../../reports/reportDates';
import {
  fetchBrandSalesReport,
  fetchCashFlowReport,
  fetchCategorySalesReport,
  fetchCustomerReport,
  fetchExpenseReport,
  fetchGstReport,
  fetchLowStockReport,
  fetchProductReport,
  fetchProfitReport,
  fetchPurchaseReport,
  fetchSalesReport,
  fetchStockReport,
  fetchSupplierReport,
} from '../../services/businessService';
import { apiError } from '../../utils/apiError';
import { colors } from '../../theme/colors';
import { common, radius, spacing, typography } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'ReportDetail'>;

function money(value: string | number | undefined | null) {
  return `₹${parseFloat(String(value ?? 0)).toFixed(2)}`;
}

function qty(value: string | number | undefined | null) {
  const n = parseFloat(String(value ?? 0));
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function matchesSearch(query: string, ...parts: Array<string | number | undefined | null>) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return parts.some((p) => String(p ?? '').toLowerCase().includes(q));
}

function usesDateFilter(type: ReportType) {
  return type !== 'stock' && type !== 'low_stock';
}

function hasReportData(data: unknown, type: ReportType) {
  if (!data) return false;
  if (type === 'product_sales') {
    if (Array.isArray(data)) return data.length > 0;
    const report = data as { items?: unknown[]; mostSold?: unknown };
    return (report.items?.length ?? 0) > 0 || !!report.mostSold;
  }
  if (['daily_sales', 'purchase', 'profit', 'expense', 'cash_flow', 'low_stock'].includes(type)) {
    return true;
  }
  return Array.isArray(data) && data.length > 0;
}

async function loadReport(type: ReportType, range: { from?: string; to?: string }) {
  switch (type) {
    case 'daily_sales':
      return fetchSalesReport(range.from, range.to);
    case 'product_sales':
      return fetchProductReport(range);
    case 'category_sales':
      return fetchCategorySalesReport(range);
    case 'brand_sales':
      return fetchBrandSalesReport(range);
    case 'profit':
      return fetchProfitReport(range);
    case 'purchase':
      return fetchPurchaseReport(range);
    case 'stock':
      return fetchStockReport();
    case 'low_stock':
      return fetchLowStockReport();
    case 'customer':
      return fetchCustomerReport(range);
    case 'supplier':
      return fetchSupplierReport(range);
    case 'gst':
      return fetchGstReport(range);
    case 'expense':
      return fetchExpenseReport(range);
    case 'cash_flow':
      return fetchCashFlowReport(range);
    default:
      return null;
  }
}

function SummaryCards({ items }: { items: Array<{ label: string; value: string; color?: string }> }) {
  return (
    <View style={styles.summaryRow}>
      {items.map((item) => (
        <SurfaceCard key={item.label} style={styles.summaryCard} padding>
          <Text style={[styles.summaryValue, item.color ? { color: item.color } : null]}>{item.value}</Text>
          <Text style={styles.summaryLabel}>{item.label}</Text>
        </SurfaceCard>
      ))}
    </View>
  );
}

export default function ReportDetailScreen({ route }: Props) {
  const { reportType } = route.params;
  const config = getReportConfig(reportType);
  const dateFilterEnabled = usesDateFilter(reportType);
  const [periodMode, setPeriodMode] = useState<PeriodMode>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const range = useMemo(
    () => (dateFilterEnabled ? rangeForPeriod(periodMode, anchor) : {}),
    [dateFilterEnabled, periodMode, anchor],
  );
  const [data, setData] = useState<unknown>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await loadReport(reportType, range));
    } catch (err) {
      setError(apiError(err, 'Could not load report'));
      setData(null);
    }
  }, [reportType, range]);

  React.useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const periodLabel = dateFilterEnabled
    ? periodSummaryLabel(periodMode, range as { from: string; to: string })
    : 'Current stock snapshot';

  const handleExport = async () => {
    if (!data || !hasReportData(data, reportType)) {
      Alert.alert('Nothing to export', 'This report has no data yet.');
      return;
    }
    setExporting(true);
    try {
      await exportReportToExcel(reportType, data, periodLabel);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not export report';
      if (!String(message).toLowerCase().includes('cancel')) {
        Alert.alert('Export failed', message);
      }
    } finally {
      setExporting(false);
    }
  };

  const content = useMemo(() => {
    if (!data) return null;
    const q = search;

    switch (reportType) {
      case 'daily_sales': {
        const report = data as {
          bills: Array<{ id?: string; bill_number: string; total_amount: number; created_at: string; customer?: { name?: string } }>;
          topProducts?: Array<{ product_name: string; sku?: string; total_qty: number; revenue: number }>;
          mostSold?: { product_name: string; sku?: string; total_qty: number; revenue: number } | null;
          summary: { count: number; total: number; tax?: number; discount?: number };
        };
        const bills = report.bills.filter((bill) => matchesSearch(q, bill.bill_number, bill.customer?.name));
        const topProducts = (report.topProducts || []).filter((item) => matchesSearch(q, item.product_name, item.sku));
        return (
          <>
            <SummaryCards items={[
              { label: 'Bills', value: String(report.summary.count) },
              { label: 'Revenue', value: money(report.summary.total), color: colors.secondary },
              { label: 'Tax', value: money(report.summary.tax || 0) },
              { label: 'Discount', value: money(report.summary.discount || 0), color: colors.accent },
            ]} />
            {report.mostSold ? (
              <SurfaceCard style={styles.heroCard} padding>
                <Text style={styles.heroEyebrow}>Most sold product</Text>
                <Text style={styles.heroTitle}>{report.mostSold.product_name}</Text>
                <Text style={styles.heroMeta}>
                  Qty {qty(report.mostSold.total_qty)} · {money(report.mostSold.revenue)}
                  {report.mostSold.sku ? ` · ${report.mostSold.sku}` : ''}
                </Text>
              </SurfaceCard>
            ) : null}
            {topProducts.length ? (
              <>
                <Text style={styles.sectionLabel}>Top products</Text>
                {topProducts.map((item, index) => (
                  <ListRow
                    key={`${item.product_name}-${index}`}
                    title={item.product_name}
                    subtitle={`#${index + 1} · Qty ${qty(item.total_qty)}`}
                    icon={index === 0 ? 'trophy' : 'package-variant'}
                    iconColor={index === 0 ? colors.accent : colors.primary}
                    iconBg={index === 0 ? colors.accentLight : colors.primaryLight}
                    right={money(item.revenue)}
                    showChevron={false}
                    style={styles.row}
                  />
                ))}
              </>
            ) : null}
            <Text style={styles.sectionLabel}>Bills</Text>
            {bills.map((bill) => (
              <ListRow
                key={bill.id || bill.bill_number}
                title={bill.bill_number}
                subtitle={[bill.customer?.name, new Date(bill.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · ')}
                icon="receipt"
                right={money(bill.total_amount)}
                showChevron={false}
                style={styles.row}
              />
            ))}
            {q.trim() && !bills.length && !topProducts.length ? <Text style={styles.emptyFilter}>No matching rows</Text> : null}
          </>
        );
      }
      case 'product_sales': {
        const report = data as {
          items: Array<{ product_name: string; sku?: string; total_qty: number; revenue: number; profit?: number }>;
          mostSold?: { product_name: string; total_qty: number; revenue: number } | null;
          summary?: { products: number; totalQty: number; revenue: number };
        };
        // Back-compat if API still returns a bare array
        const rawItems = Array.isArray(data)
          ? (data as Array<{ product_name: string; sku?: string; total_qty: number; revenue: number; profit?: number }>)
          : report.items || [];
        const items = rawItems.filter((item) => matchesSearch(q, item.product_name, item.sku));
        const mostSold = Array.isArray(data) ? rawItems[0] : report.mostSold;
        return (
          <>
            {report.summary ? (
              <SummaryCards items={[
                { label: 'Products', value: String(report.summary.products) },
                { label: 'Qty sold', value: qty(report.summary.totalQty) },
                { label: 'Revenue', value: money(report.summary.revenue), color: colors.secondary },
              ]} />
            ) : null}
            {mostSold ? (
              <SurfaceCard style={styles.heroCard} padding>
                <Text style={styles.heroEyebrow}>Most sold</Text>
                <Text style={styles.heroTitle}>{mostSold.product_name}</Text>
                <Text style={styles.heroMeta}>
                  Qty {qty(mostSold.total_qty)} · {money(mostSold.revenue)}
                </Text>
              </SurfaceCard>
            ) : null}
            {items.map((item, index) => (
              <ListRow
                key={`${item.product_name}-${index}`}
                title={item.product_name}
                subtitle={`#${index + 1} · Qty ${qty(item.total_qty)}${item.sku ? ` · ${item.sku}` : ''}`}
                icon={index === 0 ? 'trophy' : 'package-variant'}
                iconColor={index === 0 ? colors.accent : colors.primary}
                iconBg={index === 0 ? colors.accentLight : colors.primaryLight}
                right={money(item.revenue)}
                showChevron={false}
                style={styles.row}
              />
            ))}
            {q.trim() && !items.length ? <Text style={styles.emptyFilter}>No matching rows</Text> : null}
          </>
        );
      }
      case 'category_sales': {
        const items = (data as Array<{ category_name: string; total_qty: number; revenue: number }>)
          .filter((item) => matchesSearch(q, item.category_name));
        if (q.trim() && !items.length) return <Text style={styles.emptyFilter}>No matching rows</Text>;
        return items.map((item) => (
          <ListRow
            key={item.category_name}
            title={item.category_name}
            subtitle={`Qty ${qty(item.total_qty)}`}
            icon="folder-outline"
            right={money(item.revenue)}
            showChevron={false}
            style={styles.row}
          />
        ));
      }
      case 'brand_sales': {
        const items = (data as Array<{ brand_name: string; total_qty: number; revenue: number }>)
          .filter((item) => matchesSearch(q, item.brand_name));
        if (q.trim() && !items.length) return <Text style={styles.emptyFilter}>No matching rows</Text>;
        return items.map((item) => (
          <ListRow
            key={item.brand_name}
            title={item.brand_name}
            subtitle={`Qty ${qty(item.total_qty)}`}
            icon="tag-outline"
            right={money(item.revenue)}
            showChevron={false}
            style={styles.row}
          />
        ));
      }
      case 'profit': {
        const report = data as {
          summary: { revenue: number; cost: number; grossProfit: number; expenses: number; netProfit: number; taxCollected?: number };
          items: Array<{ product_name: string; profit: number; revenue: number; cost?: number; total_qty?: number }>;
        };
        const items = report.items.filter((item) => matchesSearch(q, item.product_name));
        const net = report.summary.netProfit;
        return (
          <>
            <SummaryCards items={[
              { label: 'Revenue', value: money(report.summary.revenue), color: colors.secondary },
              { label: 'Cost', value: money(report.summary.cost), color: colors.accent },
              { label: 'Gross profit', value: money(report.summary.grossProfit), color: colors.primary },
              { label: 'Expenses', value: money(report.summary.expenses), color: colors.error },
            ]} />
            <SurfaceCard style={[styles.heroCard, net >= 0 ? styles.profitHero : styles.lossHero]} padding>
              <Text style={styles.heroEyebrow}>{net >= 0 ? 'Net profit' : 'Net loss'}</Text>
              <Text style={[styles.heroTitle, { color: net >= 0 ? colors.success : colors.error }]}>
                {money(Math.abs(net))}
              </Text>
              <Text style={styles.heroMeta}>
                Revenue {money(report.summary.revenue)} − Cost {money(report.summary.cost)} − Expenses {money(report.summary.expenses)}
              </Text>
            </SurfaceCard>
            <Text style={styles.sectionLabel}>Profit by product</Text>
            {items.map((item, index) => (
              <ListRow
                key={`${item.product_name}-${index}`}
                title={item.product_name}
                subtitle={`Sales ${money(item.revenue)}${item.cost != null ? ` · Cost ${money(item.cost)}` : ''}`}
                icon="chart-line"
                right={money(item.profit)}
                showChevron={false}
                style={styles.row}
              />
            ))}
            {q.trim() && !items.length ? <Text style={styles.emptyFilter}>No matching rows</Text> : null}
          </>
        );
      }
      case 'purchase': {
        const report = data as { bills: Array<{ id: string; bill_number: string; bill_date: string; total_amount: number; supplier?: { name?: string } }>; summary: { count: number; total: number } };
        const bills = report.bills.filter((bill) => matchesSearch(q, bill.bill_number, bill.supplier?.name, bill.bill_date));
        return (
          <>
            <SummaryCards items={[
              { label: 'Bills', value: String(report.summary.count) },
              { label: 'Purchases', value: money(report.summary.total), color: colors.secondary },
            ]} />
            {bills.map((bill) => (
              <ListRow
                key={bill.id}
                title={bill.bill_number}
                subtitle={`${bill.supplier?.name || 'Supplier'} · ${bill.bill_date}`}
                icon="truck-check"
                right={money(bill.total_amount)}
                showChevron={false}
                style={styles.row}
              />
            ))}
            {q.trim() && !bills.length ? <Text style={styles.emptyFilter}>No matching rows</Text> : null}
          </>
        );
      }
      case 'stock': {
        const items = (data as Array<{
          id: string;
          quantity: number;
          variant?: { sku?: string; size?: string; color?: string; product?: { name?: string }; uom?: { code?: string } };
        }>)
          .filter((item) => matchesSearch(q, item.variant?.product?.name, item.variant?.sku, item.variant?.size));
        if (q.trim() && !items.length) return <Text style={styles.emptyFilter}>No matching rows</Text>;
        if (!items.length) return <EmptyState icon="warehouse" title="No stock rows" subtitle="Add products and stock to see them here" />;
        return (
          <>
            <SummaryCards items={[{ label: 'Items', value: String(items.length) }]} />
            {items.map((item) => {
              const size = [item.variant?.size, item.variant?.color].filter(Boolean).join(' · ');
              return (
                <ListRow
                  key={item.id}
                  title={item.variant?.product?.name || 'Unknown'}
                  subtitle={[item.variant?.sku, size].filter(Boolean).join(' · ') || undefined}
                  icon="warehouse"
                  right={`${qty(item.quantity)} ${item.variant?.uom?.code || ''}`.trim()}
                  showChevron={false}
                  style={styles.row}
                />
              );
            })}
          </>
        );
      }
      case 'low_stock': {
        const report = data as {
          items: Array<{
            id: string;
            quantity: number;
            reorder_level: number;
            variant?: { sku?: string; size?: string; color?: string; product?: { name?: string }; uom?: { code?: string } };
          }>;
          summary: { count: number };
        };
        const items = report.items.filter((item) => matchesSearch(q, item.variant?.product?.name, item.variant?.sku, item.variant?.size));
        return (
          <>
            <SummaryCards items={[{ label: 'Low items', value: String(report.summary.count), color: colors.error }]} />
            {items.map((item) => {
              const size = [item.variant?.size, item.variant?.color].filter(Boolean).join(' · ');
              const reorderLabel = item.reorder_level > 0
                ? `Reorder ${qty(item.reorder_level)}`
                : 'Out of stock';
              return (
                <ListRow
                  key={item.id}
                  title={item.variant?.product?.name || 'Unknown'}
                  subtitle={[item.variant?.sku, size, reorderLabel].filter(Boolean).join(' · ')}
                  icon="alert-outline"
                  iconColor={colors.error}
                  iconBg={colors.errorLight}
                  right={`${qty(item.quantity)} ${item.variant?.uom?.code || ''}`.trim()}
                  showChevron={false}
                  style={styles.row}
                />
              );
            })}
            {q.trim() && !items.length ? <Text style={styles.emptyFilter}>No matching rows</Text> : null}
          </>
        );
      }
      case 'customer': {
        const items = (data as Array<{ id: string; name: string; phone?: string; order_count: number; total_spent: number }>)
          .filter((item) => matchesSearch(q, item.name, item.phone));
        if (q.trim() && !items.length) return <Text style={styles.emptyFilter}>No matching rows</Text>;
        return items.map((item) => (
          <ListRow
            key={item.id}
            title={item.name}
            subtitle={[item.phone, `${item.order_count} orders`].filter(Boolean).join(' · ')}
            icon="account-circle"
            right={money(item.total_spent)}
            showChevron={false}
            style={styles.row}
          />
        ));
      }
      case 'supplier': {
        const items = (data as Array<{ id: string; name: string; phone?: string; bill_count: number; total_purchased: number }>)
          .filter((item) => matchesSearch(q, item.name, item.phone));
        if (q.trim() && !items.length) return <Text style={styles.emptyFilter}>No matching rows</Text>;
        return items.map((item) => (
          <ListRow
            key={item.id}
            title={item.name}
            subtitle={[item.phone, `${item.bill_count} bills`].filter(Boolean).join(' · ')}
            icon="truck"
            right={money(item.total_purchased)}
            showChevron={false}
            style={styles.row}
          />
        ));
      }
      case 'gst': {
        const items = (data as Array<{ tax_name: string; totalTax: number }>)
          .filter((item) => matchesSearch(q, item.tax_name));
        if (q.trim() && !items.length) return <Text style={styles.emptyFilter}>No matching rows</Text>;
        return items.map((item, index) => (
          <ListRow
            key={`${item.tax_name}-${index}`}
            title={item.tax_name}
            icon="percent"
            right={money(item.totalTax)}
            showChevron={false}
            style={styles.row}
          />
        ));
      }
      case 'expense': {
        const report = data as { expenses: Array<{ id: string; expense_date: string; amount: number; category?: { name?: string } }>; total: number };
        const expenses = report.expenses.filter((item) => matchesSearch(q, item.category?.name, item.expense_date));
        return (
          <>
            <SummaryCards items={[{ label: 'Total expenses', value: money(report.total), color: colors.error }]} />
            {expenses.map((item) => (
              <ListRow
                key={item.id}
                title={item.category?.name || 'Expense'}
                subtitle={item.expense_date}
                icon="cash-minus"
                right={money(item.amount)}
                showChevron={false}
                style={styles.row}
              />
            ))}
            {q.trim() && !expenses.length ? <Text style={styles.emptyFilter}>No matching rows</Text> : null}
          </>
        );
      }
      case 'cash_flow': {
        const report = data as {
          summary: { cashIn: number; cashOut: number; netFlow: number; expenses: number; purchases: number };
          inflows: Array<{ payment_mode: string; total: number }>;
        };
        const inflows = report.inflows.filter((item) => matchesSearch(q, item.payment_mode));
        return (
          <>
            <SummaryCards items={[
              { label: 'Cash in', value: money(report.summary.cashIn), color: colors.secondary },
              { label: 'Cash out', value: money(report.summary.cashOut), color: colors.error },
              { label: 'Net flow', value: money(report.summary.netFlow), color: report.summary.netFlow >= 0 ? colors.success : colors.error },
            ]} />
            <Text style={styles.sectionTitle}>Payment modes</Text>
            {inflows.map((item) => (
              <ListRow
                key={item.payment_mode}
                title={item.payment_mode.toUpperCase()}
                icon="cash"
                right={money(item.total)}
                showChevron={false}
                style={styles.row}
              />
            ))}
            {q.trim() && !inflows.length ? <Text style={styles.emptyFilter}>No matching rows</Text> : null}
          </>
        );
      }
      default:
        return null;
    }
  }, [data, reportType, search]);

  const hasRows = hasReportData(data, reportType);

  if (loading) {
    return (
      <View style={[common.screen, styles.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={common.screen}>
        <EmptyState icon="alert-circle-outline" title="Report unavailable" subtitle={error} />
      </View>
    );
  }

  return (
    <ScrollView
      style={common.screen}
      contentContainerStyle={common.screenPad}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}>
      <Text style={styles.title}>{config?.title || 'Report'}</Text>
      <Text style={styles.subtitle}>{config?.subtitle}</Text>

      {dateFilterEnabled ? (
        <ReportPeriodFilter
          mode={periodMode}
          anchor={anchor}
          onModeChange={(mode) => {
            setPeriodMode(mode);
            setAnchor(new Date());
          }}
          onAnchorChange={setAnchor}
          onShift={(delta) => setAnchor((prev) => shiftAnchor(periodMode, prev, delta))}
        />
      ) : null}

      <Text style={styles.period}>{periodLabel}</Text>

      <Button
        mode="contained"
        icon="microsoft-excel"
        onPress={handleExport}
        loading={exporting}
        disabled={exporting || !hasRows}
        style={styles.exportBtn}
        contentStyle={styles.exportBtnContent}>
        Export Excel
      </Button>

      {hasRows ? (
        <>
          <ScreenSearch value={search} onChangeText={setSearch} placeholder="Search report rows..." embedded />
          {content}
        </>
      ) : (
        <EmptyState icon={config?.icon || 'chart-box-outline'} title="No data yet" subtitle="Transactions will appear here once available" />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h1, fontSize: 22 },
  subtitle: { ...typography.bodySm, marginTop: spacing.xs },
  period: { ...typography.caption, marginTop: spacing.sm, marginBottom: spacing.md },
  exportBtn: { borderRadius: radius.md, marginBottom: spacing.lg, backgroundColor: colors.success },
  exportBtnContent: { minHeight: 46 },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  summaryCard: { flexGrow: 1, minWidth: '30%', marginBottom: 0, alignItems: 'center' },
  summaryValue: { ...typography.h2, fontSize: 18, color: colors.primary },
  summaryLabel: { ...typography.caption, marginTop: 2 },
  sectionTitle: { ...typography.label, marginBottom: spacing.sm },
  sectionLabel: { ...typography.label, marginTop: spacing.md, marginBottom: spacing.sm },
  heroCard: {
    marginBottom: spacing.lg,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  profitHero: { backgroundColor: colors.successLight },
  lossHero: { backgroundColor: colors.errorLight },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  heroMeta: {
    marginTop: spacing.xs,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  row: { marginBottom: spacing.sm, borderRadius: radius.md },
  emptyFilter: { ...typography.bodySm, textAlign: 'center', marginVertical: spacing.lg },
});
