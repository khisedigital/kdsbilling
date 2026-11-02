import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { CommonActions, useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import BottomBar from '../../components/ui/BottomBar';
import { fetchBill, voidBill } from '../../services/businessService';
import type { BillDetail } from '../../services/businessService';
import { printReceipt } from '../../print/receiptPrinter';
import { useCartStore } from '../../store/cartStore';
import { canProcessReturn, itemRemainingQty } from '../../utils/billStatus';
import { formatDateTime, getCreatedAt, parseApiDate } from '../../utils/formatDate';
import { colors } from '../../theme/colors';
import { common, radius, spacing } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'SaleDetail'>;

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  completed: { label: 'Paid', color: colors.secondary, bg: colors.secondaryLight, icon: 'check-circle' },
  partially_returned: { label: 'Partial return', color: colors.warning, bg: colors.warningLight, icon: 'undo-variant' },
  fully_returned: { label: 'Fully returned', color: colors.primary, bg: colors.primaryLight, icon: 'backup-restore' },
  void: { label: 'Voided', color: colors.error, bg: colors.errorLight, icon: 'close-circle' },
  held: { label: 'On hold', color: colors.warning, bg: colors.warningLight, icon: 'pause-circle' },
  draft: { label: 'Draft', color: colors.textMuted, bg: colors.surfaceVariant, icon: 'file-document-outline' },
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  credit: 'Credit',
  store_credit: 'Wallet',
};

function money(n: string | number | undefined) {
  return `₹${parseFloat(String(n ?? 0)).toFixed(2)}`;
}

function formatQty(q: string | number) {
  const n = parseFloat(String(q));
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '');
}

