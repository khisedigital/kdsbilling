import { Platform, StyleSheet } from 'react-native';
import { colors } from './colors';

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  full: 999,
};

export const typography = {
  hero: { fontSize: 32, fontWeight: '700' as const, color: colors.text, letterSpacing: -0.5 },
  h1: { fontSize: 24, fontWeight: '700' as const, color: colors.text },
  h2: { fontSize: 18, fontWeight: '700' as const, color: colors.text },
  h3: { fontSize: 16, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 15, fontWeight: '400' as const, color: colors.text },
  bodySm: { fontSize: 13, fontWeight: '400' as const, color: colors.textSecondary },
  caption: { fontSize: 12, fontWeight: '500' as const, color: colors.textMuted },
  label: { fontSize: 11, fontWeight: '700' as const, color: colors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  money: { fontSize: 28, fontWeight: '700' as const, color: colors.text, letterSpacing: -0.5 },
  moneySm: { fontSize: 17, fontWeight: '700' as const, color: colors.secondary },
};

export const shadow = {
  sm: Platform.select({
    ios: { shadowColor: '#1A1F36', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6 },
    android: { elevation: 2 },
    default: {},
  }),
  md: Platform.select({
    ios: { shadowColor: '#1A1F36', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 14 },
    android: { elevation: 6 },
    default: {},
  }),
  lg: Platform.select({
    ios: { shadowColor: '#1A1F36', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.12, shadowRadius: 20 },
    android: { elevation: 10 },
    default: {},
  }),
};

/** Compact Paper Dialog size — keeps desktop windows from stretching full-width. */
export const dialogCard = {
  alignSelf: 'center' as const,
  width: '92%' as const,
  maxWidth: 400,
  marginHorizontal: spacing.lg,
  borderRadius: radius.lg,
  backgroundColor: colors.surface,
};

export const common = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  screenPad: { padding: spacing.lg, paddingBottom: spacing.xxxl * 2 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow.sm,
  },
  cardPad: { padding: spacing.lg },
  cardContent: { padding: spacing.lg, paddingTop: spacing.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: 100 },
  fab: { position: 'absolute' as const, right: spacing.lg, bottom: spacing.lg, backgroundColor: colors.primary },
  dialog: { ...dialogCard },
});
