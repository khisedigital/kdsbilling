import { MD3LightTheme, configureFonts } from 'react-native-paper';
import { colors } from './colors';

const fontConfig = configureFonts({
  config: { fontFamily: 'System' },
});

export const theme = {
  ...MD3LightTheme,
  roundness: 14,
  fonts: fontConfig,
  colors: {
    ...MD3LightTheme.colors,
    primary: colors.primary,
    onPrimary: colors.textOnPrimary,
    primaryContainer: colors.primaryLight,
    onPrimaryContainer: colors.primaryDark,
    secondary: colors.secondary,
    onSecondary: colors.textOnPrimary,
    secondaryContainer: colors.secondaryLight,
    onSecondaryContainer: colors.secondaryDark,
    tertiary: colors.accent,
    onTertiary: colors.text,
    tertiaryContainer: colors.accentLight,
    onTertiaryContainer: '#92400E',
    background: colors.background,
    onBackground: colors.text,
    surface: colors.surface,
    onSurface: colors.text,
    surfaceVariant: colors.surfaceVariant,
    onSurfaceVariant: colors.textMuted,
    outline: colors.border,
    outlineVariant: colors.borderLight,
    error: colors.error,
    onError: colors.textOnPrimary,
    elevation: {
      level0: 'transparent',
      level1: colors.surface,
      level2: colors.surface,
      level3: colors.surface,
      level4: colors.surface,
      level5: colors.surface,
    },
  },
};

export { colors };
export { spacing, radius, shadow, common, typography } from './layout';
