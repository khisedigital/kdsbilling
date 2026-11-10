import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme/colors';
import { radius, shadow, spacing } from '../../theme/layout';

type Action = {
  label: string;
  onPress: () => void;
  icon?: string;
  mode?: 'contained' | 'outlined' | 'text';
  color?: string;
  disabled?: boolean;
  loading?: boolean;
  flex?: number;
};

type Props = {
  children?: React.ReactNode;
  primary: Action;
  secondary?: Action[];
};

export default function BottomBar({ children, primary, secondary = [] }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      {children}
      <View style={styles.row}>
        {secondary.map((a) => (
          <Button
            key={a.label}
            mode={a.mode || 'outlined'}
            onPress={a.onPress}
            icon={a.icon}
            disabled={a.disabled}
            loading={a.loading}
            style={[styles.secBtn, a.flex ? { flex: a.flex } : undefined]}
            compact>
            {a.label}
          </Button>
        ))}
        <Button
          mode="contained"
          onPress={primary.onPress}
          icon={primary.icon}
          disabled={primary.disabled}
          loading={primary.loading}
          buttonColor={primary.color || colors.secondary}
          style={[styles.primaryBtn, primary.flex !== undefined ? { flex: primary.flex } : { flex: 1 }]}
          contentStyle={styles.primaryContent}
          labelStyle={styles.primaryLabel}>
          {primary.label}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    ...shadow.lg,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  secBtn: { borderRadius: radius.md, borderColor: colors.border },
  primaryBtn: { borderRadius: radius.md },
  primaryContent: { paddingVertical: spacing.sm + 2 },
  primaryLabel: { fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
});
