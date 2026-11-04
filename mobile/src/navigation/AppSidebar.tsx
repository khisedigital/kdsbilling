import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigationState } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { APP_DISPLAY_NAME } from '../constants/branding';
import { useAuthStore } from '../store/authStore';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { menuSections, type MenuItem, type MenuScreen } from './menuConfig';
import type { MainStackParamList } from './MainNavigator';
import { useDrawerStore } from './drawerStore';
import { navigateMainScreen } from './navigationRef';
import { SIDEBAR_WIDTH } from './usePinnedSidebar';

const DRAWER_WIDTH = SIDEBAR_WIDTH;

/** Survives a sidebar remount so the menu list does not jump to the top. */
let menuScrollY = 0;

/** Screens opened from a menu item; the parent item stays selected. */
const MENU_ROUTE_PARENT: Partial<Record<keyof MainStackParamList, MenuScreen>> = {
  BarcodeScanner: 'Billing',
  Payment: 'Billing',
  HoldBill: 'Billing',
  SaleDetail: 'SalesList',
  Return: 'ReturnsList',
  ImportMasterProducts: 'ProductList',
  ProductDetail: 'ProductList',
  ProductForm: 'ProductList',
  ReportDetail: 'Reports',
  PurchaseBillDetail: 'PurchaseBillList',
  PurchaseBillForm: 'PurchaseBillList',
  ShopifyIntegration: 'Integrations',
  PrintLabel: 'BarcodeLabel',
  StockTransfer: 'StockList',
};

function isMenuItemActive(item: MenuItem, routeName: string, params?: Record<string, unknown>): boolean {
  const screen = MENU_ROUTE_PARENT[routeName as keyof MainStackParamList] || routeName;
  if (item.screen !== screen) return false;
  if (!item.params) return true;
  const entries = Object.entries(item.params).filter(([key]) => key !== 'fresh');
  return entries.every(([key, value]) => params?.[key] === value);
}

