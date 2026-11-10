import React from 'react';
import { Platform, StatusBar, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { CommonActions, useNavigation, useNavigationState } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { APP_DISPLAY_NAME } from '../constants/branding';
import LanguageToggle from '../i18n/LanguageToggle';
import { useT } from '../i18n';
import { useAuthStore } from '../store/authStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/layout';
import { useDrawerStore } from './drawerStore';
import { usePinnedSidebar } from './usePinnedSidebar';

const TOOLBAR_HEIGHT = 58;

interface AppHeaderProps {
  title: string;
}

export default function AppHeader({ title }: AppHeaderProps) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const open = useDrawerStore((s) => s.open);
  const pinned = usePinnedSidebar();
  const canGoBack = navigation.canGoBack();
  const currentRoute = useNavigationState((state) => state?.routes[state.index]?.name);
  const tenant = useAuthStore((s) => s.tenant);
  const user = useAuthStore((s) => s.user);

  const isRoot = !canGoBack;
  const isHome = currentRoute === 'Dashboard';
  const showHome = !isHome;
  const subtitle = isRoot ? '' : [user?.branch?.name, user?.name].filter(Boolean).join(' · ');

  const goHome = () => {
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Dashboard' }],
      }),
    );
  };

  const goNewBill = () => {
    navigation.dispatch(
      CommonActions.reset({
        index: 1,
        routes: [
          { name: 'Dashboard' },
          { name: 'Billing', params: { fresh: true } },
        ],
      }),
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.surface} />
      <View style={styles.toolbar}>
        {pinned && !canGoBack ? (
          <View style={styles.iconButton} />
        ) : (
          <TouchableOpacity
            onPress={canGoBack ? () => navigation.goBack() : open}
            style={styles.iconButton}
            activeOpacity={0.7}
            hitSlop={8}
            accessibilityLabel={canGoBack ? t('Go back') : t('Open menu')}>
            <View style={styles.iconCircle}>
              <Icon
                name={canGoBack ? 'arrow-left' : 'menu'}
                size={22}
                color={colors.primary}
              />
            </View>
          </TouchableOpacity>
        )}

        <View style={styles.center}>
          {isRoot ? (
            <Text style={styles.brandTitle} numberOfLines={1}>{tenant?.name || APP_DISPLAY_NAME}</Text>
          ) : (
            <View style={styles.titleBlockCentered}>
              <Text style={styles.screenTitle} numberOfLines={1}>{t(title)}</Text>
              {subtitle ? (
                <Text style={styles.subtitleCentered} numberOfLines={1}>{subtitle}</Text>
              ) : null}
            </View>
          )}
        </View>

        <View style={styles.rightActions}>
          <TouchableOpacity
            onPress={goNewBill}
            style={styles.newBillBtn}
            activeOpacity={0.8}
            hitSlop={6}
            accessibilityLabel={t('New Bill')}>
            <Icon name="point-of-sale" size={18} color={colors.textOnPrimary} />
            <Text style={styles.newBillLabel}>{t('New Bill')}</Text>
          </TouchableOpacity>
          <LanguageToggle />
          {showHome ? (
            <TouchableOpacity
              onPress={goHome}
              style={styles.iconButton}
              activeOpacity={0.7}
              hitSlop={8}
              accessibilityLabel={t('Go to home')}>
              <View style={styles.homeCircle}>
                <Icon name="home" size={22} color={colors.primary} />
              </View>
            </TouchableOpacity>
          ) : pinned ? (
            <View style={styles.iconButton}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {(user?.name || 'U').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
                </Text>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              onPress={open}
              style={styles.iconButton}
              activeOpacity={0.7}
              hitSlop={8}
              accessibilityLabel={t('Open menu')}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {(user?.name || 'U').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    ...Platform.select({
      ios: {
        shadowColor: '#001B48',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: { elevation: 3 },
    }),
  },
  toolbar: {
    height: TOOLBAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  iconButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.secondaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    justifyContent: 'flex-end',
  },
  newBillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.secondary,
    marginRight: spacing.xs,
    gap: 6,
  },
  newBillLabel: {
    color: colors.textOnPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  center: {
    flex: 1,
    marginHorizontal: spacing.xs,
    justifyContent: 'center',
  },
  titleBlockCentered: {
    alignItems: 'center',
  },
  brandTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.2,
  },
  screenTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.2,
  },
  subtitleCentered: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.textOnPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
});
