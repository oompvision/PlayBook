import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/lib/auth-context';
import { FacilityProvider } from './src/lib/facility-context';
import { RootNavigator } from './src/navigation/RootNavigator';

function AppInner() {
  const { profile } = useAuth();
  return (
    <FacilityProvider profile={profile}>
      <RootNavigator />
      <StatusBar style="dark" />
    </FacilityProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
