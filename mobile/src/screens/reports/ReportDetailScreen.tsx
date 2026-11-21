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
import { useT } from '../../i18n';
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
  if (Array.isArray(data)) return data.length > 0;
  if (typeof data === 'object') {
    const obj = data as Record<string, any>;
    if (Array.isArray(obj.items)) return obj.items.length > 0 || !!obj.mostSold;
    if (Array.isArray(obj.bills)) return obj.bills.length > 0;
    if (Array.isArray(obj.expenses)) return obj.expenses.length > 0;
    if (Array.isArray(obj.inflows)) return obj.inflows.length > 0;
    if (obj.summary) return true;
    if (['daily_sales', 'purchase', 'profit', 'expense', 'cash_flow', 'low_stock'].includes(type)) return true;
  }
  return false;
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
  const t = useT();
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
      setError(apiError(err, t('Could not load report')));
      setData(null);
    }
  }, [reportType, range, t]);

  React.useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const periodRange = range as { from?: string; to?: string };
  const periodLabel = !dateFilterEnabled
    ? t('Current stock snapshot')
    : periodMode === 'day'
      ? t('Day · {{from}}', { from: periodRange.from || '' })
      : periodMode === 'month'
        ? t('Month · {{from}} to {{to}}', { from: periodRange.from || '', to: periodRange.to || '' })
        : t('Year · {{from}} to {{to}}', { from: periodRange.from || '', to: periodRange.to || '' });

  const handleExport = async () => {
    if (!data || !hasReportData(data, reportType)) {
      Alert.alert(t('Nothing to export'), t('This report has no data yet.'));
      return;
    }
    setExporting(true);
    try {
      await exportReportToExcel(reportType, data, periodLabel);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not export report';
      if (!String(message).toLowerCase().includes('cancel')) {
        Alert.alert(t('Export failed'), t(message));
      }
    } finally {
      setExporting(false);
    }
  };

  const content = useMemo(() => {
    if (!data) return null;
    const q = search;

    try {
      switch (reportType) {
      case 'daily_sales': {
        const report = (data || {}) as {
          bills?: Array<{ id?: string; bill_number: string; total_amount: number; created_at: string; customer?: { name?: string } }>;
          topProducts?: Array<{ product_name: string; sku?: string; total_qty: number; revenue: number }>;
          mostSold?: { product_name: string; sku?: string; total_qty: number; revenue: number } | null;
          summary?: { count: number; total: number; tax?: number; discount?: number };
        };
        const rawBills = Array.isArray(report.bills) ? report.bills : [];
        const bills = rawBills.filter((bill) => matchesSearch(q, bill.bill_number, bill.customer?.name));
        const rawTop = Array.isArray(report.topProducts) ? report.topProducts : [];
        const topProducts = rawTop.filter((item) => matchesSearch(q, item.product_name, item.sku));
        const summary = report.summary || {
          count: rawBills.length,
          total: (report as any).revenue || 0,
          tax: (report as any).tax || 0,
          discount: (report as any).discount || 0,
        };
        const mostSold = report.mostSold || topProducts[0] || null;
        return (
          <>
            <SummaryCards items={[
              { label: t('Bills'), value: String(summary.count) },
              { label: t('Revenue'), value: money(summary.total), color: colors.secondary },
              { label: t('Tax'), value: money(summary.tax || 0) },
              { label: t('Discount'), value: money(summary.discount || 0), color: colors.accent },
            ]} />
            {mostSold ? (
              <SurfaceCard style={styles.heroCard} padding>
                <Text style={styles.heroEyebrow}>{t('Most sold product')}</Text>
                <Text style={styles.heroTitle}>{mostSold.product_name}</Text>
                <Text style={styles.heroMeta}>
                  {t('Qty {{qty}}', { qty: qty(mostSold.total_qty) })} · {money(mostSold.revenue)}
                  {mostSold.sku ? ` · ${mostSold.sku}` : ''}
                </Text>
              </SurfaceCard>
            ) : null}
            {topProducts.length ? (
              <>
                <Text style={styles.sectionLabel}>{t('Top products')}</Text>
                {topProducts.map((item, index) => (
                  <ListRow
                    key={`${item.product_name}-${index}`}
                    title={item.product_name}
                    subtitle={t('#{{rank}} · Qty {{qty}}', { rank: index + 1, qty: qty(item.total_qty) })}
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
            <Text style={styles.sectionLabel}>{t('Bills')}</Text>
            {bills.map((bill) => (
              <ListRow
                key={bill.id || bill.bill_number}
                title={bill.bill_number}
                subtitle={[bill.customer?.name, bill.created_at ? new Date(bill.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''].filter(Boolean).join(' · ')}
                icon="receipt"
                right={money(bill.total_amount)}
                showChevron={false}
                style={styles.row}
              />
            ))}
            {q.trim() && !bills.length && !topProducts.length ? <Text style={styles.emptyFilter}>{t('No matching rows')}</Text> : null}
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
                { label: t('Products'), value: String(report.summary.products) },
                { label: t('Qty sold'), value: qty(report.summary.totalQty) },
                { label: t('Revenue'), value: money(report.summary.revenue), color: colors.secondary },
              ]} />
            ) : null}
            {mostSold ? (
              <SurfaceCard style={styles.heroCard} padding>
                <Text style={styles.heroEyebrow}>{t('Most sold')}</Text>
                <Text style={styles.heroTitle}>{mostSold.product_name}</Text>
                <Text style={styles.heroMeta}>
                  {t('Qty {{qty}}', { qty: qty(mostSold.total_qty) })} · {money(mostSold.revenue)}
                </Text>
              </SurfaceCard>
            ) : null}
            {items.map((item, index) => (
              <ListRow
                key={`${item.product_name}-${index}`}
                title={item.product_name}
                subtitle={item.sku
                  ? t('#{{rank}} · Qty {{qty}} · {{sku}}', { rank: index + 1, qty: qty(item.total_qty), sku: item.sku })
                  : t('#{{rank}} · Qty {{qty}}', { rank: index + 1, qty: qty(item.total_qty) })}
                icon={index === 0 ? 'trophy' : 'package-variant'}
                iconColor={index === 0 ? colors.accent : colors.primary}
                iconBg={index === 0 ? colors.accentLight : colors.primaryLight}
                right={money(item.revenue)}
                showChevron={false}
                style={styles.row}
              />
            ))}
            {q.trim() && !items.length ? <Text style={styles.emptyFilter}>{t('No matching rows')}</Text> : null}
          </>
        );
      }
      case 'category_sales': {
        const items = (data as Array<{ category_name: string; total_qty: number; revenue: number }>)
          .filter((item) => matchesSearch(q, item.category_name));
        if (q.trim() && !items.length) return <Text style={styles.emptyFilter}>{t('No matching rows')}</Text>;
        return items.map((item) => (
          <ListRow
            key={item.category_name}
            title={item.category_name}
            subtitle={t('Qty {{qty}}', { qty: qty(item.total_qty) })}
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
        if (q.trim() && !items.length) return <Text style={styles.emptyFilter}>{t('No matching rows')}</Text>;
        return items.map((item) => (
          <ListRow
            key={item.brand_name}
            title={item.brand_name}
            subtitle={t('Qty {{qty}}', { qty: qty(item.total_qty) })}
            icon="tag-outline"
            right={money(item.revenue)}
            showChevron={false}
            style={styles.row}
          />
        ));
      }
      case 'profit': {
        const report = (data || {}) as {
          summary?: { revenue: number; cost: number; grossProfit: number; expenses: number; netProfit: number; taxCollected?: number };
          items?: Array<{ product_name?: string; name?: string; profit: number; revenue: number; cost?: number; total_qty?: number }>;
        };
        const summary = report.summary || {
          revenue: (report as any).revenue || 0,
          cost: (report as any).cost || 0,
          grossProfit: (report as any).grossProfit || 0,
          expenses: (report as any).expenses || 0,
          netProfit: (report as any).netProfit ?? (report as any).profit ?? 0,
        };
        const rawItems = Array.isArray(report.items) ? report.items : [];
        const items = rawItems
          .map((i) => ({
            ...i,
            product_name: i.product_name || i.name || t('Unknown product'),
          }))
          .filter((item) => matchesSearch(q, item.product_name));
        const net = summary.netProfit;
        return (
          <>
            <SummaryCards items={[
              { label: t('Revenue'), value: money(summary.revenue), color: colors.secondary },
              { label: t('Cost'), value: money(summary.cost), color: colors.accent },
              { label: t('Gross profit'), value: money(summary.grossProfit), color: colors.primary },
              { label: t('Expenses'), value: money(summary.expenses), color: colors.error },
            ]} />
            <SurfaceCard style={[styles.heroCard, net >= 0 ? styles.profitHero : styles.lossHero]} padding>
              <Text style={styles.heroEyebrow}>{net >= 0 ? t('Net profit') : t('Net loss')}</Text>
              <Text style={[styles.heroTitle, { color: net >= 0 ? colors.success : colors.error }]}>
                {money(Math.abs(net))}
              </Text>
              <Text style={styles.heroMeta}>
                {t('Revenue {{revenue}} − Cost {{cost}} − Expenses {{expenses}}', {
                  revenue: money(summary.revenue),
                  cost: money(summary.cost),
                  expenses: money(summary.expenses),
                })}
              </Text>
            </SurfaceCard>
            <Text style={styles.sectionLabel}>{t('Profit by product')}</Text>
            {items.map((item, index) => (
              <ListRow
                key={`${item.product_name}-${index}`}
                title={item.product_name}
                subtitle={item.cost != null
                  ? t('Sales {{sales}} · Cost {{cost}}', { sales: money(item.revenue), cost: money(item.cost) })
                  : t('Sales {{sales}}', { sales: money(item.revenue) })}
                icon="chart-line"
                right={money(item.profit)}
                showChevron={false}
                style={styles.row}
              />
            ))}
            {q.trim() && !items.length ? <Text style={styles.emptyFilter}>{t('No matching rows')}</Text> : null}
          </>
        );
      }
      case 'purchase': {
        const report = (data || {}) as {
          bills?: Array<{ id: string; bill_number: string; bill_date: string; total_amount: number; supplier?: { name?: string } }>;
          summary?: { count: number; total: number };
        };
        const rawBills = Array.isArray(report.bills) ? report.bills : [];
        const bills = rawBills.filter((bill) => matchesSearch(q, bill.bill_number, bill.supplier?.name, bill.bill_date));
        const summary = report.summary || {
          count: rawBills.length,
          total: rawBills.reduce((s, b) => s + (b.total_amount || 0), 0),
        };
        return (
          <>
            <SummaryCards items={[
              { label: t('Bills'), value: String(summary.count) },
              { label: t('Purchases'), value: money(summary.total), color: colors.secondary },
            ]} />
            {bills.map((bill) => (
              <ListRow
                key={bill.id}
                title={bill.bill_number}
                subtitle={`${bill.supplier?.name || t('Supplier')} · ${bill.bill_date}`}
                icon="truck-check"
                right={money(bill.total_amount)}
                showChevron={false}
                style={styles.row}
              />
            ))}
            {q.trim() && !bills.length ? <Text style={styles.emptyFilter}>{t('No matching rows')}</Text> : null}
          </>
        );
      }
      case 'stock': {
        const raw = Array.isArray(data) ? data : Array.isArray((data as any)?.items) ? (data as any).items : [];
        const items = (raw as Array<any>).filter((item) =>
          matchesSearch(q, item.variant?.product?.name, item.productName, item.name, item.variant?.sku, item.sku, item.variant?.size),
        );
        if (q.trim() && !items.length) return <Text style={styles.emptyFilter}>{t('No matching rows')}</Text>;
        if (!items.length) return <EmptyState icon="warehouse" title={t('No stock rows')} subtitle={t('Add products and stock to see them here')} />;
        return (
          <>
            <SummaryCards items={[{ label: t('Items'), value: String(items.length) }]} />
            {items.map((item, index) => {
              const size = [item.variant?.size, item.variant?.color].filter(Boolean).join(' · ');
              const title = item.variant?.product?.name || item.productName || item.name || t('Unknown');
              const sku = item.variant?.sku || item.sku || '';
              const quantity = item.quantity ?? item.stockQty ?? 0;
              const uomCode = item.variant?.uom?.code || item.uomCode || '';
              return (
                <ListRow
                  key={item.id || `${title}-${sku}-${index}`}
                  title={title}
                  subtitle={[sku, size].filter(Boolean).join(' · ') || undefined}
                  icon="warehouse"
                  right={`${qty(quantity)} ${uomCode}`.trim()}
                  showChevron={false}
                  style={styles.row}
                />
              );
            })}
          </>
        );
      }
      case 'low_stock': {
        const report = (data || {}) as {
          items?: Array<any>;
          summary?: { count: number };
        };
        const raw = Array.isArray(data) ? data : Array.isArray(report.items) ? report.items : [];
        const items = raw.filter((item) =>
          matchesSearch(q, item.variant?.product?.name, item.name, item.productName, item.variant?.sku, item.sku, item.variant?.size),
        );
        const summary = report.summary || { count: items.length };
        return (
          <>
            <SummaryCards items={[{ label: t('Low items'), value: String(summary.count), color: colors.error }]} />
            {items.map((item, index) => {
              const size = [item.variant?.size, item.variant?.color].filter(Boolean).join(' · ');
              const reorder = item.reorder_level ?? item.reorderLevel ?? 0;
              const reorderLabel = reorder > 0
                ? t('Reorder {{qty}}', { qty: qty(reorder) })
                : t('Out of stock');
              const title = item.variant?.product?.name || item.name || item.productName || t('Unknown');
              const sku = item.variant?.sku || item.sku || '';
              const quantity = item.quantity ?? item.stockQty ?? 0;
              const uomCode = item.variant?.uom?.code || item.uomCode || '';
              return (
                <ListRow
                  key={item.id || `${title}-${sku}-${index}`}
                  title={title}
                  subtitle={[sku, size, reorderLabel].filter(Boolean).join(' · ')}
                  icon="alert-outline"
                  iconColor={colors.error}
                  iconBg={colors.errorLight}
                  right={`${qty(quantity)} ${uomCode}`.trim()}
                  showChevron={false}
                  style={styles.row}
                />
              );
            })}
            {q.trim() && !items.length ? <Text style={styles.emptyFilter}>{t('No matching rows')}</Text> : null}
          </>
        );
      }
      case 'customer': {
        const raw = Array.isArray(data) ? data : Array.isArray((data as any)?.items) ? (data as any).items : [];
        const items = (raw as Array<{ id: string; name: string; phone?: string; order_count: number; total_spent: number }>)
          .filter((item) => matchesSearch(q, item.name, item.phone));
        if (q.trim() && !items.length) return <Text style={styles.emptyFilter}>{t('No matching rows')}</Text>;
        return items.map((item) => (
          <ListRow
            key={item.id}
            title={item.name}
            subtitle={[item.phone, t('{{count}} orders', { count: item.order_count })].filter(Boolean).join(' · ')}
            icon="account-circle"
            right={money(item.total_spent)}
            showChevron={false}
            style={styles.row}
          />
        ));
      }
      case 'supplier': {
        const raw = Array.isArray(data) ? data : Array.isArray((data as any)?.items) ? (data as any).items : [];
        const items = (raw as Array<{ id: string; name: string; phone?: string; bill_count: number; total_purchased: number }>)
          .filter((item) => matchesSearch(q, item.name, item.phone));
        if (q.trim() && !items.length) return <Text style={styles.emptyFilter}>{t('No matching rows')}</Text>;
        return items.map((item) => (
          <ListRow
            key={item.id}
            title={item.name}
            subtitle={[item.phone, t('{{count}} bills', { count: item.bill_count })].filter(Boolean).join(' · ')}
            icon="truck"
            right={money(item.total_purchased)}
            showChevron={false}
            style={styles.row}
          />
        ));
      }
      case 'gst': {
        let rawItems: Array<{ tax_name: string; totalTax: number }> = [];
        if (Array.isArray(data)) {
          rawItems = data;
        } else if (Array.isArray((data as any)?.items)) {
          rawItems = (data as any).items;
        } else if (data && typeof data === 'object' && ('tax' in (data as any) || 'taxable' in (data as any))) {
          const d = data as any;
          rawItems = [
            { tax_name: 'GST Total Tax Collected', totalTax: Number(d.tax || 0) },
            { tax_name: 'Taxable Turnover', totalTax: Number(d.taxable || 0) },
            { tax_name: 'Gross Turnover', totalTax: Number(d.total || 0) },
          ];
        }
        const items = rawItems.filter((item) => matchesSearch(q, item.tax_name));
        if (q.trim() && !items.length) return <Text style={styles.emptyFilter}>{t('No matching rows')}</Text>;
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
        const report = (data || {}) as {
          expenses?: Array<{ id: string; expense_date: string; amount: number; category?: { name?: string } }>;
          total?: number;
        };
        const rawExpenses = Array.isArray(report.expenses)
          ? report.expenses
          : Array.isArray(data)
            ? (data as Array<any>)
            : [];
        const expenses = rawExpenses.filter((item) => matchesSearch(q, item.category?.name, item.expense_date));
        const total = report.total ?? rawExpenses.reduce((s, e) => s + (parseFloat(String(e.amount)) || 0), 0);
        return (
          <>
            <SummaryCards items={[{ label: t('Total expenses'), value: money(total), color: colors.error }]} />
            {expenses.map((item) => (
              <ListRow
                key={item.id}
                title={item.category?.name || t('Expense')}
                subtitle={item.expense_date}
                icon="cash-minus"
                right={money(item.amount)}
                showChevron={false}
                style={styles.row}
              />
            ))}
            {q.trim() && !expenses.length ? <Text style={styles.emptyFilter}>{t('No matching rows')}</Text> : null}
          </>
        );
      }
      case 'cash_flow': {
        const report = (data || {}) as {
          summary?: { cashIn: number; cashOut: number; netFlow: number; expenses: number; purchases: number };
          inflows?: Array<{ payment_mode: string; total: number }>;
        };
        const summary = report.summary || {
          cashIn: (report as any).inflow || 0,
          cashOut: (report as any).outflow || 0,
          netFlow: (report as any).net || 0,
          expenses: (report as any).expenses || 0,
          purchases: (report as any).purchases || 0,
        };
        const rawInflows = Array.isArray(report.inflows) ? report.inflows : [{ payment_mode: 'cash', total: summary.cashIn }];
        const inflows = rawInflows.filter((item) => matchesSearch(q, item.payment_mode));
        return (
          <>
            <SummaryCards items={[
              { label: t('Cash in'), value: money(summary.cashIn), color: colors.secondary },
              { label: t('Cash out'), value: money(summary.cashOut), color: colors.error },
              { label: t('Net flow'), value: money(summary.netFlow), color: summary.netFlow >= 0 ? colors.success : colors.error },
            ]} />
            <Text style={styles.sectionTitle}>{t('Payment modes')}</Text>
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
            {q.trim() && !inflows.length ? <Text style={styles.emptyFilter}>{t('No matching rows')}</Text> : null}
          </>
        );
      }
      default:
        return null;
    }
  } catch (renderError) {
    console.error('Error rendering report content:', renderError);
    return null;
  }
}, [data, reportType, search, t]);

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
        <EmptyState icon="alert-circle-outline" title={t('Report unavailable')} subtitle={error} />
      </View>
    );
  }

  return (
    <ScrollView
      style={common.screen}
      contentContainerStyle={common.screenPad}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}>
      <Text style={styles.title}>{t(config?.title || 'Report')}</Text>
      <Text style={styles.subtitle}>{config?.subtitle ? t(config.subtitle) : ''}</Text>

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
        {t('Export Excel')}
      </Button>

      {hasRows ? (
        <>
          <ScreenSearch value={search} onChangeText={setSearch} placeholder={t('Search report rows...')} embedded />
          {content}
        </>
      ) : (
        <EmptyState icon={config?.icon || 'chart-box-outline'} title={t('No data yet')} subtitle={t('Transactions will appear here once available')} />
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
    borderColor: colors.border,
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
