import React, { memo } from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors } from '../../theme/colors';
import { radius, shadow, spacing } from '../../theme/layout';

type Props = {
  title: string;
  subtitle?: string;
  right?: string | React.ReactNode;
  icon?: string | null;
  iconColor?: string;
  iconBg?: string;
  badge?: { label: string; color: string; bg: string };
  /** Put status badge under the right column so the title can use full width. */
  badgeAlign?: 'title' | 'right';
  onPress?: () => void;
  onLongPress?: () => void;
  style?: ViewStyle;
  showChevron?: boolean;
  /** Action rendered outside the row press target. */
  trailing?: React.ReactNode;
  /** Product names need room — default 2 lines. */
  titleLines?: number;
};

function ListRow({
  title,
  subtitle,
  right,
  icon = 'circle-outline',
  iconColor = colors.primary,
  iconBg = colors.primaryLight,
  badge,
  badgeAlign = 'title',
  onPress,
  onLongPress,
  style,
  showChevron = !!onPress,
  trailing,
  titleLines = 2,
}: Props) {
  const titleBadge = badge && badgeAlign === 'title' ? badge : null;
  const rightBadge = badge && badgeAlign === 'right' ? badge : null;
  const rightNode =
    right != null || rightBadge ? (
      <View style={styles.rightCol}>
        {right != null ? (
          typeof right === 'string' ? (
            <Text style={styles.right} numberOfLines={1}>{right}</Text>
          ) : (
            right
          )
        ) : null}
        {rightBadge ? (
          <View style={[styles.badge, styles.badgeRight, { backgroundColor: rightBadge.bg }]}>
            <Text style={[styles.badgeText, { color: rightBadge.color }]}>{rightBadge.label}</Text>
          </View>
        ) : null}
      </View>
    ) : null;

  const content = (
    <>
      {icon ? (
        <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
          <Icon name={icon} size={20} color={iconColor} />
        </View>
      ) : null}
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={titleLines}>{title}</Text>
          {titleBadge ? (
            <View style={[styles.badge, { backgroundColor: titleBadge.bg }]}>
              <Text style={[styles.badgeText, { color: titleBadge.color }]}>{titleBadge.label}</Text>
            </View>
          ) : null}
        </View>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {rightNode}
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

export default memo(ListRow);

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
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 3, lineHeight: 16 },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm, flexShrink: 0 },
  badgeRight: { marginTop: 4, alignSelf: 'flex-end' },
  badgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  rightCol: {
    marginLeft: spacing.sm,
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexShrink: 0,
    maxWidth: '34%',
  },
  right: { fontSize: 16, fontWeight: '700', color: colors.secondary, textAlign: 'right' },
  chevron: { marginLeft: spacing.xs },
});
