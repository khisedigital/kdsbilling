import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/MainNavigator';
import SurfaceCard from '../components/ui/SurfaceCard';
import { fetchDashboard } from '../services/businessService';
import { useAuthStore } from '../store/authStore';
import { apiError } from '../utils/apiError';
import { colors } from '../theme/colors';
import { common, radius, spacing, typography } from '../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'Dashboard'>;

interface DashboardData {
  todaySales: number;
  monthSales: number;
  ordersCount: number;
  todayProfit: number;
  lowStock: Array<{ variant?: { product?: { name: string } }; quantity: number }>;
  bestSellers: Array<{ product_name: string; totalQty: number; revenue: number }>;
  recentTransactions: Array<{ id: string; bill_number: string; total_amount: number }>;
}

function StatTile({ label, value, icon, tint }: { label: string; value: string; icon: string; tint: string }) {
  return (
    <SurfaceCard style={styles.statTile} padding>
      <View style={[styles.statIcon, { backgroundColor: `${tint}15` }]}>
        <Icon name={icon} size={20} color={tint} />
      </View>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </SurfaceCard>
  );
}

export default function DashboardScreen({ navigation }: Props) {
  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const [data, setData] = useState<DashboardData | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [loadError, setLoadError] = useState('');

  const load = async () => {
    try {
      setLoadError('');
      setData(await fetchDashboard());
    } catch (err) {
      setLoadError(apiError(err, 'Could not load dashboard'));
      setData(null);
    }
  };
  useFocusEffect(
    React.useCallback(() => {
      load();
    }, []),
  );

  return (
    <View style={common.screen}>
      <ScrollView
        contentContainerStyle={common.screenPad}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} colors={[colors.primary]} />}>
        <View style={styles.welcome}>
          <Text style={styles.welcomeHi}>Hello 👋</Text>
          <Text style={styles.welcomeShop}>{tenant?.name}</Text>
          <Text style={styles.welcomeSub}>{[user?.branch?.name, user?.name].filter(Boolean).join(' · ')}</Text>
        </View>

        {loadError ? (
          <SurfaceCard padding style={styles.alert}>
            <Text style={styles.alertTitle}>{loadError}</Text>
            <Button mode="text" onPress={load} textColor={colors.primary}>Retry</Button>
          </SurfaceCard>
        ) : null}

        {data ? (
          <View style={styles.statsGrid}>
            <StatTile label="Today" value={`₹${data.todaySales.toFixed(0)}`} icon="cash-register" tint={colors.primary} />
            <StatTile label="This month" value={`₹${data.monthSales.toFixed(0)}`} icon="chart-line" tint={colors.secondary} />
            <StatTile label="Orders" value={String(data.ordersCount)} icon="receipt" tint={colors.accent} />
            <StatTile label="Profit" value={`₹${data.todayProfit.toFixed(0)}`} icon="trending-up" tint={colors.success} />
          </View>
        ) : null}

        <Button
          mode="contained"
          icon="point-of-sale"
          onPress={() => navigation.navigate('Billing', { fresh: true })}
          buttonColor={colors.secondary}
          style={styles.cta}
          contentStyle={styles.ctaContent}
          labelStyle={styles.ctaLabel}>
          New Bill
        </Button>

        {data?.lowStock?.length ? (
          <SurfaceCard style={styles.alert} onPress={() => navigation.navigate('StockList')}>
            <View style={styles.alertRow}>
              <View style={styles.alertIcon}><Icon name="alert-outline" size={22} color={colors.warning} /></View>
              <View style={styles.alertBody}>
                <Text style={styles.alertTitle}>{data.lowStock.length} items low on stock</Text>
                <Text style={styles.alertSub}>Tap to view inventory</Text>
              </View>
              <Icon name="chevron-right" size={22} color={colors.textMuted} />
            </View>
          </SurfaceCard>
        ) : null}

        {data?.recentTransactions?.length ? (
          <>
            <Text style={typography.label}>Recent sales</Text>
            <SurfaceCard padding>
              {data.recentTransactions.slice(0, 5).map((tx, i) => (
                <TouchableOpacity
                  key={tx.id}
                  style={[styles.txRow, i > 0 && styles.txBorder]}
                  onPress={() => navigation.navigate('SaleDetail', { billId: tx.id })}>
                  <Text style={styles.txNo}>{tx.bill_number}</Text>
                  <Text style={styles.txAmt}>₹{Number(tx.total_amount).toFixed(0)}</Text>
                </TouchableOpacity>
              ))}
              <Button mode="text" onPress={() => navigation.navigate('SalesList')} textColor={colors.primary}>View all</Button>
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
  welcomeHi: { color: 'rgba(255,255,255,0.8)', fontSize: 14 },
  welcomeShop: { color: colors.textOnPrimary, fontSize: 24, fontWeight: '700', marginTop: spacing.xs },
  welcomeSub: { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: spacing.xs },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.lg },
  statTile: { width: '47%', marginBottom: 0 },
  statIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  statLabel: { ...typography.caption },
  statValue: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: 2 },
  cta: { borderRadius: radius.lg, marginBottom: spacing.lg },
  ctaContent: { paddingVertical: spacing.sm + 2 },
  ctaLabel: { fontSize: 16, fontWeight: '700' },
  alert: { marginBottom: spacing.lg },
  alertRow: { flexDirection: 'row', alignItems: 'center' },
  alertIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.warningLight, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  alertBody: { flex: 1 },
  alertTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  alertSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  txRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm + 2 },
  txBorder: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  txNo: { fontSize: 14, fontWeight: '500', color: colors.text },
  txAmt: { fontSize: 15, fontWeight: '700', color: colors.secondary },
});
