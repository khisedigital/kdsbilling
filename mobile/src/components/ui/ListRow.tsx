import React from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors } from '../../theme/colors';
import { radius, shadow, spacing } from '../../theme/layout';

type Props = {
  title: string;
  subtitle?: string;
  right?: string | React.ReactNode;
  icon?: string;
  iconColor?: string;
  iconBg?: string;
  badge?: { label: string; color: string; bg: string };
  onPress?: () => void;
  onLongPress?: () => void;
  style?: ViewStyle;
  showChevron?: boolean;
  /** Action rendered outside the row press target. */
  trailing?: React.ReactNode;
};

export default function ListRow({
  title,
  subtitle,
  right,
  icon = 'circle-outline',
  iconColor = colors.primary,
  iconBg = colors.primaryLight,
  badge,
  onPress,
  onLongPress,
  style,
  showChevron = !!onPress,
  trailing,
}: Props) {
  const content = (
    <>
      <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
        <Icon name={icon} size={20} color={iconColor} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {badge ? (
            <View style={[styles.badge, { backgroundColor: badge.bg }]}>
              <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
            </View>
          ) : null}
        </View>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right != null ? (
        typeof right === 'string' ? <Text style={styles.right}>{right}</Text> : right
      ) : null}
      {showChevron && onPress ? (
        <Icon name="chevron-right" size={20} color={colors.border} style={styles.chevron} />
      ) : null}
    </>
  );

  const main = onPress || onLongPress ? (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}>
      {content}
    </Pressable>
  ) : (
    <View style={styles.pressable}>{content}</View>
  );

  return (
    <View style={[styles.row, style]}>
      {main}
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  pressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  trailing: { marginLeft: spacing.sm, justifyContent: 'center' },
  pressed: { opacity: 0.9 },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  body: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: 15, fontWeight: '600', color: colors.text, flexShrink: 1 },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 3, lineHeight: 16 },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  badgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  right: { fontSize: 16, fontWeight: '700', color: colors.secondary, marginLeft: spacing.sm },
  chevron: { marginLeft: spacing.xs },
});
