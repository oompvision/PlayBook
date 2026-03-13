export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { getFacilitySlug } from "@/lib/facility";
import { redirect } from "next/navigation";
import { PaymentSettings } from "../payment-settings";
import { CancellationPolicySettings } from "../cancellation-policy-settings";
import { SettingsAccordion } from "@/components/admin/settings-accordion";
import { CreditCard, ShieldCheck } from "lucide-react";

async function getOrg() {
  const slug = await getFacilitySlug();
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .single();
  return data;
}

export default async function PaymentSettingsPage() {
  const org = await getOrg();
  if (!org) redirect("/");

  const supabase = await createClient();

  const { data: paymentSettings } = await supabase
    .from("org_payment_settings")
    .select(
      "stripe_account_id, stripe_onboarding_complete, payment_mode, cancellation_window_hours, no_show_fee_cents, no_show_fee_type, processing_fee_absorbed_by, cancellation_policy_text"
    )
    .eq("org_id", org.id)
    .single();

  const initialPaymentSettings = paymentSettings || {
    stripe_account_id: null,
    stripe_onboarding_complete: false,
    payment_mode: "none",
    cancellation_window_hours: 24,
    no_show_fee_cents: null,
    no_show_fee_type: "fixed",
    processing_fee_absorbed_by: "customer",
  };

  const initialCancellationSettings = {
    payment_mode: paymentSettings?.payment_mode || "none",
    cancellation_window_hours: paymentSettings?.cancellation_window_hours ?? 24,
    cancellation_policy_text: paymentSettings?.cancellation_policy_text || null,
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
          Payment Settings
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Manage payment processing and cancellation policies.
        </p>
      </div>

      {/* Payment Processing */}
      <SettingsAccordion
        icon={CreditCard}
        title="Payment Processing"
        description="Connect your Stripe account to collect payments from customers."
        defaultOpen
      >
        <PaymentSettings initialSettings={initialPaymentSettings} />
      </SettingsAccordion>

      {/* Cancellation Policy */}
      <SettingsAccordion
        icon={ShieldCheck}
        title="Cancellation Policy"
        description="Configure your cancellation window and refund policy."
      >
        <CancellationPolicySettings initialSettings={initialCancellationSettings} />
      </SettingsAccordion>
    </div>
  );
}
