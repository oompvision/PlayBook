"use client";

import {
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { CreditCard, Lock } from "lucide-react";
import type { CheckoutFormHandle } from "@/components/checkout-form";

/**
 * Simulated Stripe checkout form for demo mode.
 * Looks like a real card input but doesn't connect to Stripe.
 * Pre-filled with test card data and always succeeds.
 */
export const DemoCheckoutForm = forwardRef<CheckoutFormHandle>(
  function DemoCheckoutForm(_props, ref) {
    const [cardNumber] = useState("4242 4242 4242 4242");
    const [expiry] = useState("12 / 28");
    const [cvc] = useState("123");

    useImperativeHandle(ref, () => ({
      async submit() {
        // Simulate a short delay then succeed
        await new Promise((r) => setTimeout(r, 600));
        return {
          success: true,
          paymentMethodId: "pm_demo_simulated",
          cardBrand: "visa",
          cardLast4: "4242",
        };
      },
      async confirmAndGetCardInfo() {
        await new Promise((r) => setTimeout(r, 600));
        return {
          success: true,
          paymentMethodId: "pm_demo_simulated",
          cardBrand: "visa",
          cardLast4: "4242",
        };
      },
    }));

    return (
      <div className="space-y-3">
        {/* Card number */}
        <div className="relative">
          <div className="rounded-md border bg-white px-3 py-2.5 text-sm shadow-sm">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <span className="font-mono text-gray-900">{cardNumber}</span>
              <span className="ml-auto flex items-center gap-1 text-xs text-green-600">
                <Lock className="h-3 w-3" />
              </span>
            </div>
          </div>
        </div>

        {/* Expiry + CVC row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border bg-white px-3 py-2.5 text-sm shadow-sm">
            <span className="font-mono text-gray-900">{expiry}</span>
          </div>
          <div className="rounded-md border bg-white px-3 py-2.5 text-sm shadow-sm">
            <span className="font-mono text-gray-900">{cvc}</span>
          </div>
        </div>

        {/* Demo indicator */}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" />
          Demo mode — no real payment will be processed
        </p>
      </div>
    );
  }
);
