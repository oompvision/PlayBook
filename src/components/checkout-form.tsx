"use client";

import {
  forwardRef,
  useImperativeHandle,
  useState,
  useMemo,
} from "react";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import type { Appearance } from "@stripe/stripe-js";
import { getStripePromise } from "@/lib/stripe-client";
import { AlertTriangle, CreditCard, Loader2, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CheckoutFormHandle = {
  submit: () => Promise<{
    success: boolean;
    paymentMethodId?: string;
    error?: string;
  }>;
  /** Validates the form without confirming payment. Returns true if valid. */
  validate: () => Promise<{ valid: boolean; error?: string }>;
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
  /** @deprecated No longer used — agreement is implicit. Kept for API compat. */
  onPolicyAgree?: (agreedAt: string) => void;
  /** @deprecated No longer used — agreement is implicit. Kept for API compat. */
  policyAgreed?: boolean;
  checkoutFormRef: React.RefObject<CheckoutFormHandle | null>;
  /** Whether the booking falls within the no-cancellation window */
  isWithinCancellationWindow?: boolean;
  /** Cancellation window in hours (default 24) */
  cancellationWindowHours?: number;
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
      validate: async () => {
        if (!stripe || !elements) {
          return { valid: false, error: "Payment system not ready" };
        }
        const { error } = await elements.submit();
        if (error) {
          return { valid: false, error: error.message || "Please check your payment details" };
        }
        return { valid: true };
      },
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
  isWithinCancellationWindow = false,
  cancellationWindowHours = 24,
}: PaymentSectionProps) {
  const [policyModalOpen, setPolicyModalOpen] = useState(false);

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

      {/* Passive agreement text */}
      <p className="text-xs text-muted-foreground text-center">
        By booking you agree to the terms and{" "}
        {cancellationPolicyText ? (
          <button
            type="button"
            onClick={() => setPolicyModalOpen(true)}
            className="underline underline-offset-2 hover:text-foreground transition-colors"
          >
            cancellation policy
          </button>
        ) : (
          "cancellation policy"
        )}
      </p>

      {/* No-cancellation window warning */}
      {isWithinCancellationWindow && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/50">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
            This booking is less than {cancellationWindowHours} hours away and cannot be refunded or modified.
          </p>
        </div>
      )}

      {/* Cancellation Policy Modal */}
      {cancellationPolicyText && (
        <Dialog open={policyModalOpen} onOpenChange={setPolicyModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                Cancellation Policy
              </DialogTitle>
            </DialogHeader>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/50">
              <p className="text-sm leading-relaxed text-blue-700 dark:text-blue-300">
                {cancellationPolicyText}
              </p>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
