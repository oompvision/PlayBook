import { loadStripe } from "@stripe/stripe-js";

const cache = new Map<string, ReturnType<typeof loadStripe>>();

/**
 * Load Stripe.js for a specific connected account.
 * Caches by account ID so repeated calls return the same promise.
 */
export function getStripePromise(connectedAccountId: string) {
  if (!cache.has(connectedAccountId)) {
    cache.set(
      connectedAccountId,
      loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!, {
        stripeAccount: connectedAccountId,
      })
    );
  }
  return cache.get(connectedAccountId)!;
}
