import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { prefetchMarathiTranslator } from '../i18n/translateToMarathi';
import { colors } from '../theme/colors';
import AppSidebar from './AppSidebar';
import MainNavigator from './MainNavigator';
import { usePinnedSidebar } from './usePinnedSidebar';

export default function AppShell() {
  const pinned = usePinnedSidebar();

  useEffect(() => {
    // Desktop/web: download Paar EN→MR once, then translations work offline.
    prefetchMarathiTranslator();
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
