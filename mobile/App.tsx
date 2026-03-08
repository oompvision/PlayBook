import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/lib/auth-context';
import { FacilityProvider } from './src/lib/facility-context';
import { RootNavigator } from './src/navigation/RootNavigator';

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <FacilityProvider>
          <RootNavigator />
          <StatusBar style="dark" />
        </FacilityProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
