import React, { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { navigationRef } from './src/navigation/navigationRef';
import { theme } from './src/theme';
import { initApiClient } from './src/services/api';
import { useLanguageStore } from './src/i18n';
import { installBarcodeScannerGuard } from './src/utils/scannerGuard';
import { getPrinterSettings } from './src/store/printerStore';
import { prewarmIndicFont } from './src/print/PrintService';

function App() {
  const [apiReady, setApiReady] = useState(false);

  useEffect(() => installBarcodeScannerGuard(), []);

  useEffect(() => {
    Promise.all([initApiClient(), useLanguageStore.getState().hydrate()]).finally(() => {
      setApiReady(true);
      // Hot-cache printer settings + Devanagari font so first Print is not cold.
      void getPrinterSettings().catch(() => undefined);
      void prewarmIndicFont();
    });
  }, []);

  if (!apiReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF' }}>
        <Image
          source={require('./src/assets/logo.png')}
          style={{ width: 280, height: 280 }}
          resizeMode="contain"
          accessibilityLabel="KDSPOZ Retail"
        />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PaperProvider theme={theme}>
          <NavigationContainer ref={navigationRef}>
            <AppNavigator />
          </NavigationContainer>
        </PaperProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;
