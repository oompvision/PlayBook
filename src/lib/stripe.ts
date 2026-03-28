import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-02-25.clover",
      typescript: true,
      timeout: 30_000, // 30s timeout for all Stripe API calls
      maxNetworkRetries: 2, // Auto-retry on network errors
    });
  }
  return _stripe;
}

// Proxy preserves the `stripe` export so existing imports (`import { stripe }`) keep working
// without eager initialization (which fails at build time when env vars aren't set).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return (getStripe() as any)[prop];
  },
});
