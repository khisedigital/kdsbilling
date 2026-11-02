import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { CommonActions } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import BottomBar from '../../components/ui/BottomBar';
import { printDraftReceipt } from '../../print/receiptPrinter';
import { createBill, deleteHeldBill, previewBill, type BillDetail } from '../../services/businessService';
import { useCartStore } from '../../store/cartStore';
import { colors } from '../../theme/colors';
import { common, radius, spacing } from '../../theme/layout';
import { formatQuantity } from '../../utils/quantity';

type Props = NativeStackScreenProps<MainStackParamList, 'Payment'>;
type DiscountMode = 'amount' | 'percent';

const PAYMENT_MODES = [
  { id: 'cash', label: 'Cash', icon: 'cash' },
  { id: 'upi', label: 'UPI', icon: 'qrcode-scan' },
  { id: 'card', label: 'Card', icon: 'credit-card-outline' },
  { id: 'credit', label: 'Credit', icon: 'account-clock-outline' },
  { id: 'store_credit', label: 'Wallet', icon: 'wallet-outline' },
] as const;

type BillPreview = {
  items: Array<{
    variantId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    discountAmount?: number;
  }>;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  exactTotal?: number;
  totalAmount: number;
};

function round2(n: number) {
  return Math.round(Number(n) * 100) / 100;
}

function nearestRupee(amount: number) {
  return Math.round(amount);
}

