import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Button, Dialog, HelperText, Portal, Text } from 'react-native-paper';
import AppTextInput from '../../components/ui/AppTextInput';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import ListRow from '../../components/ui/ListRow';
import SectionCard from '../../components/ui/SectionCard';
import {
  createDailyClosing,
  fetchDailyClosings,
  previewDailyClosing,
  type ClosingPreview,
  type DailyClosingRecord,
} from '../../services/businessService';
import { useAuthStore } from '../../store/authStore';
import { printClosingReport } from '../../print/closingReport';
import { useT } from '../../i18n';
import { apiError } from '../../utils/apiError';
import { colors } from '../../theme/colors';
import { common, dialogCard, radius, spacing, typography } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'DailyClosing'>;

const DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

function money(value: string | number | null | undefined) {
  const n = parseFloat(String(value ?? 0));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function rupee(value: string | number | null | undefined) {
  return `₹${money(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function digitsOnly(value: string) {
  return value.replace(/[^\d]/g, '').slice(0, 6);
}

type DenomCounts = Record<string, string>;

function emptyDenoms(): DenomCounts {
  return Object.fromEntries(DENOMS.map((d) => [String(d), '']));
}

export default function DailyClosingScreen({}: Props) {
  const t = useT();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);

  const [preview, setPreview] = useState<ClosingPreview | null>(null);
  const [history, setHistory] = useState<DailyClosingRecord[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [openingCash, setOpeningCash] = useState('0');
  const [cashAdded, setCashAdded] = useState('0');
  const [denomCounts, setDenomCounts] = useState<DenomCounts>(emptyDenoms);
  const [remarks, setRemarks] = useState('');
  const [varianceReason, setVarianceReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastClosed, setLastClosed] = useState<DailyClosingRecord | null>(null);

  const load = useCallback(async () => {
    const [nextPreview, closings] = await Promise.all([
      previewDailyClosing(),
      fetchDailyClosings().catch(() => [] as DailyClosingRecord[]),
    ]);
    setPreview(nextPreview);
    setHistory(closings || []);
    if (!nextPreview.alreadyClosed) {
      setOpeningCash(String(nextPreview.suggestedOpeningCash || 0));
    }
  }, []);

  useEffect(() => {
    setLoadingPreview(true);
    load()
      .catch((err) => Alert.alert(t('Load failed'), apiError(err, t('Could not load closing data'))))
      .finally(() => setLoadingPreview(false));
  }, [load, t]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } catch (err) {
      Alert.alert(t('Load failed'), apiError(err, t('Could not load closing data')));
    } finally {
      setRefreshing(false);
    }
  };

  const opening = money(openingCash);
  const added = money(cashAdded);
  const cashSales = preview?.cashSales || 0;
  const cashRefunds = preview?.cashRefunds || 0;
  const cashExpenses = preview?.cashExpenses || 0;
  const expectedCash = money(opening + cashSales + added - cashRefunds - cashExpenses);

  const denomTotals = useMemo(() => {
    const lines = DENOMS.map((face) => {
      const qty = parseInt(denomCounts[String(face)] || '0', 10) || 0;
      return { face, qty, total: face * qty };
    });
    const actual = lines.reduce((sum, line) => sum + line.total, 0);
    return { lines, actual };
  }, [denomCounts]);

  const actualCash = denomTotals.actual;
  const difference = money(actualCash - expectedCash);
  const matched = Math.abs(difference) < 0.01;
  const shortage = difference < -0.009;
  const excess = difference > 0.009;

  const setDenomQty = (face: number, value: string) => {
    setDenomCounts((prev) => ({ ...prev, [String(face)]: digitsOnly(value) }));
  };

  const alreadyClosed = Boolean(preview?.alreadyClosed);
  const canSubmit =
    !alreadyClosed && !saving && (matched || varianceReason.trim().length > 0);

  const openConfirm = () => {
    setFormError('');
    if (alreadyClosed) {
      setFormError(t('This register is already closed for today'));
      return;
    }
    if (!matched && !varianceReason.trim()) {
      setFormError(t('Please enter a reason when cash does not match'));
      return;
    }
    setConfirmOpen(true);
  };

  const submitClosing = async () => {
    setSaving(true);
    setFormError('');
    try {
      const denominations: Record<string, number> = {};
      for (const face of DENOMS) {
        const qty = parseInt(denomCounts[String(face)] || '0', 10) || 0;
        if (qty > 0) denominations[String(face)] = qty;
      }
      const saved = await createDailyClosing({
        openingCash: opening,
        cashAdded: added,
        actualCash,
        notes: remarks.trim() || undefined,
        varianceReason: matched ? undefined : varianceReason.trim(),
        denominations,
        closingDate: preview?.closingDate,
      });
      setConfirmOpen(false);
      setLastClosed(saved);
      setDenomCounts(emptyDenoms());
      setCashAdded('0');
      setRemarks('');
      setVarianceReason('');
      await load();
    } catch (err) {
      setConfirmOpen(false);
      setFormError(apiError(err, t('Could not close register')));
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = async (closing: DailyClosingRecord) => {
    try {
      await printClosingReport({
        shopName: tenant?.name || 'Shop',
        branchName: user?.branch?.name || undefined,
        closing,
      });
    } catch (err) {
      Alert.alert(t('Print failed'), apiError(err, t('Could not print closing report')));
    }
  };

  const statusLabel = matched
    ? t('Cash matched')
    : shortage
      ? t('Cash shortage')
      : t('Cash excess');
  const statusColor = matched ? colors.secondary : shortage ? colors.error : colors.warning;
  const statusBg = matched ? colors.secondaryLight : shortage ? colors.errorLight : colors.warningLight;

  if (loadingPreview && !preview) {
    return (
      <View style={[common.screen, styles.center]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.loadingText}>{t('Loading today\'s numbers…')}</Text>
      </View>
    );
  }

  const salesCard = (
    <SectionCard
      title={t("Today's sales")}
      icon="chart-bar"
      subtitle={preview?.closingDate || t('Today')}
      iconColor={colors.primary}
      iconBg={colors.primaryLight}>
      <View style={styles.heroSales}>
        <Text style={styles.heroLabel}>{t('Total sales')}</Text>
        <Text style={styles.heroValue}>{rupee(preview?.totalSales)}</Text>
      </View>
      <View style={styles.payGrid}>
        {[
          { key: 'cash', label: t('Cash'), value: preview?.payments.cash, tip: t('Goes in the drawer') },
          { key: 'upi', label: t('UPI'), value: preview?.payments.upi, tip: t('Not physical cash') },
          { key: 'card', label: t('Card'), value: preview?.payments.card, tip: t('Not physical cash') },
          { key: 'other', label: t('Other'), value: preview?.payments.other, tip: t('Not physical cash') },
        ].map((item) => (
          <View key={item.key} style={styles.payTile}>
            <Text style={styles.payLabel}>{item.label}</Text>
            <Text style={styles.payValue}>{rupee(item.value)}</Text>
            <Text style={styles.payTip}>{item.tip}</Text>
          </View>
        ))}
      </View>
    </SectionCard>
  );

  const expectedCard = (
    <SectionCard
      title={t('Cash that should be in the drawer')}
      icon="safe"
      subtitle={t('Opening + cash sales − refunds − expenses')}
      iconColor={colors.secondary}
      iconBg={colors.secondaryLight}>
      <View style={styles.inputRow}>
        <AppTextInput
          label={t('Opening cash')}
          value={openingCash}
          onChangeText={setOpeningCash}
          keyboardType="decimal-pad"
          mode="outlined"
          style={[styles.input, styles.half]}
          disabled={alreadyClosed}
        />
        <AppTextInput
          label={t('Cash added today')}
          value={cashAdded}
          onChangeText={setCashAdded}
          keyboardType="decimal-pad"
          mode="outlined"
          style={[styles.input, styles.half]}
          disabled={alreadyClosed}
        />
      </View>
      {preview?.previousClosingDate ? (
        <Text style={styles.hint}>
          {t('Suggested from last close on {{date}}', { date: preview.previousClosingDate })}
        </Text>
      ) : (
        <Text style={styles.hint}>{t('Enter the cash you started the day with')}</Text>
      )}

      <View style={styles.calcList}>
        <CalcRow label={t('Opening cash')} value={opening} />
        <CalcRow label={t('+ Cash sales')} value={cashSales} />
        <CalcRow label={t('+ Cash added')} value={added} />
        <CalcRow label={t('− Cash refunds')} value={cashRefunds} negative />
        <CalcRow label={t('− Cash expenses')} value={cashExpenses} negative />
      </View>

      <View style={styles.expectedBox}>
        <Text style={styles.expectedLabel}>{t('Expected cash')}</Text>
        <Text style={styles.expectedValue}>{rupee(expectedCash)}</Text>
      </View>
    </SectionCard>
  );

  const countCard = (
    <SectionCard
      title={t('Count the cash')}
      icon="cash-multiple"
      subtitle={t('Enter how many notes/coins of each type')}
      iconColor={colors.accent}
      iconBg={colors.accentLight}>
      <View style={styles.denomList}>
        {DENOMS.map((face) => {
          const qty = parseInt(denomCounts[String(face)] || '0', 10) || 0;
          const lineTotal = face * qty;
          return (
            <View key={face} style={styles.denomRow}>
              <View style={styles.denomFace}>
                <Text style={styles.denomFaceText}>₹{face}</Text>
              </View>
              <AppTextInput
                value={denomCounts[String(face)]}
                onChangeText={(value) => setDenomQty(face, value)}
                keyboardType="number-pad"
                mode="outlined"
                dense
                placeholder="0"
                style={styles.denomInput}
                disabled={alreadyClosed}
              />
              <Text style={styles.denomTotal}>{lineTotal ? rupee(lineTotal) : '—'}</Text>
            </View>
          );
        })}
      </View>
      <View style={styles.actualBox}>
        <Text style={styles.actualLabel}>{t('Cash counted')}</Text>
        <Text style={styles.actualValue}>{rupee(actualCash)}</Text>
      </View>
    </SectionCard>
  );

  const resultCard = (
    <SectionCard title={t('Does the cash match?')} icon="scale-balance">
      <View style={[styles.statusBanner, { backgroundColor: statusBg }]}>
        <Icon
          name={matched ? 'check-circle' : shortage ? 'alert-circle' : 'cash-plus'}
          size={28}
          color={statusColor}
        />
        <View style={styles.statusTextWrap}>
          <Text style={[styles.statusTitle, { color: statusColor }]}>{statusLabel}</Text>
          <Text style={styles.statusSub}>
            {t('Expected {{expected}} · Counted {{actual}}', {
              expected: rupee(expectedCash),
              actual: rupee(actualCash),
            })}
          </Text>
        </View>
        <Text style={[styles.diffValue, { color: statusColor }]}>
          {difference >= 0 ? '+' : ''}
          {rupee(difference)}
        </Text>
      </View>

      {!matched ? (
        <AppTextInput
          label={t('Why is the cash different?')}
          value={varianceReason}
          onChangeText={setVarianceReason}
          mode="outlined"
          style={styles.input}
          multiline
          disabled={alreadyClosed}
          placeholder={t('Example: short change, missing note, tip float')}
        />
      ) : null}

      <AppTextInput
        label={t('Closing remarks (optional)')}
        value={remarks}
        onChangeText={setRemarks}
        mode="outlined"
        style={styles.input}
        multiline
        disabled={alreadyClosed}
      />

      {formError ? <HelperText type="error" visible>{formError}</HelperText> : null}

      {alreadyClosed ? (
        <View style={styles.closedBox}>
          <Icon name="lock-check" size={22} color={colors.secondary} />
          <Text style={styles.closedText}>
            {t('Register already closed for {{date}}', { date: preview?.closingDate || t('today') })}
          </Text>
        </View>
      ) : (
        <Button
          mode="contained"
          icon="cash-register"
          onPress={openConfirm}
          loading={saving}
          disabled={!canSubmit}
          contentStyle={styles.closeBtnContent}
          style={styles.closeBtn}>
          {t('Close register')}
        </Button>
      )}

      {lastClosed ? (
        <Button
          mode="outlined"
          icon="printer-outline"
          onPress={() => handlePrint(lastClosed)}
          style={styles.printBtn}>
          {t('Print closing report')}
        </Button>
      ) : null}
    </SectionCard>
  );

  return (
    <KeyboardAvoidingView style={common.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={common.screenPad}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }>
        <Text style={styles.pageTitle}>{t('Close Register')}</Text>
        <Text style={styles.subtitle}>
          {t('Count the cash in the drawer and check it matches today\'s cash sales')}
        </Text>
        {user?.name ? (
          <Text style={styles.cashier}>{t('Cashier')}: {user.name}</Text>
        ) : null}

        {wide ? (
          <View style={styles.columns}>
            <View style={styles.col}>{salesCard}{expectedCard}</View>
            <View style={styles.col}>{countCard}{resultCard}</View>
          </View>
        ) : (
          <>
            {salesCard}
            {expectedCard}
            {countCard}
            {resultCard}
          </>
        )}

        <SectionCard
          title={t('Recent closings')}
          icon="history"
          subtitle={t('{{count}} records', { count: history.length })}>
          {history.map((c) => {
            const variance = money(c.variance);
            const ok = Math.abs(variance) < 0.01;
            return (
              <ListRow
                key={c.id}
                title={c.closing_date}
                subtitle={`${t('Sales')} ${rupee(c.total_sales)}${c.creator?.name ? ` · ${c.creator.name}` : ''}`}
                icon={ok ? 'check-circle-outline' : 'alert-circle-outline'}
                iconColor={ok ? colors.secondary : colors.error}
                iconBg={ok ? colors.secondaryLight : colors.errorLight}
                right={`${variance >= 0 ? '+' : ''}${rupee(variance)}`}
                showChevron={false}
                onPress={() => handlePrint(c)}
                style={styles.historyRow}
              />
            );
          })}
          {!history.length ? (
            <Text style={typography.bodySm}>{t('No closing history yet')}</Text>
          ) : (
            <Text style={styles.hint}>{t('Tap a row to print its closing report')}</Text>
          )}
        </SectionCard>
      </ScrollView>

      <Portal>
        <Dialog visible={confirmOpen} onDismiss={() => !saving && setConfirmOpen(false)} style={styles.dialog}>
          <Dialog.Title>{t('Confirm close register')}</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.confirmLine}>{t('Expected cash')}: {rupee(expectedCash)}</Text>
            <Text style={styles.confirmLine}>{t('Cash counted')}: {rupee(actualCash)}</Text>
            <Text style={[styles.confirmDiff, { color: statusColor }]}>
              {statusLabel}: {difference >= 0 ? '+' : ''}{rupee(difference)}
            </Text>
            {!matched && varianceReason.trim() ? (
              <Text style={styles.confirmReason}>{t('Reason')}: {varianceReason.trim()}</Text>
            ) : null}
            <Text style={styles.confirmWarn}>
              {t('After closing, today\'s register cannot be edited.')}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmOpen(false)} disabled={saving}>{t('Cancel')}</Button>
            <Button mode="contained" onPress={submitClosing} loading={saving}>
              {t('Confirm & close')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </KeyboardAvoidingView>
  );
}

function CalcRow({
  label,
  value,
  negative,
}: {
  label: string;
  value: number;
  negative?: boolean;
}) {
  return (
    <View style={styles.calcRow}>
      <Text style={styles.calcLabel}>{label}</Text>
      <Text style={[styles.calcValue, negative && value > 0 ? styles.calcNeg : null]}>
        {rupee(value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  loadingText: { ...typography.bodySm },
  pageTitle: { ...typography.h1, fontSize: 24, marginBottom: 4 },
  subtitle: { ...typography.bodySm, marginBottom: spacing.sm },
  cashier: { ...typography.caption, marginBottom: spacing.lg },
  columns: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  col: { flex: 1, minWidth: 0, gap: 0 },
  heroSales: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  heroLabel: { fontSize: 13, fontWeight: '600', color: colors.primary },
  heroValue: { fontSize: 32, fontWeight: '800', color: colors.primary, marginTop: 4 },
  payGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  payTile: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  payLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  payValue: { fontSize: 18, fontWeight: '800', color: colors.text, marginTop: 4 },
  payTip: { ...typography.caption, marginTop: 4 },
  input: { marginBottom: spacing.sm, backgroundColor: colors.surface },
  inputRow: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
  hint: { ...typography.caption, marginBottom: spacing.md },
  calcList: { marginBottom: spacing.md },
  calcRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  calcLabel: { fontSize: 14, color: colors.textSecondary },
  calcValue: { fontSize: 14, fontWeight: '700', color: colors.text },
  calcNeg: { color: colors.error },
  expectedBox: {
    backgroundColor: colors.secondaryLight,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
  },
  expectedLabel: { fontSize: 13, fontWeight: '700', color: colors.secondary },
  expectedValue: { fontSize: 30, fontWeight: '800', color: colors.secondary, marginTop: 4 },
  denomList: { gap: spacing.xs, marginBottom: spacing.md },
  denomRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  denomFace: {
    width: 64,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  denomFaceText: { fontSize: 15, fontWeight: '800', color: colors.text },
  denomInput: {
    flex: 1,
    backgroundColor: colors.surface,
    minHeight: 44,
    fontSize: 18,
    fontWeight: '700',
  },
  denomTotal: { width: 88, textAlign: 'right', fontSize: 14, fontWeight: '700', color: colors.text },
  actualBox: {
    backgroundColor: colors.accentLight,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
  },
  actualLabel: { fontSize: 13, fontWeight: '700', color: '#92400E' },
  actualValue: { fontSize: 30, fontWeight: '800', color: '#92400E', marginTop: 4 },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  statusTextWrap: { flex: 1 },
  statusTitle: { fontSize: 18, fontWeight: '800' },
  statusSub: { ...typography.caption, marginTop: 2 },
  diffValue: { fontSize: 22, fontWeight: '800' },
  closeBtn: { borderRadius: radius.md, marginTop: spacing.sm },
  closeBtnContent: { minHeight: 52 },
  printBtn: { marginTop: spacing.sm, borderRadius: radius.md },
  closedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.secondaryLight,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  closedText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.secondary },
  historyRow: { marginBottom: spacing.xs, borderRadius: radius.md },
  dialog: { ...dialogCard },
  confirmLine: { fontSize: 15, marginBottom: 6, color: colors.text },
  confirmDiff: { fontSize: 18, fontWeight: '800', marginVertical: spacing.sm },
  confirmReason: { ...typography.bodySm, marginBottom: spacing.sm },
  confirmWarn: { ...typography.caption, color: colors.warning },
});
