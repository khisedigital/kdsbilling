import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Searchbar } from 'react-native-paper';
import { useT } from '../../i18n';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/layout';

type Props = {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  loading?: boolean;
  /** Removes outer padding when used inside a card/section */
  embedded?: boolean;
};

export default function ScreenSearch({
  value,
  onChangeText,
  placeholder = 'Search...',
  onSubmit,
  loading,
  embedded,
}: Props) {
  const t = useT();
  return (
    <View style={[styles.wrap, embedded && styles.embedded]}>
      <Searchbar
        placeholder={t(placeholder)}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        onIconPress={onSubmit}
        loading={loading}
        iconColor={colors.primary}
        style={styles.search}
        inputStyle={styles.input}
        elevation={0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  embedded: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: spacing.md },
  search: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: { fontSize: 15, minHeight: 0 },
});
