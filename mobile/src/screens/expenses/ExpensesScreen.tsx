import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, FAB, Portal, Text } from 'react-native-paper';
import AppTextInput from '../../components/ui/AppTextInput';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import ReportPeriodFilter from '../../components/reports/ReportPeriodFilter';
import ListRow from '../../components/ui/ListRow';
import ScreenSearch from '../../components/ui/ScreenSearch';
import {
  rangeForPeriod,
  shiftAnchor,
  type PeriodMode,
} from '../../reports/reportDates';
import { createExpense, fetchExpenseCategories, fetchExpenses } from '../../services/businessService';
import { useT } from '../../i18n';
import { apiError } from '../../utils/apiError';
import { colors } from '../../theme/colors';
import { common, radius, spacing, typography, dialogCard} from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'Expenses'>;

type ExpenseRow = {
  id: string;
  amount: number;
  expense_date: string;
  category?: { name: string };
};

export default function ExpensesScreen({}: Props) {
  const t = useT();
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [search, setSearch] = useState('');
  const [periodMode, setPeriodMode] = useState<PeriodMode>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [addOpen, setAddOpen] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [formError, setFormError] = useState('');

  const range = useMemo(() => rangeForPeriod(periodMode, anchor), [periodMode, anchor]);

  const loadCategories = useCallback(async () => {
    try {
      setCategories(await fetchExpenseCategories());
    } catch (err) {
      setCategories([]);
      Alert.alert(t('Categories failed'), apiError(err, t('Could not load expense categories')));
    }
  }, [t]);

  const loadExpenses = useCallback(async () => {
    setListLoading(true);
    try {
      setExpenses(await fetchExpenses({ from: range.from, to: range.to, limit: 500 }));
    } catch (err) {
      setExpenses([]);
      Alert.alert(t('Load failed'), apiError(err, t('Could not load expenses')));
    } finally {
      setListLoading(false);
    }
  }, [range.from, range.to, t]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  const filteredExpenses = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return expenses;
    return expenses.filter(
      (e) =>
        (e.category?.name || '').toLowerCase().includes(q)
        || (e.expense_date || '').toLowerCase().includes(q)
        || String(e.amount).includes(q),
    );
  }, [expenses, search]);

  const periodTotal = useMemo(
    () => filteredExpenses.reduce((sum, e) => sum + (parseFloat(String(e.amount)) || 0), 0),
    [filteredExpenses],
  );

  const openAdd = () => {
    setCategoryId('');
    setAmount('');
    setNotes('');
    setFormError('');
    setAddOpen(true);
    if (!categories.length) loadCategories();
  };

  const handleSave = async () => {
    if (!categoryId || !amount) return;
    setLoading(true);
    setFormError('');
    try {
      await createExpense({ categoryId, amount: parseFloat(amount), notes });
      setAddOpen(false);
      setAmount('');
      setNotes('');
      setCategoryId('');
      await loadExpenses();
    } catch (err) {
      setFormError(apiError(err, t('Could not save expense')));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={common.screen}>
      <View style={styles.filters}>
        <ReportPeriodFilter
          mode={periodMode}
          anchor={anchor}
          onModeChange={setPeriodMode}
          onAnchorChange={setAnchor}
          onShift={(delta) => setAnchor((prev) => shiftAnchor(periodMode, prev, delta))}
        />
        <ScreenSearch value={search} onChangeText={setSearch} placeholder={t('Search expenses...')} embedded />
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>
            {listLoading
              ? t('Loading…')
              : filteredExpenses.length === 1
                ? t('{{count}} expense', { count: filteredExpenses.length })
                : t('{{count}} expenses', { count: filteredExpenses.length })}
          </Text>
          <Text style={styles.summaryTotal}>₹{periodTotal.toFixed(2)}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[common.listContent, !filteredExpenses.length && styles.emptyList]}
        keyboardShouldPersistTaps="handled">
        {filteredExpenses.map((e) => (
          <ListRow
            key={e.id}
            title={e.category?.name || t('Expense')}
            subtitle={e.expense_date}
            icon="receipt"
            right={`₹${parseFloat(String(e.amount)).toFixed(2)}`}
            showChevron={false}
            style={styles.row}
          />
        ))}
        {!listLoading && !filteredExpenses.length ? (
          <Text style={styles.emptyText}>
            {search.trim()
              ? t('No matching expenses in this period')
              : t('No expenses in this period. Tap + to add one.')}
          </Text>
        ) : null}
      </ScrollView>

      <FAB
        icon="plus"
        label={t('Add')}
        style={common.fab}
        color={colors.textOnPrimary}
        onPress={openAdd}
      />

      <Portal>
        <Dialog visible={addOpen} onDismiss={() => setAddOpen(false)} style={styles.dialog}>
          <Dialog.Title>{t('Add expense')}</Dialog.Title>
          <Dialog.ScrollArea style={styles.dialogScroll}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>{t('Category')}</Text>
              <View style={styles.catWrap}>
                {categories.map((c) => (
                  <Button
                    key={c.id}
                    mode={categoryId === c.id ? 'contained' : 'outlined'}
                    onPress={() => setCategoryId(c.id)}
                    style={styles.catBtn}
                    compact
                    buttonColor={categoryId === c.id ? colors.primary : undefined}>
                    {c.name}
                  </Button>
                ))}
              </View>
              <AppTextInput
                label={t('Amount')}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                mode="outlined"
                autoFocus={false}
                style={styles.input}
              />
              <AppTextInput
                label={t('Notes')}
                value={notes}
                onChangeText={setNotes}
                mode="outlined"
                autoFocus={false}
                style={styles.input}
              />
              {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setAddOpen(false)}>{t('Cancel')}</Button>
            <Button
              onPress={handleSave}
              loading={loading}
              disabled={!categoryId || !amount || loading}>
              {t('Save')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  filters: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.md,
  },
  summaryLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  summaryTotal: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.error,
  },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  emptyText: { ...typography.bodySm, textAlign: 'center', paddingHorizontal: spacing.lg },
  row: { marginBottom: spacing.xs, borderRadius: radius.md },
  dialog: { ...dialogCard },
  dialogScroll: { maxHeight: 360, paddingHorizontal: 0 },
  label: { ...typography.label, marginBottom: spacing.sm, paddingHorizontal: spacing.lg },
  catWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  catBtn: { borderRadius: radius.full },
  input: { marginBottom: spacing.md, marginHorizontal: spacing.lg, backgroundColor: colors.surface },
  errorText: { color: colors.error, fontSize: 13, marginBottom: spacing.sm, paddingHorizontal: spacing.lg },
});
