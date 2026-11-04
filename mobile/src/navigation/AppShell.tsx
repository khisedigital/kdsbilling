import React from 'react';
import { View, StyleSheet } from 'react-native';
import AppSidebar from './AppSidebar';
import MainNavigator from './MainNavigator';
import { usePinnedSidebar } from './usePinnedSidebar';
import { colors } from '../theme/colors';

export default function AppShell() {
  const pinned = usePinnedSidebar();

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
