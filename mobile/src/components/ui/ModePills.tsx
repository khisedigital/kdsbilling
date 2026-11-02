import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/layout';

export type ModeOption<T extends string> = {
  value: T;
  label: string;
  icon: string;
  color?: string;
  bg?: string;
};

type Props<T extends string> = {
  value: T;
  options: ModeOption<T>[];
  onChange: (value: T) => void;
};

export default function ModePills<T extends string>({ value, options, onChange }: Props<T>) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {options.map((opt) => {
        const active = value === opt.value;
        const accent = opt.color || colors.primary;
        const bg = opt.bg || colors.primaryLight;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[styles.pill, active && { backgroundColor: bg, borderColor: accent }]}>
            <Icon name={opt.icon} size={18} color={active ? accent : colors.textMuted} />
            <Text style={[styles.label, active && { color: accent, fontWeight: '700' }]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingVertical: spacing.xs },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  label: { fontSize: 14, color: colors.textMuted },
});
