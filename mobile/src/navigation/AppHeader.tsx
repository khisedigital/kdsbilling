import React from 'react';
import { Image, Platform, StatusBar, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { CommonActions, useNavigation, useNavigationState } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { APP_DISPLAY_NAME } from '../constants/branding';
import { useAuthStore } from '../store/authStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/layout';
import { useDrawerStore } from './drawerStore';

const TOOLBAR_HEIGHT = 58;

interface AppHeaderProps {
  title: string;
}

export default function AppHeader({ title }: AppHeaderProps) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const open = useDrawerStore((s) => s.open);
  const canGoBack = navigation.canGoBack();
  const currentRoute = useNavigationState((state) => state?.routes[state.index]?.name);
  const tenant = useAuthStore((s) => s.tenant);
  const user = useAuthStore((s) => s.user);

  const isRoot = !canGoBack;
  const isHome = currentRoute === 'Dashboard';
  const showHome = !isHome;
  const subtitle = isRoot
    ? tenant?.name || APP_DISPLAY_NAME
    : [user?.branch?.name, user?.name].filter(Boolean).join(' · ');

  const goHome = () => {
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Dashboard' }],
      }),
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.surface} />
      <View style={styles.accentBar} />
      <View style={styles.toolbar}>
        <TouchableOpacity
          onPress={canGoBack ? () => navigation.goBack() : open}
          style={styles.iconButton}
          activeOpacity={0.7}
          hitSlop={8}
          accessibilityLabel={canGoBack ? 'Go back' : 'Open menu'}>
          <View style={styles.iconCircle}>
            <Icon
              name={canGoBack ? 'arrow-left' : 'menu'}
              size={22}
              color={colors.primary}
            />
          </View>
        </TouchableOpacity>

        <View style={styles.center}>
          {isRoot ? (
            <View style={styles.brandRow}>
              <Image
                source={require('../assets/logo.png')}
                style={styles.logo}
                resizeMode="contain"
              />
              <View style={styles.titleBlock}>
                <Text style={styles.brandTitle} numberOfLines={1}>{APP_DISPLAY_NAME}</Text>
                <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
              </View>
            </View>
          ) : (
            <View style={styles.titleBlockCentered}>
              <Text style={styles.screenTitle} numberOfLines={1}>{title}</Text>
              {subtitle ? (
                <Text style={styles.subtitleCentered} numberOfLines={1}>{subtitle}</Text>
              ) : null}
            </View>
          )}
        </View>

        <View style={styles.rightActions}>
          {showHome ? (
            <TouchableOpacity
              onPress={goHome}
              style={styles.iconButton}
              activeOpacity={0.7}
              hitSlop={8}
              accessibilityLabel="Go to home">
              <View style={styles.homeCircle}>
                <Icon name="home" size={22} color={colors.primary} />
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={open}
              style={styles.iconButton}
              activeOpacity={0.7}
              hitSlop={8}
              accessibilityLabel="Open menu">
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
    borderBottomWidth: StyleSheet.hairlineWidth,
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
  accentBar: {
    height: 3,
    backgroundColor: colors.primary,
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
    minWidth: 48,
    justifyContent: 'flex-end',
  },
  center: {
    flex: 1,
    marginHorizontal: spacing.xs,
    justifyContent: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logo: {
    width: 34,
    height: 34,
    marginRight: spacing.sm,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
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
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
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