export default function PaymentScreen({ navigation }: Props) {
  const items = useCartStore((s) => s.items);
  const customerId = useCartStore((s) => s.customerId);
  const customerName = useCartStore((s) => s.customerName);
  const billDiscountAmount = useCartStore((s) => s.billDiscountAmount);
  const billDiscountPercent = useCartStore((s) => s.billDiscountPercent);
  const setBillDiscount = useCartStore((s) => s.setBillDiscount);
  const offerId = useCartStore((s) => s.offerId);
  const clear = useCartStore((s) => s.clear);

  const [preview, setPreview] = useState<BillPreview | null>(null);
  const [exactTotal, setExactTotal] = useState(0);
  const [roundOffAmount, setRoundOffAmount] = useState(0);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [payMode, setPayMode] = useState<string>('cash');
  const [payAmount, setPayAmount] = useState('');
  const [splitExtra, setSplitExtra] = useState<{ mode: string; amount: string }[]>([]);
  const [showDiscount, setShowDiscount] = useState(false);
  const [showItems, setShowItems] = useState(false);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState('');
  const [discountMode, setDiscountMode] = useState<DiscountMode>(
    billDiscountPercent > 0 ? 'percent' : 'amount',
  );
  const [discountInput, setDiscountInput] = useState(
    billDiscountPercent > 0
      ? String(billDiscountPercent)
      : billDiscountAmount > 0
        ? String(billDiscountAmount)
        : '',
  );
  const [discountError, setDiscountError] = useState('');
  const requestId = useRef(0);
  const splitExtraRef = useRef(splitExtra);
  splitExtraRef.current = splitExtra;

  const totalDue = round2(exactTotal + roundOffAmount);
  const nearestTarget = nearestRupee(exactTotal);
  const suggestedOff = round2(nearestTarget - exactTotal);
  const canRound = exactTotal > 0 && Math.abs(suggestedOff) >= 0.01;
  const isRounded = Math.abs(roundOffAmount) >= 0.01;
  const isSplit = splitExtra.length > 0;

  const payments = [
    { mode: payMode, amount: payAmount },
    ...splitExtra,
  ];

  const splitTotal = splitExtra.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);

  const syncPrimaryAmount = useCallback((due: number, extras = splitExtraRef.current) => {
    const other = extras.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    setPayAmount(round2(Math.max(0, due - other)).toFixed(2));
  }, []);

  const defaultSplitMode = (main: string) =>
    (PAYMENT_MODES.find((m) => m.id !== main)?.id) || 'upi';

  const openSplit = () => {
    const next = [{ mode: defaultSplitMode(payMode), amount: '' }];
    setSplitExtra(next);
    // Main keeps full due until a split amount is typed.
    syncPrimaryAmount(totalDue, next);
  };

  const clearSplit = () => {
    setSplitExtra([]);
    syncPrimaryAmount(totalDue, []);
  };

  const updateSplitAmount = (idx: number, value: string) => {
    setSplitExtra((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], amount: value };
      syncPrimaryAmount(totalDue, next);
      return next;
    });
  };

  const updateSplitMode = (idx: number, mode: string) => {
    setSplitExtra((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], mode };
      return next;
    });
  };

  const loadPreview = useCallback(async () => {
    if (!items.length) {
      setPreview(null);
      setExactTotal(0);
      setRoundOffAmount(0);
      setLoadingPreview(false);
      return;
    }

    const id = ++requestId.current;
    setLoadingPreview(true);
    setError('');
    try {
      const result = (await previewBill({
        items: items.map((i) => ({
          variantId: i.variantId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          discountAmount: i.discountAmount,
          discountPercent: i.discountPercent,
          isCustom: i.isCustom === true,
          productName: i.productName,
        })),
        billDiscountAmount,
        billDiscountPercent,
        offerId,
        roundOffAmount: 0,
      })) as BillPreview;

      if (id !== requestId.current) return;

      const exact = round2(Number(result.exactTotal ?? result.totalAmount ?? 0));
      setPreview(result);
      setExactTotal(exact);
      setRoundOffAmount(0);
      syncPrimaryAmount(exact);
    } catch {
      if (id !== requestId.current) return;
      setPreview(null);
      setError('Could not load bill');
    } finally {
      if (id === requestId.current) setLoadingPreview(false);
    }
  }, [items, billDiscountAmount, billDiscountPercent, offerId, syncPrimaryAmount]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  useEffect(() => {
    if (billDiscountAmount > 0 || billDiscountPercent > 0) {
      setShowDiscount(true);
    }
  }, [billDiscountAmount, billDiscountPercent]);

  const onRoundPress = () => {
    setError('');
    if (isRounded) {
      setRoundOffAmount(0);
      syncPrimaryAmount(exactTotal);
      return;
    }
    if (!canRound) return;
    const nextDue = round2(exactTotal + suggestedOff);
    setRoundOffAmount(suggestedOff);
    syncPrimaryAmount(nextDue);
  };

  const applyDiscount = () => {
    const raw = discountInput.trim().replace(',', '.');
    if (!raw) {
      setBillDiscount(0, 0);
      setDiscountError('');
      return;
    }
    const value = parseFloat(raw);
    if (Number.isNaN(value) || value < 0) {
      setDiscountError('Enter a valid number');
      return;
    }
    if (discountMode === 'percent') {
      if (value > 100) {
        setDiscountError('Percent cannot exceed 100');
        return;
      }
      setBillDiscount(0, Math.round(value * 100) / 100);
    } else {
      setBillDiscount(Math.round(value * 100) / 100, 0);
    }
    setDiscountError('');
  };

  const removeDiscount = () => {
    setBillDiscount(0, 0);
    setDiscountInput('');
    setDiscountError('');
  };

  const totalPaid = payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const balance = Math.max(0, totalDue - totalPaid);
  const change = Math.max(0, totalPaid - totalDue);
  const getCartMeta = (id: string) => items.find((i) => i.variantId === id);

  const discountApplied = round2(preview?.discountAmount ?? 0);
  const hasDiscount = discountApplied > 0 || billDiscountPercent > 0 || billDiscountAmount > 0;
  const itemCount = preview?.items.length ?? 0;

  const goToNewBill = () => {
    clear();
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

  const validateBeforePay = (): boolean => {
    setError('');
    if (!preview) {
      setError('Bill not ready');
      return false;
    }
    const needsCustomer = payments.some(
      (p) => parseFloat(p.amount) > 0 && (p.mode === 'credit' || p.mode === 'store_credit'),
    );
    if (needsCustomer && !customerId) {
      setError('Select a customer for credit or wallet');
      return false;
    }
    if (totalPaid < totalDue - 0.01) {
      setError(`Need ₹${balance.toFixed(2)} more`);
      return false;
    }
    return true;
  };

  const buildDraftBill = (): BillDetail | null => {
    if (!preview) return null;
    const paidRows = payments
      .filter((p) => parseFloat(p.amount) > 0)
      .map((p, idx) => ({
        id: `pay-${idx}`,
        payment_mode: p.mode,
        amount: parseFloat(p.amount),
      }));
    const paid = paidRows.reduce((s, p) => s + Number(p.amount), 0);
    return {
      id: 'draft',
      bill_number: 'DRAFT',
      status: 'draft',
      subtotal: preview.subtotal,
      discount_amount: preview.discountAmount,
      tax_amount: preview.taxAmount,
      round_off_amount: roundOffAmount,
      total_amount: totalDue,
      paid_amount: paid,
      change_amount: Math.max(0, paid - totalDue),
      created_at: new Date().toISOString(),
      customer: customerId
        ? { id: customerId, name: customerName || 'Customer' }
        : customerName
          ? { id: '', name: customerName }
          : null,
      items: preview.items.map((line, idx) => ({
        id: `item-${idx}`,
        product_name: line.productName,
        sku: '',
        variant_id: line.variantId,
        quantity: line.quantity,
        unit_price: line.unitPrice,
        discount_amount: line.discountAmount || 0,
        line_total: line.lineTotal,
      })),
      payments: paidRows,
    };
  };

  const handlePrint = async () => {
    setError('');
    const draft = buildDraftBill();
    if (!draft) {
      setError('Bill not ready');
      return;
    }
    setPrinting(true);
    try {
      await printDraftReceipt(draft);
    } catch (printErr: unknown) {
      Alert.alert('Print failed', (printErr as Error)?.message || 'Could not print receipt.');
    } finally {
      setPrinting(false);
    }
  };

  const handlePay = async () => {
    if (!validateBeforePay()) return;
    setLoading(true);
    try {
      await createBill({
        customerId,
        items: items.map((i) => ({
          variantId: i.variantId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          discountAmount: i.discountAmount,
          discountPercent: i.discountPercent,
          isCustom: i.isCustom === true,
          productName: i.productName,
        })),
        billDiscountAmount,
        billDiscountPercent,
        offerId,
        roundOffAmount,
        heldBillId: useCartStore.getState().resumedHeldId || undefined,
        payments: payments
          .filter((p) => parseFloat(p.amount) > 0)
          .map((p) => ({ mode: p.mode, amount: parseFloat(p.amount) })),
      });
      const heldId = useCartStore.getState().resumedHeldId;
      if (heldId) {
        try {
          await deleteHeldBill(heldId);
        } catch {
          // The sale is already saved. A newer server removes the hold during checkout.
        }
      }
      goToNewBill();
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
        || 'Payment failed',
      );
    } finally {
      setLoading(false);
    }
  };

  if (loadingPreview && !preview) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Getting bill ready…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={common.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {/* Compact due bar */}
        <View style={styles.dueBar}>
          <View style={styles.dueMain}>
            <View style={{ flex: 1 }}>
              <Text style={styles.dueLabel}>Amount due</Text>
              <Text style={styles.dueMeta} numberOfLines={1}>
                {customerName ? `${customerName} · ` : ''}
                {itemCount} item{itemCount === 1 ? '' : 's'}
                {discountApplied > 0 ? ` · −₹${discountApplied.toFixed(2)}` : ''}
              </Text>
            </View>
            <Text style={styles.dueAmount}>₹{totalDue.toFixed(2)}</Text>
          </View>
          <View style={styles.dueActions}>
            <Pressable
              onPress={onRoundPress}
              disabled={!canRound && !isRounded}
              style={[
                styles.chip,
                isRounded && styles.chipOn,
                !canRound && !isRounded && styles.chipDisabled,
              ]}>
              <Icon
                name={isRounded ? 'undo-variant' : 'approximately-equal'}
                size={16}
                color={
                  !canRound && !isRounded
                    ? colors.textMuted
                    : isRounded
                      ? colors.primary
                      : colors.text
                }
              />
              <Text
                style={[
                  styles.chipText,
                  isRounded && styles.chipTextOn,
                  !canRound && !isRounded && styles.chipTextMuted,
                ]}>
                {isRounded
                  ? 'Undo round'
                  : canRound
                    ? `Round ₹${nearestTarget}`
                    : 'Already exact'}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Pay with */}
        <Text style={styles.sectionTitle}>Pay with</Text>
        <View style={styles.modeRow}>
          {PAYMENT_MODES.map((m) => {
            const on = payMode === m.id;
            return (
              <Pressable
                key={m.id}
                onPress={() => {
                  setPayMode(m.id);
                  setSplitExtra((prev) =>
                    prev.map((p) =>
                      p.mode === m.id ? { ...p, mode: defaultSplitMode(m.id) } : p,
                    ),
                  );
                }}
                style={[styles.modeBtn, on && styles.modeBtnOn]}>
                <Icon name={m.icon} size={22} color={on ? colors.primary : colors.textMuted} />
                <Text style={[styles.modeLbl, on && styles.modeLblOn]}>{m.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <TextInput
          label={
            isSplit
              ? `${PAYMENT_MODES.find((m) => m.id === payMode)?.label || 'Main'} (auto)`
              : 'Received'
          }
          value={payAmount}
          onChangeText={setPayAmount}
          keyboardType="decimal-pad"
          mode="outlined"
          style={styles.input}
          outlineColor={colors.border}
          activeOutlineColor={colors.primary}
          left={<TextInput.Affix text="₹" />}
        />

        {!isSplit ? (
          <Pressable onPress={openSplit} style={styles.linkRow}>
            <Icon name="call-split" size={18} color={colors.primary} />
            <Text style={styles.linkText}>Split across modes</Text>
          </Pressable>
        ) : (
          <View style={styles.splitBox}>
            <View style={styles.splitHeader}>
              <Text style={styles.splitTitle}>Also paying with</Text>
              <Pressable onPress={clearSplit}>
                <Text style={styles.linkText}>Remove split</Text>
              </Pressable>
            </View>
            {splitExtra.map((p, idx) => (
              <View key={idx} style={styles.splitLine}>
                <View style={styles.splitModes}>
                  {PAYMENT_MODES.filter((m) => m.id !== payMode).map((m) => {
                    const on = p.mode === m.id;
                    return (
                      <Pressable
                        key={m.id}
                        onPress={() => updateSplitMode(idx, m.id)}
                        style={[styles.splitModeChip, on && styles.modeBtnOn]}>
                        <Text style={[styles.splitModeText, on && styles.modeLblOn]}>{m.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <TextInput
                  label="Split amount"
                  value={p.amount}
                  onChangeText={(v) => updateSplitAmount(idx, v)}
                  keyboardType="decimal-pad"
                  mode="outlined"
                  autoFocus={idx === 0 && !p.amount}
                  style={styles.input}
                  outlineColor={colors.border}
                  activeOutlineColor={colors.primary}
                  left={<TextInput.Affix text="₹" />}
                />
                {parseFloat(p.amount) > 0 ? (
                  <Text style={styles.splitHint}>
                    Main mode left with ₹{payAmount || '0.00'}
                    {splitTotal > 0 ? ` · Split ₹${round2(splitTotal).toFixed(2)}` : ''}
                  </Text>
                ) : (
                  <Text style={styles.splitHint}>
                    Enter amount — main mode reduces automatically
                  </Text>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Discount — collapsed */}
        <Pressable
          onPress={() => setShowDiscount((v) => !v)}
          style={styles.accordion}>
          <View style={styles.accordionLeft}>
            <Icon name="tag-outline" size={20} color={colors.primary} />
            <Text style={styles.accordionTitle}>
              {hasDiscount
                ? `Discount −₹${discountApplied.toFixed(2)}`
                : 'Add discount'}
            </Text>
          </View>
          <Icon
            name={showDiscount ? 'chevron-up' : 'chevron-down'}
            size={22}
            color={colors.textMuted}
          />
        </Pressable>
        {showDiscount ? (
          <View style={styles.panel}>
            <View style={styles.discModes}>
              <Pressable
                onPress={() => setDiscountMode('amount')}
                style={[styles.discMode, discountMode === 'amount' && styles.discModeOn]}>
                <Text style={[styles.discModeText, discountMode === 'amount' && styles.discModeTextOn]}>
                  ₹ Rupees
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setDiscountMode('percent')}
                style={[styles.discMode, discountMode === 'percent' && styles.discModeOn]}>
                <Text style={[styles.discModeText, discountMode === 'percent' && styles.discModeTextOn]}>
                  % Percent
                </Text>
              </Pressable>
            </View>
            <TextInput
              label={discountMode === 'percent' ? 'Percent' : 'Amount'}
              value={discountInput}
              onChangeText={(v) => {
                setDiscountInput(v);
                setDiscountError('');
              }}
              keyboardType="decimal-pad"
              mode="outlined"
              style={styles.input}
              outlineColor={colors.border}
              activeOutlineColor={colors.primary}
            />
            {discountError ? <HelperText type="error" visible>{discountError}</HelperText> : null}
            <View style={styles.discActions}>
              {hasDiscount || discountInput ? (
                <Button mode="text" textColor={colors.error} onPress={removeDiscount}>
                  Clear
                </Button>
              ) : null}
              <Button mode="contained" onPress={applyDiscount} style={{ flex: 1 }}>
                Apply
              </Button>
            </View>
          </View>
        ) : null}

        {/* Items — collapsed */}
        <Pressable
          onPress={() => setShowItems((v) => !v)}
          style={styles.accordion}>
          <View style={styles.accordionLeft}>
            <Icon name="cart-outline" size={20} color={colors.primary} />
            <Text style={styles.accordionTitle}>
              Bill details
              {itemCount ? ` · ${itemCount} item${itemCount === 1 ? '' : 's'}` : ''}
            </Text>
          </View>
          <Icon
            name={showItems ? 'chevron-up' : 'chevron-down'}
            size={22}
            color={colors.textMuted}
          />
        </Pressable>
        {showItems ? (
          <View style={styles.panel}>
            {preview?.items.map((line, idx) => {
              const cartItem = getCartMeta(line.variantId);
              const qty = cartItem?.uom
                ? formatQuantity(line.quantity, cartItem.uom)
                : String(line.quantity);
              return (
                <View key={line.variantId} style={[styles.line, idx > 0 && styles.lineBorder]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineName} numberOfLines={2}>{line.productName}</Text>
                    <Text style={styles.lineMeta}>
                      {qty} × ₹{round2(line.unitPrice).toFixed(2)}
                    </Text>
                  </View>
                  <Text style={styles.lineAmt}>₹{round2(line.lineTotal).toFixed(2)}</Text>
                </View>
              );
            })}
            <View style={styles.miniSum}>
              <View style={styles.sumRow}>
                <Text style={styles.sumLbl}>Subtotal</Text>
                <Text style={styles.sumVal}>₹{round2(preview?.subtotal ?? 0).toFixed(2)}</Text>
              </View>
              <View style={styles.sumRow}>
                <Text style={styles.sumLbl}>Tax</Text>
                <Text style={styles.sumVal}>₹{round2(preview?.taxAmount ?? 0).toFixed(2)}</Text>
              </View>
              {discountApplied > 0 ? (
                <View style={styles.sumRow}>
                  <Text style={styles.sumLbl}>Discount</Text>
                  <Text style={styles.discVal}>−₹{discountApplied.toFixed(2)}</Text>
                </View>
              ) : null}
              {isRounded ? (
                <View style={styles.sumRow}>
                  <Text style={styles.sumLbl}>Round off</Text>
                  <Text style={styles.sumVal}>
                    {roundOffAmount > 0 ? '+' : '−'}₹{Math.abs(roundOffAmount).toFixed(2)}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {error ? <HelperText type="error" visible style={styles.error}>{error}</HelperText> : null}
      </ScrollView>

      <BottomBar
        primary={{
          label: loading ? 'Saving…' : 'Save Sale',
          onPress: handlePay,
          icon: 'check-bold',
          disabled: !preview || loading || printing,
          color: colors.secondary,
          flex: 1,
        }}
        secondary={[
          {
            label: printing ? 'Printing…' : 'Print',
            onPress: handlePrint,
            icon: 'printer',
            disabled: !preview || loading || printing,
            flex: 1,
          },
        ]}>
        {change > 0.01 ? (
          <View style={[styles.feedback, styles.feedbackOk]}>
            <Icon name="hand-coin-outline" size={18} color={colors.secondaryDark} />
            <Text style={styles.feedbackOkText}>Return change ₹{change.toFixed(2)}</Text>
          </View>
        ) : balance > 0.01 ? (
          <View style={[styles.feedback, styles.feedbackWarn]}>
            <Icon name="alert-circle-outline" size={18} color={colors.error} />
            <Text style={styles.feedbackWarnText}>Still due ₹{balance.toFixed(2)}</Text>
          </View>
        ) : (
          <View style={[styles.feedback, styles.feedbackOk]}>
            <Icon name="check-circle-outline" size={18} color={colors.secondaryDark} />
            <Text style={styles.feedbackOkText}>Ready to complete · ₹{totalDue.toFixed(2)}</Text>
          </View>
        )}
      </BottomBar>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingText: { marginTop: spacing.md, color: colors.textMuted, fontSize: 15 },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  dueBar: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    marginBottom: spacing.md,
  },
  dueMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  dueLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  dueMeta: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
  },
  dueAmount: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: -0.5,
  },
  dueActions: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surfaceVariant,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  chipOn: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  chipDisabled: { opacity: 0.6 },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.text },
  chipTextOn: { color: colors.primary },
  chipTextMuted: { color: colors.textMuted, fontWeight: '600' },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  modeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  modeBtn: {
    width: '18%',
    minWidth: 58,
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderLight,
  },
  modeBtnOn: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  modeLbl: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
    fontWeight: '600',
  },
  modeLblOn: { color: colors.primary, fontWeight: '700' },
  input: {
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  linkText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  splitBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  splitHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  splitTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  splitLine: { marginTop: spacing.sm },
  splitModes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  splitModeChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceVariant,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  splitModeText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  splitHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: -spacing.xs,
    marginBottom: spacing.xs,
  },
  accordion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    marginBottom: spacing.sm,
  },
  accordionLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 },
  accordionTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.lg,
    marginBottom: spacing.md,
    marginTop: -spacing.xs,
  },
  discModes: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  discMode: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceVariant,
  },
  discModeOn: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  discModeText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  discModeTextOn: { color: colors.primary },
  discActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
  lineBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight },
  lineName: { fontSize: 14, fontWeight: '600', color: colors.text },
  lineMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  lineAmt: { fontSize: 14, fontWeight: '700', color: colors.text, marginLeft: spacing.md },
  miniSum: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    gap: 4,
  },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between' },
  sumLbl: { fontSize: 13, color: colors.textMuted },
  sumVal: { fontSize: 13, fontWeight: '600', color: colors.text },
  discVal: { fontSize: 13, fontWeight: '700', color: colors.secondary },
  error: { marginBottom: spacing.sm },
  feedback: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  feedbackOk: { backgroundColor: colors.secondaryLight },
  feedbackOkText: { fontSize: 14, fontWeight: '700', color: colors.secondaryDark, flex: 1 },
  feedbackWarn: { backgroundColor: colors.errorLight },
  feedbackWarnText: { fontSize: 14, fontWeight: '700', color: colors.error, flex: 1 },
});