function SidebarItem({
  label,
  icon,
  highlight,
  danger,
  onPress,
}: {
  label: string;
  icon: string;
  highlight?: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.65}
      accessibilityState={{ selected: Boolean(highlight) }}
      // Keep focus from scrolling the menu list to the clicked row.
      onMouseDown={(event) => {
        (event as { preventDefault?: () => void }).preventDefault?.();
      }}
      style={[styles.menuItem, highlight && styles.menuItemHighlight, danger && styles.menuItemDanger]}>
      <View style={[styles.menuIconWrap, highlight && styles.menuIconWrapHighlight, danger && styles.menuIconWrapDanger]}>
        <Icon
          name={icon}
          size={18}
          color={danger ? colors.error : highlight ? colors.primary : colors.textSecondary}
        />
      </View>
      <Text
        style={[styles.menuLabel, highlight && styles.menuLabelHighlight, danger && styles.menuLabelDanger]}
        numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export default function AppSidebar({ pinned = false }: { pinned?: boolean }) {
  const insets = useSafeAreaInsets();
  const isOpen = useDrawerStore((s) => s.isOpen);
  const close = useDrawerStore((s) => s.close);
  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const logout = useAuthStore((s) => s.logout);

  const [visible, setVisible] = useState(false);
  const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const menuScrollRef = useRef<ScrollView>(null);
  const currentRoute = useNavigationState((state) => {
    const focused = state?.routes?.[state.index ?? 0];
    const nested = focused?.state as
      | { index?: number; routes?: { name: string; params?: Record<string, unknown> }[] }
      | undefined;
    const route = nested?.routes?.[nested.index ?? 0];
    return route?.name ? `${route.name}:${JSON.stringify(route.params ?? {})}` : 'Dashboard:{}';
  });
  const currentName = currentRoute.slice(0, currentRoute.indexOf(':'));
  const currentParams = JSON.parse(currentRoute.slice(currentRoute.indexOf(':') + 1)) as Record<string, unknown>;

  const holdMenuScroll = () => {
    const y = menuScrollY;
    requestAnimationFrame(() => {
      menuScrollRef.current?.scrollTo({ y, animated: false });
    });
  };

  useEffect(() => {
    const y = menuScrollY;
    const frame = requestAnimationFrame(() => {
      menuScrollRef.current?.scrollTo({ y, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [currentRoute]);

  useEffect(() => {
    if (pinned) return;
    if (isOpen) {
      setVisible(true);
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    if (!visible) return;

    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: -DRAWER_WIDTH,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setVisible(false);
    });
  }, [pinned, isOpen, visible, slideAnim, fadeAnim]);

  const navigateTo = <K extends keyof MainStackParamList>(screen: K, params?: MainStackParamList[K]) => {
    if (pinned) {
      navigateMainScreen(screen, params);
      holdMenuScroll();
      return;
    }
    close();
    setTimeout(() => navigateMainScreen(screen, params), 80);
  };

  const initials = (user?.name || 'U')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  if (!pinned && !visible) return null;

  const body = (
    <>
          <View style={styles.header}>
            <View style={styles.brandRow}>
              <Image source={require('../assets/logo.png')} style={styles.brandLogo} resizeMode="contain" />
              <View style={styles.brandText}>
                <Text style={styles.brandName} numberOfLines={1}>{APP_DISPLAY_NAME}</Text>
                <Text style={styles.brandTag} numberOfLines={1}>Billing made simple</Text>
              </View>
              {pinned ? null : (
                <TouchableOpacity onPress={close} hitSlop={12} style={styles.closeBtn}>
                  <Icon name="close" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.shopCard}>
              <View style={styles.avatar}>
                <Text style={styles.avatarLabel}>{initials}</Text>
              </View>
              <View style={styles.shopMeta}>
                <Text style={styles.shopName} numberOfLines={1}>{tenant?.name || 'My Shop'}</Text>
                <Text style={styles.userMeta} numberOfLines={1}>
                  {[user?.name, user?.branch?.name].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {user?.role ? (
                <View style={styles.rolePill}>
                  <Text style={styles.roleText}>{user.role}</Text>
                </View>
              ) : null}
            </View>
          </View>

          <ScrollView
            ref={menuScrollRef}
            style={styles.menuList}
            contentContainerStyle={styles.menuScroll}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(event) => {
              menuScrollY = event.nativeEvent.contentOffset.y;
            }}>
            {menuSections.map((section) => {
              const items = section.items.filter((item) => {
                if (
                  item.screen === 'ShopSettings' ||
                  item.screen === 'PrinterSettings' ||
                  item.screen === 'Integrations'
                ) {
                  return user?.permissions?.includes('settings.manage');
                }
                return true;
              });
              if (!items.length) return null;
              return (
                <View key={section.title} style={styles.section}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  {items.map((item) => (
                    <SidebarItem
                      key={`${section.title}-${item.label}`}
                      label={item.label}
                      icon={item.icon}
                      highlight={isMenuItemActive(item, currentName, currentParams)}
                      onPress={() => navigateTo(item.screen, item.params)}
                    />
                  ))}
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <SidebarItem
              label="Logout"
              icon="logout"
              danger
              onPress={() => {
                if (!pinned) close();
                logout();
              }}
            />
          </View>
    </>
  );

  if (pinned) {
    return (
      <View
        style={[
          styles.panelDocked,
          { width: DRAWER_WIDTH, paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}>
        {body}
      </View>
    );
  }

  return (
    <Modal visible transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        </Animated.View>

        <Animated.View
          style={[
            styles.panel,
            {
              width: DRAWER_WIDTH,
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
              transform: [{ translateX: slideAnim }],
            },
          ]}>
          {body}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
  },
  panel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
    overflow: 'hidden',
  },
  panelDocked: {
    alignSelf: 'stretch',
    flexShrink: 0,
    backgroundColor: colors.surface,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
    overflow: 'hidden',
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  brandLogo: {
    width: 40,
    height: 40,
    marginRight: spacing.sm,
  },
  brandText: { flex: 1 },
  brandName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.2,
  },
  brandTag: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shopCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarLabel: {
    color: colors.textOnPrimary,
    fontWeight: '700',
    fontSize: 14,
  },
  shopMeta: { flex: 1, minWidth: 0 },
  shopName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  userMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  rolePill: {
    marginLeft: spacing.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  roleText: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  menuList: { flex: 1 },
  menuScroll: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  section: {
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    color: colors.textMuted,
    marginLeft: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.xs,
    marginVertical: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  menuItemHighlight: {
    backgroundColor: colors.primaryLight,
    borderLeftColor: colors.primary,
  },
  menuItemDanger: {
    backgroundColor: colors.errorLight,
  },
  menuIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  menuIconWrapHighlight: {
    backgroundColor: '#D6E6FF',
  },
  menuIconWrapDanger: {
    backgroundColor: '#FECACA',
  },
  menuLabel: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  menuLabelHighlight: {
    color: colors.primary,
    fontWeight: '700',
  },
  menuLabelDanger: {
    color: colors.error,
    fontWeight: '600',
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
});
