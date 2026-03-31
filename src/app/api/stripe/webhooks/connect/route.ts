import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import Stripe from "stripe";
import { logAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

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
    logger.error("[stripe/webhooks/connect] Signature verification failed", { message });
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

        logger.info(
          `[stripe/webhooks/connect] account.updated: ${account.id} → onboarding_complete=${isComplete}`
        );

        logAudit({
          action: "update",
          resourceType: "stripe_account",
          resourceId: account.id,
          metadata: { event_type: "account.updated", onboarding_complete: isComplete },
        });
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
          logger.error(
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

        logger.info(
          `[stripe/webhooks/connect] checkout.session.completed: user=${user_id} org=${org_id} → active`
        );

        logAudit({
          orgId: org_id,
          userId: user_id,
          action: "create",
          resourceType: "membership",
          resourceId: subscription.id,
          metadata: { event_type: "checkout.session.completed", tier_id },
        });
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;

        // Only handle subscription invoices (API 2025-03-31+: subscription is under parent)
        const subDetail = invoice.parent?.subscription_details;
        if (!subDetail?.subscription) break;

        const subscriptionId =
          typeof subDetail.subscription === "string"
            ? subDetail.subscription
            : subDetail.subscription.id;

        // Get the period end from the invoice line items
        const lineItem = invoice.lines?.data?.[0];
        const periodEnd = lineItem?.period?.end;

        if (periodEnd) {
          const updateData: Record<string, unknown> = {
            status: "active",
            current_period_end: new Date(periodEnd * 1000).toISOString(),
          };

          // Check for pending tier change — retrieve subscription metadata
          try {
            const sub = await stripe.subscriptions.retrieve(
              subscriptionId,
              {},
              { stripeAccount: event.account! } as Stripe.RequestOptions
            );
            if (sub.metadata?.pending_tier_id) {
              updateData.tier_id = sub.metadata.pending_tier_id;
              // Clear the pending flag
              await stripe.subscriptions.update(
                subscriptionId,
                { metadata: { pending_tier_id: "" } },
                { stripeAccount: event.account! } as Stripe.RequestOptions
              );
              logger.info(
                `[stripe/webhooks/connect] invoice.payment_succeeded: tier changed to ${sub.metadata.pending_tier_id}`
              );
            }
          } catch (tierErr) {
            logger.error("[stripe/webhooks/connect] Error checking pending tier change", tierErr);
          }

          await supabase
            .from("user_memberships")
            .update(updateData)
            .eq("stripe_subscription_id", subscriptionId);

          logger.info(
            `[stripe/webhooks/connect] invoice.payment_succeeded: sub=${subscriptionId} → active`
          );
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;

        const failedSubDetail = invoice.parent?.subscription_details;
        if (!failedSubDetail?.subscription) break;

        const subscriptionId =
          typeof failedSubDetail.subscription === "string"
            ? failedSubDetail.subscription
            : failedSubDetail.subscription.id;

        await supabase
          .from("user_memberships")
          .update({ status: "past_due" })
          .eq("stripe_subscription_id", subscriptionId);

        logger.warn(
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

        logger.info(
          `[stripe/webhooks/connect] customer.subscription.deleted: sub=${subscription.id} → cancelled`
        );

        logAudit({
          action: "update",
          resourceType: "membership",
          resourceId: subscription.id,
          metadata: { event_type: "customer.subscription.deleted", status: "cancelled" },
        });
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

        logger.info(
          `[stripe/webhooks/connect] customer.subscription.updated: sub=${subscription.id}, cancel_at_period_end=${subscription.cancel_at_period_end}`
        );
        break;
      }

      default:
        logger.info(
          `[stripe/webhooks/connect] Unhandled event type: ${event.type}`
        );
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    logger.error("[stripe/webhooks/connect] Processing error", err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