export default function SaleDetailScreen({ route, navigation }: Props) {
  const { billId, fromSale } = route.params;
  const [bill, setBill] = useState<BillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [showVoid, setShowVoid] = useState(false);
  const [showReturns, setShowReturns] = useState(true);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError('');
    try {
      setBill(await fetchBill(billId));
    } catch {
      if (!opts?.silent) {
        setError('Could not load bill details');
        setBill(null);
      }
    } finally {
      setLoading(false);
    }
  }, [billId]);

  useFocusEffect(
    useCallback(() => {
      load({ silent: true });
    }, [load]),
  );

  const goHome = useCallback(() => {
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Dashboard' }],
      }),
    );
  }, [navigation]);

  useEffect(() => {
    if (!fromSale) return undefined;

    const unsub = navigation.addListener('beforeRemove', (e) => {
      const type = e.data.action.type;
      if (type !== 'GO_BACK' && type !== 'POP') return;
      e.preventDefault();
      goHome();
    });

    const backSub = BackHandler.addEventListener('hardwareBackPress', () => {
      goHome();
      return true;
    });

    return () => {
      unsub();
      backSub.remove();
    };
  }, [fromSale, goHome, navigation]);

  const handlePrint = async () => {
    setPrinting(true);
    try {
      await printReceipt(billId);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Could not print receipt. Check printer settings.';
      Alert.alert('Print failed', message);
    } finally {
      setPrinting(false);
    }
  };

  const handleDone = () => {
    useCartStore.getState().clear();
    navigation.dispatch(
      CommonActions.reset({
        index: 1,
        routes: [
          { name: 'Dashboard' },
          { name: 'Billing', params: { fresh: true } },
        ],
      }),
    );
  };

  const handleVoid = () => {
    if (!voidReason.trim()) {
      Alert.alert('Reason required', 'Please enter a reason to void this bill.');
      return;
    }
    Alert.alert('Void this bill?', 'Stock will be restored. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Void bill',
        style: 'destructive',
        onPress: async () => {
          setVoiding(true);
          try {
            await voidBill(billId, voidReason.trim());
            navigation.goBack();
          } catch (err: unknown) {
            const msg =
              (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data
                ?.error?.message || 'Void failed';
            Alert.alert('Error', msg);
          } finally {
            setVoiding(false);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading bill…</Text>
      </View>
    );
  }

  if (error || !bill) {
    return (
      <View style={styles.center}>
        <Icon name="file-alert-outline" size={48} color={colors.textMuted} />
        <Text style={styles.errorText}>{error || 'Bill not found'}</Text>
        <Button mode="contained" onPress={() => load()} style={styles.retryBtn}>
          Retry
        </Button>
      </View>
    );
  }

  const status = STATUS_CONFIG[bill.status] || STATUS_CONFIG.draft;
  const date = parseApiDate(getCreatedAt(bill));
  const items = bill.items || [];
  const payments = bill.payments || [];
  const returns = bill.returns || [];
  const showProcessReturn = !fromSale && canProcessReturn(bill);
  const canVoid =
    !fromSale
    && bill.status === 'completed'
    && !(bill.items || []).some((i) => parseFloat(String(i.returned_quantity || 0)) > 0);
  const changeAmt = parseFloat(String(bill.change_amount || 0));
  const discAmt = parseFloat(String(bill.discount_amount || 0));
  const roundAmt = parseFloat(String(bill.round_off_amount ?? 0));
  const paymentSummary = payments
    .map((p) => PAYMENT_LABELS[p.payment_mode] || p.payment_mode)
    .join(' · ');

  return (
    <View style={common.screen}>
      <ScrollView
        contentContainerStyle={[styles.scroll, fromSale && styles.scrollWithBar]}
        showsVerticalScrollIndicator={false}>
        {/* Success / status header */}
        {fromSale ? (
          <View style={styles.successBlock}>
            <View style={styles.successIcon}>
              <Icon name="check" size={32} color={colors.textOnPrimary} />
            </View>
            <Text style={styles.successTitle}>Sale complete</Text>
            <Text style={styles.successAmount}>{money(bill.total_amount)}</Text>
            <Text style={styles.successBill}>{bill.bill_number}</Text>
            {changeAmt > 0 ? (
              <View style={styles.changePill}>
                <Icon name="hand-coin-outline" size={16} color={colors.secondaryDark} />
                <Text style={styles.changePillText}>Change {money(changeAmt)}</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.hero}>
            <View style={styles.heroTop}>
              <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                <Icon name={status.icon} size={14} color={status.color} />
                <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
              </View>
              {date ? (
                <Text style={styles.heroDate}>
                  {date.toLocaleDateString()} ·{' '}
                  {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              ) : null}
            </View>
            <Text style={styles.billNo}>{bill.bill_number}</Text>
            <Text style={styles.heroTotal}>{money(bill.total_amount)}</Text>
            {bill.customer?.name ? (
              <Text style={styles.heroSub}>{bill.customer.name}</Text>
            ) : null}
          </View>
        )}

        {/* Quick facts */}
        <View style={styles.facts}>
          {fromSale && bill.customer?.name ? (
            <View style={styles.fact}>
              <Text style={styles.factLbl}>Customer</Text>
              <Text style={styles.factVal} numberOfLines={1}>{bill.customer.name}</Text>
            </View>
          ) : null}
          {paymentSummary ? (
            <View style={styles.fact}>
              <Text style={styles.factLbl}>Paid by</Text>
              <Text style={styles.factVal}>{paymentSummary}</Text>
            </View>
          ) : null}
          {!fromSale && bill.customer?.phone ? (
            <View style={styles.fact}>
              <Text style={styles.factLbl}>Phone</Text>
              <Text style={styles.factVal}>{bill.customer.phone}</Text>
            </View>
          ) : null}
        </View>

        {/* Items */}
        <Text style={styles.sectionTitle}>
          {items.length} item{items.length === 1 ? '' : 's'}
        </Text>
        <View style={styles.card}>
          {items.map((item, idx) => {
            const sold = parseFloat(String(item.quantity)) || 0;
            const left = itemRemainingQty(item);
            const returned = sold - left;
            return (
              <View key={item.id} style={[styles.itemRow, idx > 0 && styles.rowBorder]}>
                <View style={{ flex: 1, paddingRight: spacing.md }}>
                  <Text style={styles.itemName} numberOfLines={2}>{item.product_name}</Text>
                  <Text style={styles.itemMeta}>
                    {formatQty(item.quantity)} × {money(item.unit_price)}
                  </Text>
                  {returned > 0.0005 ? (
                    <Text style={styles.itemNote}>
                      Returned {formatQty(returned)} · Left {formatQty(left)}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.itemTotal}>{money(item.line_total)}</Text>
              </View>
            );
          })}

          <View style={styles.totals}>
            <View style={styles.sumRow}>
              <Text style={styles.sumLbl}>Subtotal</Text>
              <Text style={styles.sumVal}>{money(bill.subtotal)}</Text>
            </View>
            {discAmt > 0 ? (
              <View style={styles.sumRow}>
                <Text style={styles.sumLbl}>Discount</Text>
                <Text style={styles.discVal}>−{money(discAmt)}</Text>
              </View>
            ) : null}
            <View style={styles.sumRow}>
              <Text style={styles.sumLbl}>Tax</Text>
              <Text style={styles.sumVal}>{money(bill.tax_amount)}</Text>
            </View>
            {Math.abs(roundAmt) >= 0.005 ? (
              <View style={styles.sumRow}>
                <Text style={styles.sumLbl}>Round off</Text>
                <Text style={styles.sumVal}>
                  {roundAmt > 0 ? '+' : '−'}
                  {money(Math.abs(roundAmt))}
                </Text>
              </View>
            ) : null}
            <View style={[styles.sumRow, styles.grandRow]}>
              <Text style={styles.grandLbl}>Total</Text>
              <Text style={styles.grandVal}>{money(bill.total_amount)}</Text>
            </View>
          </View>
        </View>

        {/* Returns */}
        {returns.length > 0 ? (
          <>
            <Pressable
              onPress={() => setShowReturns((v) => !v)}
              style={styles.accordion}>
              <Text style={styles.accordionTitle}>
                Credit notes · {returns.length}
              </Text>
              <Icon
                name={showReturns ? 'chevron-up' : 'chevron-down'}
                size={22}
                color={colors.textMuted}
              />
            </Pressable>
            {showReturns
              ? returns.map((r) => {
                  const title = r.credit_note_number || r.return_number;
                  const mode = (r.refund_mode || 'cash').replace('_', ' ');
                  const returnItems = r.items || [];
                  return (
                    <View key={r.id} style={styles.card}>
                      <View style={styles.returnHead}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.returnTitle}>{title}</Text>
                          <Text style={styles.itemMeta}>
                            {mode}
                            {getCreatedAt(r) ? ` · ${formatDateTime(getCreatedAt(r))}` : ''}
                          </Text>
                        </View>
                        <Text style={styles.itemTotal}>{money(r.total_amount)}</Text>
                      </View>
                      {returnItems.map((ri) => {
                        const name =
                          ri.salesOrderItem?.product_name
                          || ri.sales_order_item?.product_name
                          || 'Item';
                        return (
                          <View key={ri.id} style={styles.returnLine}>
                            <Text style={styles.returnItem} numberOfLines={1}>
                              {name} · {formatQty(ri.quantity)}
                            </Text>
                            <Text style={styles.returnAmt}>{money(ri.line_total)}</Text>
                          </View>
                        );
                      })}
                    </View>
                  );
                })
              : null}
          </>
        ) : null}

        {/* Voided banner */}
        {bill.status === 'void' && bill.void_reason ? (
          <View style={styles.voidBanner}>
            <Icon name="alert-circle-outline" size={20} color={colors.error} />
            <View style={{ flex: 1 }}>
              <Text style={styles.voidTitle}>Voided</Text>
              <Text style={styles.voidReason}>{bill.void_reason}</Text>
            </View>
          </View>
        ) : null}

        {/* Secondary actions when not from sale */}
        {!fromSale ? (
          <View style={styles.actions}>
            <Button
              mode="contained"
              icon="printer"
              onPress={handlePrint}
              loading={printing}
              buttonColor={colors.secondary}
              style={styles.actionBtn}
              contentStyle={styles.actionContent}
              labelStyle={styles.printLabel}>
              Print bill
            </Button>
            {showProcessReturn ? (
              <Button
                mode="outlined"
                icon="keyboard-return"
                onPress={() => navigation.navigate('Return', { billId })}
                style={styles.actionBtn}
                contentStyle={styles.actionContent}
                textColor={colors.primary}>
                Process return
              </Button>
            ) : null}
          </View>
        ) : null}

        {/* Void — tucked away */}
        {canVoid ? (
          <>
            <Pressable onPress={() => setShowVoid((v) => !v)} style={styles.voidToggle}>
              <Text style={styles.voidToggleText}>
                {showVoid ? 'Hide void option' : 'Need to void this bill?'}
              </Text>
            </Pressable>
            {showVoid ? (
              <View style={styles.voidPanel}>
                <Text style={styles.voidHint}>Stock will be restored. This cannot be undone.</Text>
                <TextInput
                  label="Reason"
                  value={voidReason}
                  onChangeText={setVoidReason}
                  mode="outlined"
                  style={styles.voidInput}
                  outlineColor={colors.border}
                  activeOutlineColor={colors.error}
                />
                <Button
                  mode="contained"
                  icon="close-circle-outline"
                  onPress={handleVoid}
                  loading={voiding}
                  buttonColor={colors.error}
                  style={styles.actionBtn}>
                  Void bill
                </Button>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {fromSale ? (
        <BottomBar
          primary={{
            label: 'New bill',
            onPress: handleDone,
            icon: 'plus',
            color: colors.primary,
          }}
          secondary={[
            {
              label: printing ? 'Printing…' : 'Print',
              onPress: handlePrint,
              icon: 'printer',
              disabled: printing,
              flex: 1,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
  },
  loadingText: { marginTop: spacing.md, color: colors.textMuted, fontSize: 15 },
  errorText: {
    marginTop: spacing.md,
    color: colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
  },
  retryBtn: { marginTop: spacing.lg, borderRadius: radius.md },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  scrollWithBar: { paddingBottom: spacing.lg },
  successBlock: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    marginBottom: spacing.lg,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.secondaryDark,
  },
  successAmount: {
    fontSize: 40,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -1,
    marginTop: spacing.xs,
  },
  successBill: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  changePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    backgroundColor: colors.secondaryLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  changePillText: { fontSize: 14, fontWeight: '700', color: colors.secondaryDark },
  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginBottom: spacing.lg,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
  },
  statusText: { fontSize: 12, fontWeight: '700' },
  heroDate: { fontSize: 12, color: 'rgba(255,255,255,0.75)' },
  billNo: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600',
  },
  heroTotal: {
    fontSize: 36,
    fontWeight: '700',
    color: colors.textOnPrimary,
    marginTop: spacing.xs,
    letterSpacing: -0.5,
  },
  heroSub: {
    marginTop: spacing.sm,
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '500',
  },
  facts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  fact: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    minWidth: '46%',
    flexGrow: 1,
  },
  factLbl: { fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  factVal: { fontSize: 14, fontWeight: '600', color: colors.text, marginTop: 2 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.md,
  },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight },
  itemName: { fontSize: 15, fontWeight: '600', color: colors.text, lineHeight: 20 },
  itemMeta: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  itemNote: { fontSize: 11, color: colors.secondary, marginTop: 2, fontWeight: '600' },
  itemTotal: { fontSize: 15, fontWeight: '700', color: colors.text },
  totals: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: 4,
  },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between' },
  sumLbl: { fontSize: 13, color: colors.textMuted },
  sumVal: { fontSize: 13, fontWeight: '600', color: colors.text },
  discVal: { fontSize: 13, fontWeight: '700', color: colors.secondary },
  grandRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
  },
  grandLbl: { fontSize: 16, fontWeight: '700', color: colors.text },
  grandVal: { fontSize: 18, fontWeight: '700', color: colors.secondary },
  accordion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  accordionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  returnHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.md,
  },
  returnTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  returnLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  returnItem: { flex: 1, fontSize: 13, color: colors.textSecondary },
  returnAmt: { fontSize: 13, fontWeight: '600', color: colors.text },
  voidBanner: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.errorLight,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  voidTitle: { fontSize: 15, fontWeight: '700', color: colors.error },
  voidReason: { fontSize: 14, color: colors.text, marginTop: 2 },
  actions: { gap: spacing.sm, marginBottom: spacing.lg },
  actionBtn: { borderRadius: radius.md },
  actionContent: { paddingVertical: spacing.sm },
  printLabel: { fontSize: 16, fontWeight: '700' },
  voidToggle: { alignItems: 'center', paddingVertical: spacing.md },
  voidToggleText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  voidPanel: {
    backgroundColor: colors.errorLight,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  voidHint: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md },
  voidInput: { marginBottom: spacing.md, backgroundColor: colors.surface },
});
