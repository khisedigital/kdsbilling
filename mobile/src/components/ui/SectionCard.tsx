import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors } from '../../theme/colors';
import { common, radius, spacing } from '../../theme/layout';

type Props = {
  title: string;
  subtitle?: string;
  icon?: string;
  iconColor?: string;
  iconBg?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  noPadding?: boolean;
};

export default function SectionCard({
  title,
  subtitle,
  icon,
  iconColor = colors.primary,
  iconBg = colors.primaryLight,
  action,
  children,
  noPadding,
}: Props) {
  return (
    <View style={[common.card, styles.card]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {icon ? (
            <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
              <Icon name={icon} size={20} color={iconColor} />
            </View>
          ) : null}
          <View style={styles.headerText}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
        </View>
        {action}
      </View>
      <View style={noPadding ? undefined : common.cardContent}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  headerText: { flex: 1 },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
