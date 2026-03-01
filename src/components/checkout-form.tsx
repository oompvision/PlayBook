"use client";

import {
  forwardRef,
  useImperativeHandle,
  useState,
  useMemo,
  useCallback,
} from "react";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import type { Appearance } from "@stripe/stripe-js";
import { getStripePromise } from "@/lib/stripe-client";
import { CreditCard, Loader2, ShieldCheck } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CheckoutFormHandle = {
  submit: () => Promise<{
    success: boolean;
    paymentMethodId?: string;
    error?: string;
  }>;
};

type CheckoutFormProps = {
  intentType: "payment" | "setup";
  disabled?: boolean;
};

type StripeCheckoutWrapperProps = {
  stripeAccountId: string;
  clientSecret: string;
  children: React.ReactNode;
};

type PaymentSectionProps = {
  stripeAccountId: string;
  clientSecret: string;
  intentType: "payment" | "setup";
  paymentMode: string;
  amountCents: number;
  cancellationPolicyText: string;
  onPolicyAgree: (agreedAt: string) => void;
  policyAgreed: boolean;
  checkoutFormRef: React.RefObject<CheckoutFormHandle | null>;
};

// ─── Stripe Elements Wrapper ──────────────────────────────────────────────────

const appearance: Appearance = {
  theme: "stripe",
  variables: {
    colorPrimary: "#18181b",
    borderRadius: "0.5rem",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
};

export function StripeCheckoutWrapper({
  stripeAccountId,
  clientSecret,
  children,
}: StripeCheckoutWrapperProps) {
  const stripePromise = useMemo(
    () => getStripePromise(stripeAccountId),
    [stripeAccountId]
  );

  return (
    <Elements
      stripe={stripePromise}
      options={{ clientSecret, appearance }}
    >
      {children}
    </Elements>
  );
}

// ─── Inner Checkout Form ──────────────────────────────────────────────────────

/**
 * Renders the Stripe PaymentElement inside an Elements context.
 * Exposes a `submit()` method via ref for the parent to trigger payment confirmation.
 */
export const CheckoutForm = forwardRef<CheckoutFormHandle, CheckoutFormProps>(
  function CheckoutForm({ intentType, disabled }, ref) {
    const stripe = useStripe();
    const elements = useElements();
    const [ready, setReady] = useState(false);

    useImperativeHandle(ref, () => ({
      submit: async () => {
        if (!stripe || !elements) {
          return { success: false, error: "Payment system not ready" };
        }

        if (intentType === "payment") {
          const { error, paymentIntent } = await stripe.confirmPayment({
            elements,
            confirmParams: {
              return_url: window.location.href,
            },
            redirect: "if_required",
          });

          if (error) {
            return {
              success: false,
              error: error.message || "Payment failed",
            };
          }

          const pmId =
            typeof paymentIntent?.payment_method === "string"
              ? paymentIntent.payment_method
              : paymentIntent?.payment_method?.id || undefined;

          return { success: true, paymentMethodId: pmId };
        } else {
          const { error, setupIntent } = await stripe.confirmSetup({
            elements,
            confirmParams: {
              return_url: window.location.href,
            },
            redirect: "if_required",
          });

          if (error) {
            return {
              success: false,
              error: error.message || "Card setup failed",
            };
          }

          const pmId =
            typeof setupIntent?.payment_method === "string"
              ? setupIntent.payment_method
              : setupIntent?.payment_method?.id || undefined;

          return { success: true, paymentMethodId: pmId };
        }
      },
    }));

    return (
      <div className="space-y-3">
        <PaymentElement
          onReady={() => setReady(true)}
          options={{
            layout: "tabs",
          }}
        />
        {!ready && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {disabled && ready && (
          <div className="absolute inset-0 bg-background/50 cursor-not-allowed" />
        )}
      </div>
    );
  }
);

// ─── Payment Section (full UI with policy + form) ─────────────────────────────

/**
 * Complete payment section rendered in the booking panel.
 * Includes cancellation policy, agreement checkbox, and Stripe Elements.
 */
export function PaymentSection({
  stripeAccountId,
  clientSecret,
  intentType,
  paymentMode,
  amountCents,
  cancellationPolicyText,
  onPolicyAgree,
  policyAgreed,
  checkoutFormRef,
}: PaymentSectionProps) {
  const handlePolicyChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.checked) {
        onPolicyAgree(new Date().toISOString());
      }
    },
    [onPolicyAgree]
  );

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium">
          {paymentMode === "charge_upfront"
            ? "Payment Details"
            : "Card on File"}
        </p>
      </div>

      {/* Cancellation policy */}
      {cancellationPolicyText && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900 dark:bg-blue-950">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400" />
            <p className="text-xs text-blue-700 dark:text-blue-300">
              {cancellationPolicyText}
            </p>
          </div>
        </div>
      )}

      {/* Policy agreement checkbox */}
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-gray-300"
          checked={policyAgreed}
          onChange={handlePolicyChange}
        />
        <span className="text-xs text-muted-foreground">
          I agree to the{" "}
          {paymentMode === "charge_upfront"
            ? "payment terms and cancellation policy"
            : "card authorization and cancellation policy"}
        </span>
      </label>

      {/* Stripe Elements form */}
      <StripeCheckoutWrapper
        stripeAccountId={stripeAccountId}
        clientSecret={clientSecret}
      >
        <CheckoutForm
          ref={checkoutFormRef}
          intentType={intentType}
        />
      </StripeCheckoutWrapper>

      {/* Amount summary for upfront */}
      {paymentMode === "charge_upfront" && amountCents > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          You will be charged{" "}
          <span className="font-medium">
            ${(amountCents / 100).toFixed(2)}
          </span>{" "}
          now
        </p>
      )}
    </div>
  );
}
