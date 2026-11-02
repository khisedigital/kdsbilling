import React from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { colors } from '../../theme/colors';
import { radius, shadow, spacing } from '../../theme/layout';

type Props = {
  children: React.ReactNode;
  style?: ViewStyle;
  elevated?: boolean;
  padding?: boolean;
  onPress?: () => void;
};

export default function SurfaceCard({ children, style, elevated, padding = true, onPress }: Props) {
  const content = (
    <View style={[styles.card, elevated && shadow.md, padding && styles.pad, style]}>
      {children}
    </View>
  );
  if (onPress) {
    return <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>{content}</Pressable>;
  }
  return content;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    marginBottom: spacing.md,
    overflow: 'hidden',
    ...shadow.sm,
  },
  pad: { padding: spacing.lg },
  pressed: { opacity: 0.92 },
});
