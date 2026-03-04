import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import Stripe from "stripe";

/**
 * POST /api/stripe/webhooks/connect
 * Handles Stripe Connect webhook events:
 *   - account.updated (Connect onboarding)
 *   - checkout.session.completed (new membership subscription)
 *   - invoice.payment_succeeded (subscription renewal)
 *   - invoice.payment_failed (failed renewal → past_due)
 *   - customer.subscription.deleted (cancellation processed)
 *   - customer.subscription.updated (cancel_at_period_end changes)
 * Uses service-role Supabase client since webhooks have no user session.
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_CONNECT_WEBHOOK_SECRET!
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[stripe/webhooks/connect] Signature verification failed:", message);
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  try {
    switch (event.type) {
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        const isComplete =
          account.charges_enabled && account.details_submitted;

        await supabase
          .from("org_payment_settings")
          .update({ stripe_onboarding_complete: isComplete })
          .eq("stripe_account_id", account.id);

        console.log(
          `[stripe/webhooks/connect] account.updated: ${account.id} → onboarding_complete=${isComplete}`
        );
        break;
      }

      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        // Only handle subscription checkout sessions
        if (session.mode !== "subscription" || !session.subscription) {
          break;
        }

        // Retrieve subscription with items to get metadata and period info
        // In Stripe API 2025-03-31+, current_period_end moved from subscription to items
        const subscription = await stripe.subscriptions.retrieve(
          session.subscription as string,
          { expand: ["items.data"] },
          { stripeAccount: event.account! } as Stripe.RequestOptions
        );

        const { org_id, user_id, tier_id } = subscription.metadata;

        if (!org_id || !user_id || !tier_id) {
          console.error(
            "[stripe/webhooks/connect] checkout.session.completed: missing metadata",
            subscription.metadata
          );
          break;
        }

        // Get period end from first subscription item
        const firstItem = subscription.items?.data?.[0];
        const periodEndTs = firstItem?.current_period_end;
        const periodEndIso = periodEndTs
          ? new Date(periodEndTs * 1000).toISOString()
          : null;

        // Upsert membership (handles re-subscribe after cancellation)
        await supabase.from("user_memberships").upsert(
          {
            org_id,
            user_id,
            tier_id,
            status: "active",
            source: "stripe",
            stripe_subscription_id: subscription.id,
            stripe_customer_id: session.customer as string,
            current_period_end: periodEndIso,
            cancelled_at: null,
          },
          { onConflict: "org_id,user_id" }
        );

        console.log(
          `[stripe/webhooks/connect] checkout.session.completed: user=${user_id} org=${org_id} → active`
        );
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;

        // Only handle subscription invoices
        if (!invoice.subscription) break;

        const subscriptionId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription.id;

        // Get the period end from the invoice line items
        const lineItem = invoice.lines?.data?.[0];
        const periodEnd = lineItem?.period?.end;

        if (periodEnd) {
          await supabase
            .from("user_memberships")
            .update({
              status: "active",
              current_period_end: new Date(periodEnd * 1000).toISOString(),
            })
            .eq("stripe_subscription_id", subscriptionId);

          console.log(
            `[stripe/webhooks/connect] invoice.payment_succeeded: sub=${subscriptionId} → active, period_end=${new Date(periodEnd * 1000).toISOString()}`
          );
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;

        if (!invoice.subscription) break;

        const subscriptionId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription.id;

        await supabase
          .from("user_memberships")
          .update({ status: "past_due" })
          .eq("stripe_subscription_id", subscriptionId);

        console.log(
          `[stripe/webhooks/connect] invoice.payment_failed: sub=${subscriptionId} → past_due`
        );
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;

        await supabase
          .from("user_memberships")
          .update({
            status: "cancelled",
            cancelled_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", subscription.id);

        console.log(
          `[stripe/webhooks/connect] customer.subscription.deleted: sub=${subscription.id} → cancelled`
        );
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;

        // Get period end from first subscription item (API 2025-03-31+)
        const subItem = subscription.items?.data?.[0];
        const subPeriodEnd = subItem?.current_period_end
          ? new Date(subItem.current_period_end * 1000).toISOString()
          : null;

        // Update period end and detect cancel_at_period_end changes
        const updateData: Record<string, unknown> = {};
        if (subPeriodEnd) {
          updateData.current_period_end = subPeriodEnd;
        }

        // If subscription is set to cancel at period end but still active,
        // keep status as 'active' — perks remain until period end
        if (subscription.cancel_at_period_end && subscription.status === "active") {
          updateData.cancelled_at = new Date().toISOString();
        }

        await supabase
          .from("user_memberships")
          .update(updateData)
          .eq("stripe_subscription_id", subscription.id);

        console.log(
          `[stripe/webhooks/connect] customer.subscription.updated: sub=${subscription.id}, cancel_at_period_end=${subscription.cancel_at_period_end}`
        );
        break;
      }

      default:
        console.log(
          `[stripe/webhooks/connect] Unhandled event type: ${event.type}`
        );
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[stripe/webhooks/connect] Processing error:", err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
