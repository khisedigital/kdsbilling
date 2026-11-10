import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import AppTextInput from '../../components/ui/AppTextInput';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import ModePills from '../../components/ui/ModePills';
import SectionCard from '../../components/ui/SectionCard';
import { createReturn, fetchBill, fetchBills, type BillDetail } from '../../services/businessService';
import { useT } from '../../i18n';
import { apiError, apiErrorCode } from '../../utils/apiError';
import { canProcessReturn, getBillStatus, itemRemainingQty } from '../../utils/billStatus';
import { colors } from '../../theme/colors';
import { common, radius, spacing } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'Return'>;

type ReturnLine = {
  id: string;
  product_name: string;
  sku: string;
  soldQty: number;
  returnedQty: number;
  remainingQty: number;
  qty: string;
};

function clampQtyInput(raw: string, max: number): string {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return '';
  const n = parseFloat(cleaned);
  if (Number.isNaN(n)) return '';
  if (n > max) return String(max);
  return cleaned;
}

export default function ReturnScreen({ route, navigation }: Props) {
  const t = useT();
  const initialBillId = route.params?.billId || '';
  const [billQuery, setBillQuery] = useState(initialBillId);
  const [bill, setBill] = useState<BillDetail | null>(null);
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [refundMode, setRefundMode] = useState<'cash' | 'store_credit'>('cash');
  const [loading, setLoading] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);

  const applyBill = (found: BillDetail) => {
    setBill(found);
    setBillQuery(found.bill_number);
    setLines(
      (found.items || [])
        .map((item) => {
          const soldQty = parseFloat(String(item.quantity)) || 0;
          const remainingQty = itemRemainingQty(item);
          const returnedQty = Math.max(0, Math.round((soldQty - remainingQty) * 1000) / 1000);
          return {
            id: item.id,
            product_name: item.product_name,
            sku: item.sku,
            soldQty,
            returnedQty,
            remainingQty,
            // Prefill remaining returnable qty for the selected bill.
            qty: remainingQty > 0 ? String(remainingQty) : '',
          };
        })
        .filter((line) => line.remainingQty > 0),
    );
  };

  const loadBill = async (idOrNumber: string) => {
    const q = idOrNumber.trim();
    if (!q) {
      setError(t('Enter a bill number'));
      return;
    }
    setLookingUp(true);
    setError('');
    try {
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      let found: BillDetail;
      if (uuidRe.test(q)) {
        found = await fetchBill(q);
      } else {
        const result = await fetchBills(1, { search: q, limit: 20 });
        const match = (result?.items || []).find(
          (b: BillDetail) => b.bill_number.toLowerCase() === q.toLowerCase(),
        );
        if (!match?.id) {
          setError(t('Bill not found'));
          setBill(null);
          setLines([]);
          return;
        }
        found = await fetchBill(match.id);
      }

      if (!canProcessReturn(found)) {
        setError(
          found.status === 'fully_returned' || !(found.items || []).some((i) => itemRemainingQty(i) > 0)
            ? t('This bill is already fully returned')
            : t('Only completed or partially returned bills can be returned'),
        );
        setBill(found.status === 'fully_returned' || found.status === 'partially_returned' ? found : null);
        setLines([]);
        return;
      }
      applyBill(found);
    } catch (err) {
      setBill(null);
      setLines([]);
      setError(apiError(err, 'Could not load bill'));
    } finally {
      setLookingUp(false);
    }
  };

  useEffect(() => {
    if (initialBillId) loadBill(initialBillId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBillId]);

  const selectedTotalHint = useMemo(() => {
    const selected = lines.filter((l) => parseFloat(l.qty) > 0);
    if (!selected.length) return t('Enter qty up to Max for each item');
    const units = selected.reduce((sum, l) => sum + (parseFloat(l.qty) || 0), 0);
    return t('{{count}} line(s) · {{units}} unit(s) selected', { count: selected.length, units });
  }, [lines, t]);

  const handleReturn = async () => {
    setError('');
    if (submittingRef.current || loading) return;
    if (!bill) {
      setError(t('Look up a completed bill first'));
      return;
    }
    const items = lines
      .map((line) => ({
        salesOrderItemId: line.id,
        quantity: parseFloat(line.qty),
        max: line.remainingQty,
        name: line.product_name,
      }))
      .filter((item) => item.quantity > 0);

    if (!items.length) {
      setError(t('Enter quantity for at least one item'));
      return;
    }
    const over = items.find((item) => item.quantity > item.max + 0.0005);
    if (over) {
      setError(t('{{name}}: max returnable is {{max}}', { name: over.name, max: over.max }));
      return;
    }
    if (refundMode === 'store_credit' && !bill.customer?.id) {
      setError(t('Store credit needs a customer on the original bill'));
      return;
    }

    submittingRef.current = true;
    setLoading(true);
    try {
      const result = await createReturn({
        salesOrderId: bill.id,
        refundMode,
        items: items.map((item) => ({
          salesOrderItemId: item.salesOrderItemId,
          quantity: item.quantity,
        })),
      });
      const cn = result?.credit_note_number || result?.return_number || '';
      Alert.alert(
        t('Credit note saved'),
        cn ? t('{{cn}}\nOpen the bill to see it under Credit notes.', { cn }) : t('Open the bill to see it under Credit notes.'),
        [
          {
            text: t('View bill'),
            onPress: () => navigation.replace('SaleDetail', { billId: bill.id }),
          },
          {
            text: t('Done'),
            style: 'cancel',
            onPress: () => navigation.navigate('ReturnsList'),
          },
        ],
      );
    } catch (err) {
      const code = apiErrorCode(err);
      const message = apiError(err, 'Could not process return');
      setError(message);
      // Refresh remaining qty so the UI matches the server after a rejected / concurrent return.
      try {
        const fresh = await fetchBill(bill.id);
        if (!canProcessReturn(fresh)) {
          setBill(fresh);
          setLines([]);
          setError(
            code === 'ALREADY_RETURNED' || fresh.status === 'fully_returned'
              ? t('This bill is already fully returned')
              : message,
          );
        } else {
          applyBill(fresh);
        }
      } catch {
        // Keep the API error message if refresh fails.
      }
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const status = bill ? getBillStatus(bill.status) : null;

  return (
    <KeyboardAvoidingView style={common.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={common.screenPad} keyboardShouldPersistTaps="handled">
        <SectionCard title={t('Bill')} icon="receipt" subtitle={t('Look up the original sale')}>
          <AppTextInput
            label={t('Bill number')}
            value={billQuery}
            onChangeText={setBillQuery}
            mode="outlined"
            autoFocus={false}
            style={styles.input}
            right={<TextInput.Icon icon="magnify" onPress={() => loadBill(billQuery)} />}
            onSubmitEditing={() => loadBill(billQuery)}
          />
          <Button mode="outlined" onPress={() => loadBill(billQuery)} loading={lookingUp} disabled={!billQuery.trim()}>
            {t('Find bill')}
          </Button>
          {bill ? (
            <View style={styles.billMetaWrap}>
              <Text style={styles.billMeta}>
                {bill.bill_number} · ₹{parseFloat(String(bill.total_amount)).toFixed(2)}
                {bill.customer?.name ? ` · ${bill.customer.name}` : ''}
              </Text>
              {status ? (
                <Text style={[styles.statusPill, { color: status.color, backgroundColor: status.bg }]}>
                  {status.label}
                </Text>
              ) : null}
            </View>
          ) : null}
        </SectionCard>

        {lines.length ? (
          <SectionCard title={t('Items to return')} icon="package-variant" subtitle={selectedTotalHint}>
            {lines.map((line) => (
              <View key={line.id} style={styles.line}>
                <Pressable
                  style={styles.lineInfo}
                  onPress={() => setLines((prev) => prev.map((l) => (
                    l.id === line.id
                      ? { ...l, qty: l.qty === String(l.remainingQty) ? '' : String(l.remainingQty) }
                      : l
                  )))}>
                  <Text style={styles.lineName}>{line.product_name}</Text>
                  <Text style={styles.lineMeta}>
                    {t('Sold {{qty}}', { qty: line.soldQty })}
                    {line.returnedQty > 0 ? t(' · Already returned {{qty}}', { qty: line.returnedQty }) : ''}
                  </Text>
                  <Text style={styles.lineMax}>{t('Max returnable {{qty}}', { qty: line.remainingQty })}</Text>
                  <Text style={styles.lineSku}>{line.sku}</Text>
                </Pressable>
                <AppTextInput
                  label={t('Qty')}
                  value={line.qty}
                  onChangeText={(v) => setLines((prev) => prev.map((l) => (
                    l.id === line.id ? { ...l, qty: clampQtyInput(v, l.remainingQty) } : l
                  )))}
                  keyboardType="decimal-pad"
                  mode="outlined"
                  autoFocus={false}
                  style={styles.qtyInput}
                />
              </View>
            ))}
          </SectionCard>
        ) : null}

        {lines.length ? (
          <SectionCard title={t('Refund mode')} icon="cash-refund">
            <ModePills
              value={refundMode}
              onChange={setRefundMode}
              options={[
                { value: 'cash', label: t('Cash'), icon: 'cash', color: colors.secondary, bg: colors.secondaryLight },
                { value: 'store_credit', label: t('Store credit'), icon: 'wallet-outline', color: colors.primary, bg: colors.primaryLight },
              ]}
            />
          </SectionCard>
        ) : null}

        {error ? <HelperText type="error" style={styles.error}>{error}</HelperText> : null}
        {lines.length ? (
          <Button
            mode="contained"
            onPress={handleReturn}
            loading={loading}
            disabled={!bill || loading}
            icon="undo"
            style={styles.submit}>
            {t('Create credit note')}
          </Button>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  input: { marginBottom: spacing.md, backgroundColor: colors.surface },
  billMetaWrap: { marginTop: spacing.md, gap: spacing.sm },
  billMeta: { fontSize: 13, fontWeight: '600', color: colors.primary },
  statusPill: {
    alignSelf: 'flex-start',
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    fontSize: 12,
    fontWeight: '700',
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  lineInfo: { flex: 1 },
  lineName: { fontSize: 15, fontWeight: '700', color: colors.text },
  lineMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  lineMax: { fontSize: 12, fontWeight: '700', color: colors.primary, marginTop: 2 },
  lineSku: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  qtyInput: { width: 88, backgroundColor: colors.surface },
  error: { marginBottom: spacing.sm },
  submit: { marginTop: spacing.md, borderRadius: radius.md },
});
