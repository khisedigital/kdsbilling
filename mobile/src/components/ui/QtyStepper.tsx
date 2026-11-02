import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/layout';

type Props = {
  value: string | number;
  onDecrease: () => void;
  onIncrease: () => void;
  onPressValue?: () => void;
  hint?: string;
};

export default function QtyStepper({ value, onDecrease, onIncrease, onPressValue, hint }: Props) {
  const ValueWrap = onPressValue ? Pressable : View;

  return (
    <View style={styles.wrap}>
      <Pressable onPress={onDecrease} style={styles.btn} hitSlop={8}>
        <Icon name="minus" size={18} color={colors.primary} />
      </Pressable>
      <ValueWrap onPress={onPressValue} style={styles.valueWrap}>
        <Text style={[styles.value, onPressValue ? styles.valueEditable : null]}>{value}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </ValueWrap>
      <Pressable onPress={onIncrease} style={styles.btn} hitSlop={8}>
        <Icon name="plus" size={18} color={colors.primary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xs,
  },
  btn: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueWrap: {
    minWidth: 56,
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  value: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
  },
  valueEditable: {
    textDecorationLine: 'underline',
    textDecorationColor: colors.primaryLight,
  },
  hint: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 1,
  },
});
