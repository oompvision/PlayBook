import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StripeProvider } from '@stripe/stripe-react-native';
import { AuthProvider, useAuth } from './src/lib/auth-context';
import { FacilityProvider } from './src/lib/facility-context';
import { RootNavigator } from './src/navigation/RootNavigator';

const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';

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
      <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
        <AuthProvider>
          <AppInner />
        </AuthProvider>
      </StripeProvider>
    </SafeAreaProvider>
  );
}
