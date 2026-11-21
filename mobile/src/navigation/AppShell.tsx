import React, { useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { prefetchMarathiTranslator } from '../i18n/translateToMarathi';
import { colors } from '../theme/colors';
import AppSidebar from './AppSidebar';
import MainNavigator from './MainNavigator';
import { usePinnedSidebar } from './usePinnedSidebar';
import { navigateMainScreen } from './navigationRef';

export default function AppShell() {
  const pinned = usePinnedSidebar();

  useEffect(() => {
    // Desktop/web: download Paar EN→MR once, then translations work offline.
    prefetchMarathiTranslator();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const onGlobalKeyDown = (event: KeyboardEvent) => {
      // F1: Open New Bill screen from anywhere in the app
      if (event.key === 'F1') {
        event.preventDefault();
        event.stopPropagation();
        navigateMainScreen('Billing', { fresh: true });
      }
    };

    window.addEventListener('keydown', onGlobalKeyDown, true);
    return () => window.removeEventListener('keydown', onGlobalKeyDown, true);
  }, []);

  return (
    <View style={styles.root}>
      {pinned ? <AppSidebar pinned /> : null}
      <View style={styles.content}>
        <MainNavigator />
      </View>
      {pinned ? null : <AppSidebar />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
});
