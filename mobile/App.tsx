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

function App() {
  const [apiReady, setApiReady] = useState(false);

  useEffect(() => {
    initApiClient().finally(() => setApiReady(true));
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
