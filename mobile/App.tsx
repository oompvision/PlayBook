import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/lib/auth-context';
import { FacilityProvider } from './src/lib/facility-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { StripeAccountProvider, useStripeAccount } from './src/lib/stripe-context';

const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';

// Stripe native module isn't available in Expo Go — only in custom dev builds.
// Wrap conditionally so the app still runs without it.
let StripeProviderDynamic: React.FC<{ stripeAccountId?: string; children: React.ReactNode }> = ({ children }) => <>{children}</>;
try {
  const { StripeProvider } = require('@stripe/stripe-react-native');
  if (STRIPE_PUBLISHABLE_KEY) {
    StripeProviderDynamic = ({ stripeAccountId, children }: { stripeAccountId?: string; children: React.ReactNode }) => (
      <StripeProvider
        publishableKey={STRIPE_PUBLISHABLE_KEY}
        stripeAccountId={stripeAccountId}
      >
        {children}
      </StripeProvider>
    );
  }
} catch {
  console.warn('[App] Stripe native module not available — payment collection disabled');
}

function StripeWrapper({ children }: { children: React.ReactNode }) {
  const { stripeAccountId } = useStripeAccount();
  return (
    <StripeProviderDynamic stripeAccountId={stripeAccountId}>
      {children}
    </StripeProviderDynamic>
  );
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
      <StripeAccountProvider>
        <StripeWrapper>
          <AuthProvider>
            <AppInner />
          </AuthProvider>
        </StripeWrapper>
      </StripeAccountProvider>
    </SafeAreaProvider>
  );
}
