import React, { useMemo, useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Chip, Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import EmptyState from '../../components/ui/EmptyState';
import ScreenSearch from '../../components/ui/ScreenSearch';
import { REPORTS, type ReportConfig } from '../../reports/reportConfig';
import { colors } from '../../theme/colors';
import { common, radius, shadow, spacing, typography } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'Reports'>;

const GROUPS = ['All', 'Sales', 'Inventory', 'Finance', 'People'] as const;
type GroupFilter = (typeof GROUPS)[number];

const GRID_GAP = spacing.md;
const GRID_PAD = spacing.lg;
const TILE_WIDTH = (Dimensions.get('window').width - GRID_PAD * 2 - GRID_GAP) / 2;

const GROUP_META: Record<Exclude<GroupFilter, 'All'>, { icon: string; color: string }> = {
  Sales: { icon: 'chart-bar', color: colors.primary },
  Inventory: { icon: 'warehouse', color: colors.secondary },
  Finance: { icon: 'currency-inr', color: colors.success },
  People: { icon: 'account-group', color: colors.accent },
};

function ReportTile({ report, onPress }: { report: ReportConfig; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}>
      <View style={[styles.tileIcon, { backgroundColor: report.bg }]}>
        <Icon name={report.icon} size={26} color={report.color} />
      </View>
      <Text style={styles.tileTitle} numberOfLines={2}>{report.title}</Text>
      <Text style={styles.tileSub} numberOfLines={2}>{report.subtitle}</Text>
      <View style={styles.tileFooter}>
        <Text style={[styles.tileGroup, { color: report.color }]}>{report.group}</Text>
        <Icon name="arrow-top-right" size={14} color={colors.textMuted} />
      </View>
    </Pressable>
  );
}

function ReportGrid({ items, onPress }: { items: ReportConfig[]; onPress: (report: ReportConfig) => void }) {
  return (
    <View style={styles.grid}>
      {items.map((report) => (
        <ReportTile key={report.id} report={report} onPress={() => onPress(report)} />
      ))}
    </View>
  );
}

export default function ReportsScreen({ navigation }: Props) {
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<GroupFilter>('All');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return REPORTS.filter((report) => {
      if (group !== 'All' && report.group !== group) return false;
      if (!q) return true;
      return (
        report.title.toLowerCase().includes(q) ||
        report.subtitle.toLowerCase().includes(q) ||
        report.group.toLowerCase().includes(q)
      );
    });
  }, [search, group]);

  const grouped = useMemo(() => {
    if (group !== 'All') return [{ group, items: filtered }];
    const sections = (['Sales', 'Inventory', 'Finance', 'People'] as const)
      .map((section) => ({
        group: section,
        items: filtered.filter((report) => report.group === section),
      }))
      .filter((section) => section.items.length > 0);
    return sections;
  }, [filtered, group]);

  const openReport = (report: ReportConfig) => {
    navigation.navigate('ReportDetail', { reportType: report.id });
  };

  return (
    <View style={common.screen}>
      <ScreenSearch value={search} onChangeText={setSearch} placeholder="Search reports..." />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.heroIcon}>
              <Icon name="chart-box-outline" size={28} color={colors.textOnPrimary} />
            </View>
            <View style={styles.heroText}>
              <Text style={styles.heroTitle}>Business Reports</Text>
              <Text style={styles.heroSub}>13 reports · sales, stock, tax & cash flow</Text>
            </View>
          </View>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatNum}>13</Text>
              <Text style={styles.heroStatLbl}>Reports</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatNum}>4</Text>
              <Text style={styles.heroStatLbl}>Categories</Text>
            </View>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}>
          {GROUPS.map((item) => (
            <Chip
              key={item}
              selected={group === item}
              onPress={() => setGroup(item)}
              style={styles.chip}
              showSelectedOverlay
              icon={item === 'All' ? 'view-grid-outline' : GROUP_META[item].icon}>
              {item}
            </Chip>
          ))}
        </ScrollView>

        {!filtered.length ? (
          <EmptyState
            icon="file-search-outline"
            title="No reports found"
            subtitle="Try a different search or category filter"
          />
        ) : group === 'All' && !search.trim() ? (
          grouped.map((section) => {
            const meta = GROUP_META[section.group as Exclude<GroupFilter, 'All'>];
            return (
              <View key={section.group} style={styles.section}>
                <View style={styles.sectionHead}>
                  <View style={[styles.sectionIcon, { backgroundColor: `${meta.color}15` }]}>
                    <Icon name={meta.icon} size={18} color={meta.color} />
                  </View>
                  <Text style={styles.sectionTitle}>{section.group}</Text>
                  <Text style={styles.sectionCount}>{section.items.length}</Text>
                </View>
                <ReportGrid items={section.items} onPress={openReport} />
              </View>
            );
          })
        ) : (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>
                {group === 'All' ? 'Results' : group}
              </Text>
              <Text style={styles.sectionCount}>{filtered.length}</Text>
            </View>
            <ReportGrid items={filtered} onPress={openReport} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: GRID_PAD,
    paddingBottom: spacing.xxxl * 2,
  },
  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadow.md,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  heroText: { flex: 1 },
  heroTitle: {
    color: colors.textOnPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  heroSub: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 13,
    marginTop: 3,
  },
  heroStats: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
  },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatNum: {
    color: colors.textOnPrimary,
    fontSize: 22,
    fontWeight: '700',
  },
  heroStatLbl: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  heroDivider: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  chips: {
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
  chip: {
    backgroundColor: colors.surface,
    marginRight: spacing.xs,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  sectionTitle: {
    ...typography.h3,
    flex: 1,
  },
  sectionCount: {
    ...typography.caption,
    backgroundColor: colors.surfaceVariant,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  tile: {
    width: TILE_WIDTH,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.md,
    minHeight: 148,
    ...shadow.sm,
  },
  tilePressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  tileIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  tileTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 18,
    minHeight: 36,
  },
  tileSub: {
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 15,
    marginTop: 2,
    flex: 1,
  },
  tileFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
  },
  tileGroup: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
