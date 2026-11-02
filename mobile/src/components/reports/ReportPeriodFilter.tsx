import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  MONTH_NAMES,
  formatPeriodLabel,
  type PeriodMode,
  toDateString,
} from '../../reports/reportDates';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/layout';

type Props = {
  mode: PeriodMode;
  anchor: Date;
  onModeChange: (mode: PeriodMode) => void;
  onAnchorChange: (date: Date) => void;
  onShift: (delta: number) => void;
};

const MODES: Array<{ id: PeriodMode; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
];

export default function ReportPeriodFilter({
  mode,
  anchor,
  onModeChange,
  onAnchorChange,
  onShift,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftYear, setDraftYear] = useState(anchor.getFullYear());
  const [draftMonth, setDraftMonth] = useState(anchor.getMonth());
  const [draftDay, setDraftDay] = useState(anchor.getDate());

  const label = useMemo(() => formatPeriodLabel(mode, { from: '', to: '' }, anchor), [mode, anchor]);

  const openPicker = () => {
    setDraftYear(anchor.getFullYear());
    setDraftMonth(anchor.getMonth());
    setDraftDay(anchor.getDate());
    setPickerOpen(true);
  };

  const daysInMonth = new Date(draftYear, draftMonth + 1, 0).getDate();
  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    const years: number[] = [];
    for (let y = current; y >= current - 10; y -= 1) years.push(y);
    return years;
  }, []);

  const applyPicker = () => {
    const day = Math.min(draftDay, new Date(draftYear, draftMonth + 1, 0).getDate());
    if (mode === 'year') {
      onAnchorChange(new Date(draftYear, 0, 1));
    } else if (mode === 'month') {
      onAnchorChange(new Date(draftYear, draftMonth, 1));
    } else {
      onAnchorChange(new Date(draftYear, draftMonth, day));
    }
    setPickerOpen(false);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.modeRow}>
        {MODES.map((item) => {
          const on = mode === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => onModeChange(item.id)}
              style={[styles.modeChip, on && styles.modeChipOn]}>
              <Text style={[styles.modeText, on && styles.modeTextOn]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.navRow}>
        <Pressable onPress={() => onShift(-1)} style={styles.navBtn} hitSlop={8}>
          <Icon name="chevron-left" size={22} color={colors.primary} />
        </Pressable>
        <Pressable onPress={openPicker} style={styles.periodBtn}>
          <Icon name="calendar-month" size={18} color={colors.primary} />
          <Text style={styles.periodText} numberOfLines={1}>{label}</Text>
          <Icon name="menu-down" size={18} color={colors.textMuted} />
        </Pressable>
        <Pressable onPress={() => onShift(1)} style={styles.navBtn} hitSlop={8}>
          <Icon name="chevron-right" size={22} color={colors.primary} />
        </Pressable>
      </View>

      <Portal>
        <Dialog visible={pickerOpen} onDismiss={() => setPickerOpen(false)} style={styles.dialog}>
          <Dialog.Title>
            {mode === 'day' ? 'Select date' : mode === 'month' ? 'Select month' : 'Select year'}
          </Dialog.Title>
          <Dialog.ScrollArea style={styles.dialogScroll}>
            <ScrollView>
              <Text style={styles.pickerLabel}>Year</Text>
              <View style={styles.optionGrid}>
                {yearOptions.map((year) => {
                  const on = draftYear === year;
                  return (
                    <Pressable
                      key={year}
                      onPress={() => setDraftYear(year)}
                      style={[styles.optionChip, on && styles.optionChipOn]}>
                      <Text style={[styles.optionText, on && styles.optionTextOn]}>{year}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {mode !== 'year' ? (
                <>
                  <Text style={styles.pickerLabel}>Month</Text>
                  <View style={styles.optionGrid}>
                    {MONTH_NAMES.map((name, index) => {
                      const on = draftMonth === index;
                      return (
                        <Pressable
                          key={name}
                          onPress={() => setDraftMonth(index)}
                          style={[styles.optionChip, styles.monthChip, on && styles.optionChipOn]}>
                          <Text style={[styles.optionText, on && styles.optionTextOn]}>
                            {name.slice(0, 3)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}

              {mode === 'day' ? (
                <>
                  <Text style={styles.pickerLabel}>Date</Text>
                  <View style={styles.optionGrid}>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                      const on = draftDay === day;
                      return (
                        <Pressable
                          key={day}
                          onPress={() => setDraftDay(day)}
                          style={[styles.optionChip, styles.dayChip, on && styles.optionChipOn]}>
                          <Text style={[styles.optionText, on && styles.optionTextOn]}>{day}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}

              <Text style={styles.preview}>
                Selected:{' '}
                {mode === 'year'
                  ? String(draftYear)
                  : mode === 'month'
                    ? `${MONTH_NAMES[draftMonth]} ${draftYear}`
                    : toDateString(new Date(draftYear, draftMonth, Math.min(draftDay, daysInMonth)))}
              </Text>
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setPickerOpen(false)}>Cancel</Button>
            <Button onPress={applyPicker}>Apply</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modeChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceVariant,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  modeChipOn: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  modeText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modeTextOn: { color: colors.primary },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  navBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodBtn: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  periodText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  dialog: { borderRadius: radius.lg, maxHeight: '80%' },
  dialogScroll: { maxHeight: 420, paddingHorizontal: 0 },
  pickerLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  optionChip: {
    minWidth: 64,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  monthChip: { minWidth: 56 },
  dayChip: { minWidth: 44 },
  optionChipOn: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  optionText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  optionTextOn: { color: colors.primary },
  preview: {
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    fontSize: 13,
    color: colors.textMuted,
  },
});
