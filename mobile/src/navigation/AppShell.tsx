import React from 'react';
import { View, StyleSheet } from 'react-native';
import AppSidebar from './AppSidebar';
import MainNavigator from './MainNavigator';
import { colors } from '../theme/colors';

export default function AppShell() {
  return (
    <View style={styles.root}>
      <MainNavigator />
      <AppSidebar />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
