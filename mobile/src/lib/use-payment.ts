import { useState } from 'react';
import { Alert } from 'react-native';
import { useStripe } from '@stripe/stripe-react-native';
import { supabase } from './supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL || '';

console.log('[usePayment] API_URL:', API_URL || '(empty)');

export type PaymentType = 'slot_booking' | 'dynamic_booking' | 'event';

export interface PaymentParams {
  orgId: string;
  type: PaymentType;
  slotIds?: string[];
  priceCents?: number;
  eventId?: string;
  registrationId?: string;
  locationId?: string | null;
}

export interface PaymentResult {
  success: boolean;
  cancelled?: boolean;
  error?: string;
  // Intent details (populated when payment was collected)
  intentId?: string;
  intentType?: 'payment' | 'setup';
  stripeCustomerId?: string;
  amountCents?: number;
  cancellationPolicyText?: string;
}

interface IntentResponse {
  payment_required: boolean;
  client_secret?: string;
  intent_type?: 'payment' | 'setup';
  intent_id?: string;
  stripe_customer_id?: string;
  stripe_account_id?: string;
  publishable_key?: string;
  amount_cents?: number;
  cancellation_policy_text?: string;
  error?: string;
}

export function usePayment() {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [isProcessing, setIsProcessing] = useState(false);

  const collectPayment = async (params: PaymentParams): Promise<PaymentResult> => {
    if (!API_URL) {
      console.log('[collectPayment] No API_URL — skipping payment');
      return { success: true }; // No API URL configured — skip payment
    }

    setIsProcessing(true);
    console.log('[collectPayment] Starting payment collection:', JSON.stringify(params));

    try {
      // Get the current session token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        console.log('[collectPayment] No session token');
        setIsProcessing(false);
        return { success: false, error: 'Not authenticated' };
      }

      // Call backend to create payment intent
      const url = `${API_URL}/api/mobile/create-payment-intent`;
      console.log('[collectPayment] Calling:', url);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          org_id: params.orgId,
          type: params.type,
          slot_ids: params.slotIds,
          price_cents: params.priceCents,
          event_id: params.eventId,
          registration_id: params.registrationId,
          location_id: params.locationId,
        }),
      });

      const data: IntentResponse = await response.json();
      console.log('[collectPayment] Response status:', response.status, 'data:', JSON.stringify(data));

      if (!response.ok) {
        setIsProcessing(false);
        return { success: false, error: data.error || 'Failed to create payment intent' };
      }

      // No payment required — proceed directly
      if (!data.payment_required) {
        console.log('[collectPayment] Backend says payment NOT required');
        setIsProcessing(false);
        return { success: true };
      }

      console.log('[collectPayment] Payment required! intent_type:', data.intent_type, 'amount:', data.amount_cents);

      // Initialize the Payment Sheet
      const { error: initError } = await initPaymentSheet({
        paymentIntentClientSecret:
          data.intent_type === 'payment' ? data.client_secret! : undefined,
        setupIntentClientSecret:
          data.intent_type === 'setup' ? data.client_secret! : undefined,
        merchantDisplayName: 'EZ Booker',
        customerId: data.stripe_customer_id,
        // Use connected account's Stripe account ID
        ...(data.stripe_account_id
          ? { stripeAccountId: data.stripe_account_id }
          : {}),
        defaultBillingDetails: {},
        allowsDelayedPaymentMethods: false,
      });

      if (initError) {
        setIsProcessing(false);
        return { success: false, error: initError.message };
      }

      // Present the Payment Sheet to the user
      const { error: presentError } = await presentPaymentSheet();

      setIsProcessing(false);

      if (presentError) {
        // User cancelled
        if (presentError.code === 'Canceled') {
          return { success: false, cancelled: true };
        }
        return { success: false, error: presentError.message };
      }

      // Payment succeeded
      return {
        success: true,
        intentId: data.intent_id,
        intentType: data.intent_type,
        stripeCustomerId: data.stripe_customer_id,
        amountCents: data.amount_cents,
        cancellationPolicyText: data.cancellation_policy_text,
      };
    } catch (err: unknown) {
      setIsProcessing(false);
      const message = err instanceof Error ? err.message : 'Payment failed';
      console.error('[collectPayment] CAUGHT ERROR:', message, err);
      return { success: false, error: message };
    }
  };

  const recordPayment = async (params: {
    orgId: string;
    bookingId?: string;
    eventRegistrationId?: string;
    intentId: string;
    intentType: 'payment' | 'setup';
    stripeCustomerId: string;
    amountCents: number;
    cancellationPolicyText?: string;
  }): Promise<{ success: boolean; error?: string }> => {
    if (!API_URL) return { success: true };

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        return { success: false, error: 'Not authenticated' };
      }

      const response = await fetch(`${API_URL}/api/mobile/record-booking-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          org_id: params.orgId,
          booking_id: params.bookingId,
          event_registration_id: params.eventRegistrationId,
          intent_id: params.intentId,
          intent_type: params.intentType,
          stripe_customer_id: params.stripeCustomerId,
          amount_cents: params.amountCents,
          cancellation_policy_text: params.cancellationPolicyText,
          policy_agreed_at: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        console.error('[recordPayment] error:', data.error);
        // Don't fail the booking flow — payment was already collected
        return { success: false, error: data.error };
      }

      return { success: true };
    } catch (err: unknown) {
      console.error('[recordPayment] exception:', err);
      // Don't fail the booking flow — payment was already collected
      return { success: false, error: 'Failed to record payment' };
    }
  };

  return { collectPayment, recordPayment, isProcessing };
}
