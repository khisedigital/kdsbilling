import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import ListRow from '../../components/ui/ListRow';
import ScreenSearch from '../../components/ui/ScreenSearch';
import SectionCard from '../../components/ui/SectionCard';
import { createDailyClosing, fetchDailyClosings } from '../../services/businessService';
import { apiError } from '../../utils/apiError';
import { colors } from '../../theme/colors';
import { common, radius, spacing, typography } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'DailyClosing'>;

export default function DailyClosingScreen({}: Props) {
  const [openingCash, setOpeningCash] = useState('0');
  const [actualCash, setActualCash] = useState('');
  const [notes, setNotes] = useState('');
  const [closings, setClosings] = useState<Array<Record<string, unknown>>>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const [formError, setFormError] = useState('');

  const loadClosings = async () => {
    try {
      setClosings(await fetchDailyClosings());
    } catch (err) {
      Alert.alert('Load failed', apiError(err, 'Could not load closing history'));
    }
  };

  useEffect(() => { loadClosings(); }, []);

  const filteredClosings = closings.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      String(c.closing_date || '').toLowerCase().includes(q)
      || String(c.total_sales || '').includes(q)
      || String(c.variance || '').includes(q)
      || String(c.notes || '').toLowerCase().includes(q)
    );
  });

  const handleClose = async () => {
    const opening = parseFloat(openingCash);
    const actual = parseFloat(actualCash);
    if (Number.isNaN(opening) || Number.isNaN(actual)) {
      setFormError('Enter valid cash amounts');
      return;
    }
    setLoading(true);
    setFormError('');
    try {
      await createDailyClosing({
        openingCash: parseFloat(openingCash),
        actualCash: parseFloat(actualCash),
        notes,
      });
      setActualCash('');
      await loadClosings();
      Alert.alert('Saved', 'Daily closing recorded.');
    } catch (err) {
      setFormError(apiError(err, 'Could not submit closing'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={common.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={common.screenPad} keyboardShouldPersistTaps="handled">
        <Text style={styles.subtitle}>Reconcile cash at end of day</Text>

        <SectionCard title="Cash count" icon="cash-register">
          <TextInput label="Opening Cash" value={openingCash} onChangeText={setOpeningCash} keyboardType="decimal-pad" mode="outlined" style={styles.input} />
          <TextInput label="Actual Cash Count" value={actualCash} onChangeText={setActualCash} keyboardType="decimal-pad" mode="outlined" style={styles.input} />
          <TextInput label="Notes" value={notes} onChangeText={setNotes} mode="outlined" style={styles.input} />
          {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
          <Button mode="contained" onPress={handleClose} loading={loading} disabled={!actualCash.trim()} icon="check-circle">
            Submit Closing
          </Button>
        </SectionCard>

        <SectionCard title="History" icon="history" subtitle={`${filteredClosings.length} closings`}>
          <ScreenSearch value={search} onChangeText={setSearch} placeholder="Search closing history..." embedded />
          {filteredClosings.map((c) => {
            const variance = parseFloat(String(c.variance));
            const isOver = variance >= 0;
            return (
              <ListRow
                key={c.id as string}
                title={c.closing_date as string}
                subtitle={`Sales ₹${parseFloat(String(c.total_sales)).toFixed(0)}`}
                icon={isOver ? 'check-circle-outline' : 'alert-circle-outline'}
                iconColor={isOver ? colors.secondary : colors.error}
                iconBg={isOver ? colors.secondaryLight : colors.errorLight}
                right={`${isOver ? '+' : ''}₹${(Number.isNaN(variance) ? 0 : variance).toFixed(2)}`}
                showChevron={false}
                style={styles.row}
              />
            );
          })}
          {!filteredClosings.length ? (
            <Text style={typography.bodySm}>{search.trim() ? 'No matching closings' : 'No closing history yet'}</Text>
          ) : null}
        </SectionCard>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  subtitle: { ...typography.bodySm, marginBottom: spacing.xl },
  input: { marginBottom: spacing.md, backgroundColor: colors.surface },
  row: { marginBottom: spacing.xs, borderRadius: radius.md },
  errorText: { color: colors.error, fontSize: 13, marginBottom: spacing.sm },
});
