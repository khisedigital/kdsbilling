import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useT } from '../i18n';
import { isDesktopOfflineCapable } from '../offline/capability';
import { startConnectivityMonitor, useConnectivityStore } from '../offline/connectivityStore';
import { getShopSettingsForPrint } from '../offline/shopCache';
import { startOutboxSync } from '../offline/syncEngine';

/**
 * Desktop-only status dot (online / offline / syncing).
 * Sync is started from the Sync Data menu — not from this dot.
 */
export default function ConnectivityDot() {
  const t = useT();
  const online = useConnectivityStore((s) => s.online);
  const pendingCount = useConnectivityStore((s) => s.pendingCount);
  const syncing = useConnectivityStore((s) => s.syncing);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isDesktopOfflineCapable()) return undefined;
    const stopConn = startConnectivityMonitor();
    const stopSync = startOutboxSync();
    void getShopSettingsForPrint();
    return () => {
      stopConn();
      stopSync();
    };
  }, []);

  const tone = !online ? 'offline' : syncing || pendingCount > 0 ? 'sync' : 'online';

  useEffect(() => {
    if (!isDesktopOfflineCapable()) return undefined;
    opacity.setValue(1);
    const duration = tone === 'online' ? 900 : 450;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.25,
          duration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [opacity, tone]);

  if (!isDesktopOfflineCapable()) return null;

  const color = tone === 'offline' ? '#EA580C' : tone === 'sync' ? '#2563EB' : '#16A34A';
  const label = syncing
    ? t('Syncing…')
    : !online
      ? pendingCount > 0
        ? t('Offline · {{count}} bills waiting to sync', { count: pendingCount })
        : t('Offline · sales save on this PC')
      : pendingCount > 0
        ? t('Online · {{count}} pending', { count: pendingCount })
        : t('Online');

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={styles.hit}>
      <Animated.View style={[styles.dot, { backgroundColor: color, opacity }]} />
      {pendingCount > 0 ? <View style={[styles.badge, { borderColor: color }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hit: {
    marginLeft: 12,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 3,
    borderColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.32,
    shadowRadius: 3,
    elevation: 3,
  },
  badge: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFF',
    borderWidth: 2,
  },
});
