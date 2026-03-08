import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/lib/auth-context';
import { FacilityProvider } from './src/lib/facility-context';
import { RootNavigator } from './src/navigation/RootNavigator';

const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';

// Stripe native module isn't available in Expo Go — only in custom dev builds.
// Wrap conditionally so the app still runs without it.
let StripeProviderWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;
try {
  const { StripeProvider } = require('@stripe/stripe-react-native');
  if (STRIPE_PUBLISHABLE_KEY) {
    StripeProviderWrapper = ({ children }: { children: React.ReactNode }) => (
      <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>{children}</StripeProvider>
    );
  }
} catch {
  console.warn('[App] Stripe native module not available — payment collection disabled');
}

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
      <StripeProviderWrapper>
        <AuthProvider>
          <AppInner />
        </AuthProvider>
      </StripeProviderWrapper>
    </SafeAreaProvider>
  );
}
