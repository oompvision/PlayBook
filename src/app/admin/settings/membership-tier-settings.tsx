"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { StickyFooter } from "@/components/admin/sticky-footer";
import { Toast } from "@/components/ui/toast";

type DiscountType = "flat" | "percent";

type MembershipTierSettingsProps = {
  orgId: string;
  initialEnabled: boolean;
  initialBookableWindowDays: number;
  initialGuestBookableWindowDays: number | null;
  initialMemberBookableWindowDays: number | null;
  initialTier: {
    name: string;
    benefit_description: string | null;
    discount_type: DiscountType;
    discount_value: number;
    event_discount_type: DiscountType;
    event_discount_value: number;
    price_monthly_cents: number | null;
    price_yearly_cents: number | null;
  } | null;
  stripeConnected: boolean;
  activeStripeSubscriberCount: number;
};

export function MembershipTierSettings({
  initialEnabled,
  initialBookableWindowDays,
  initialGuestBookableWindowDays,
  initialMemberBookableWindowDays,
  initialTier,
  stripeConnected,
  activeStripeSubscriberCount,
}: MembershipTierSettingsProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tier config
  const [tierName, setTierName] = useState(initialTier?.name ?? "Membership");
  const [benefitDescription, setBenefitDescription] = useState(
    initialTier?.benefit_description ?? ""
  );
  const [discountType, setDiscountType] = useState<DiscountType>(
    initialTier?.discount_type ?? "percent"
  );
  const [discountValue, setDiscountValue] = useState(
    initialTier?.discount_value?.toString() ?? "0"
  );
  const [eventDiscountType, setEventDiscountType] = useState<DiscountType>(
    initialTier?.event_discount_type ?? "percent"
  );
  const [eventDiscountValue, setEventDiscountValue] = useState(
    initialTier?.event_discount_value?.toString() ?? "0"
  );
  const [priceMonthly, setPriceMonthly] = useState(
    initialTier?.price_monthly_cents != null
      ? (initialTier.price_monthly_cents / 100).toFixed(2)
      : ""
  );
  const [priceYearly, setPriceYearly] = useState(
    initialTier?.price_yearly_cents != null
      ? (initialTier.price_yearly_cents / 100).toFixed(2)
      : ""
  );

  // Bookable windows
  const [guestWindow, setGuestWindow] = useState(
    initialGuestBookableWindowDays ?? initialBookableWindowDays
  );
  const [memberWindow, setMemberWindow] = useState(
    initialMemberBookableWindowDays ?? initialBookableWindowDays
  );

  // Disable guard
  const [showDisableError, setShowDisableError] = useState(false);

  const hasChanges =
    enabled !== initialEnabled ||
    (enabled && (
      tierName !== (initialTier?.name ?? "Membership") ||
      benefitDescription !== (initialTier?.benefit_description ?? "") ||
      discountType !== (initialTier?.discount_type ?? "percent") ||
      discountValue !== (initialTier?.discount_value?.toString() ?? "0") ||
      eventDiscountType !== (initialTier?.event_discount_type ?? "percent") ||
      eventDiscountValue !== (initialTier?.event_discount_value?.toString() ?? "0") ||
      priceMonthly !== (initialTier?.price_monthly_cents != null ? (initialTier.price_monthly_cents / 100).toFixed(2) : "") ||
      priceYearly !== (initialTier?.price_yearly_cents != null ? (initialTier.price_yearly_cents / 100).toFixed(2) : "") ||
      guestWindow !== (initialGuestBookableWindowDays ?? initialBookableWindowDays) ||
      memberWindow !== (initialMemberBookableWindowDays ?? initialBookableWindowDays)
    ));

  function handleToggle() {
    if (enabled) {
      // Trying to disable
      if (activeStripeSubscriberCount > 0) {
        setShowDisableError(true);
        return;
      }
      setEnabled(false);
      setShowDisableError(false);
    } else {
      // Enabling
      if (!stripeConnected) {
        setError(
          "Stripe Connect must be set up before enabling Membership Tiers."
        );
        return;
      }
      setEnabled(true);
      setError(null);
    }
    setShowToast(false);
  }

  async function handleSave() {
    setError(null);
    setShowToast(false);

    // Validation
    if (enabled) {
      if (!priceMonthly && !priceYearly) {
        setError("At least one subscription price (monthly or yearly) is required.");
        return;
      }
      if (memberWindow < guestWindow) {
        setError("Member Bookable Window must be greater than or equal to the Guest Bookable Window.");
        return;
      }
      const dv = parseFloat(discountValue);
      if (isNaN(dv) || dv < 0) {
        setError("Discount value must be a positive number.");
        return;
      }
      if (discountType === "percent" && dv > 100) {
        setError("Percentage discount cannot exceed 100%.");
        return;
      }
      const edv = parseFloat(eventDiscountValue);
      if (isNaN(edv) || edv < 0) {
        setError("Event discount value must be a positive number.");
        return;
      }
      if (eventDiscountType === "percent" && edv > 100) {
        setError("Event percentage discount cannot exceed 100%.");
        return;
      }
    }

    setSaving(true);

    try {
      const res = await fetch("/api/admin/membership-tier", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          tier_name: tierName,
          benefit_description: benefitDescription || null,
          discount_type: discountType,
          discount_value: parseFloat(discountValue) || 0,
          event_discount_type: eventDiscountType,
          event_discount_value: parseFloat(eventDiscountValue) || 0,
          price_monthly_cents: priceMonthly
            ? Math.round(parseFloat(priceMonthly) * 100)
            : null,
          price_yearly_cents: priceYearly
            ? Math.round(parseFloat(priceYearly) * 100)
            : null,
          guest_booking_window_days: guestWindow,
          member_booking_window_days: memberWindow,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      setShowToast(true);
      // Reload after short delay so admin sees updated state
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="space-y-6">
        {/* Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-white/90">
              Enable Membership Tiers
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Allow customers to subscribe for premium booking perks.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={handleToggle}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
              enabled ? "bg-blue-600" : "bg-gray-200 dark:bg-gray-700"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* Disable guard error */}
        {showDisableError && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Cannot disable Membership Tiers
              </p>
              <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                There {activeStripeSubscriberCount === 1 ? "is" : "are"}{" "}
                {activeStripeSubscriberCount} active Stripe{" "}
                {activeStripeSubscriberCount === 1
                  ? "subscriber"
                  : "subscribers"}
                . Cancel all subscriptions first or wait for them to lapse before
                disabling.
              </p>
            </div>
          </div>
        )}

        {/* Stripe not connected warning */}
        {!stripeConnected && !enabled && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-white/5">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Stripe Connect must be set up before enabling Membership Tiers.
              Configure it in the Payment Processing section below.
            </p>
          </div>
        )}

        {/* Configuration (only when enabled) */}
        {enabled && (
          <>
            {/* Tier Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Membership Name
              </label>
              <input
                type="text"
                value={tierName}
                onChange={(e) => setTierName(e.target.value)}
                placeholder="e.g. Pro Member"
                className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              />
            </div>

            {/* Pricing */}
            <div className="border-t border-gray-200 pt-6 dark:border-white/[0.05]">
              <h3 className="mb-4 text-sm font-semibold text-gray-800 dark:text-white/90">
                Subscription Pricing
              </h3>
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                Set at least one price. Customers will see all enabled options on
                the Member Benefits page.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    Monthly Price ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={priceMonthly}
                    onChange={(e) => setPriceMonthly(e.target.value)}
                    placeholder="e.g. 29.99"
                    className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    Yearly Price ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={priceYearly}
                    onChange={(e) => setPriceYearly(e.target.value)}
                    placeholder="e.g. 249.99"
                    className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                  />
                </div>
              </div>
            </div>

            {/* Bookable Windows */}
            <div className="border-t border-gray-200 pt-6 dark:border-white/[0.05]">
              <h3 className="mb-4 text-sm font-semibold text-gray-800 dark:text-white/90">
                Bookable Window
              </h3>
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                How far in advance each tier can book. Members must have an equal
                or longer window than guests.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    Guest Bookable Window (days)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={guestWindow}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 1;
                      setGuestWindow(val);
                      if (memberWindow < val) setMemberWindow(val);
                    }}
                    className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    Member Bookable Window (days)
                  </label>
                  <input
                    type="number"
                    min={guestWindow}
                    max="365"
                    value={memberWindow}
                    onChange={(e) =>
                      setMemberWindow(parseInt(e.target.value) || guestWindow)
                    }
                    className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                  />
                </div>
              </div>
            </div>

            {/* Discount */}
            <div className="border-t border-gray-200 pt-6 dark:border-white/[0.05]">
              <h3 className="mb-4 text-sm font-semibold text-gray-800 dark:text-white/90">
                Member Discount
              </h3>
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                Applied automatically at checkout for members. Set to 0 for no
                discount.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    Discount Type
                  </label>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setDiscountType("percent")}
                      className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors ${
                        discountType === "percent"
                          ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/20 dark:text-blue-300"
                          : "border-gray-200 text-gray-600 hover:border-gray-300 dark:border-white/10 dark:text-gray-400 dark:hover:border-white/20"
                      }`}
                    >
                      Percentage (%)
                    </button>
                    <button
                      type="button"
                      onClick={() => setDiscountType("flat")}
                      className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors ${
                        discountType === "flat"
                          ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/20 dark:text-blue-300"
                          : "border-gray-200 text-gray-600 hover:border-gray-300 dark:border-white/10 dark:text-gray-400 dark:hover:border-white/20"
                      }`}
                    >
                      Flat Amount ($)
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    {discountType === "percent"
                      ? "Discount Percentage"
                      : "Discount Amount ($)"}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step={discountType === "percent" ? "1" : "0.01"}
                    max={discountType === "percent" ? "100" : undefined}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    placeholder={
                      discountType === "percent" ? "e.g. 10" : "e.g. 5.00"
                    }
                    className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                  />
                </div>
              </div>
            </div>

            {/* Event Discount */}
            <div className="border-t border-gray-200 pt-6 dark:border-white/[0.05]">
              <h3 className="mb-4 text-sm font-semibold text-gray-800 dark:text-white/90">
                Event Registration Discount
              </h3>
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                Separate discount for event registration. Set to 0 for no event
                discount.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    Discount Type
                  </label>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setEventDiscountType("percent")}
                      className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors ${
                        eventDiscountType === "percent"
                          ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/20 dark:text-blue-300"
                          : "border-gray-200 text-gray-600 hover:border-gray-300 dark:border-white/10 dark:text-gray-400 dark:hover:border-white/20"
                      }`}
                    >
                      Percentage (%)
                    </button>
                    <button
                      type="button"
                      onClick={() => setEventDiscountType("flat")}
                      className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors ${
                        eventDiscountType === "flat"
                          ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/20 dark:text-blue-300"
                          : "border-gray-200 text-gray-600 hover:border-gray-300 dark:border-white/10 dark:text-gray-400 dark:hover:border-white/20"
                      }`}
                    >
                      Flat Amount ($)
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    {eventDiscountType === "percent"
                      ? "Discount Percentage"
                      : "Discount Amount ($)"}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step={eventDiscountType === "percent" ? "1" : "0.01"}
                    max={eventDiscountType === "percent" ? "100" : undefined}
                    value={eventDiscountValue}
                    onChange={(e) => setEventDiscountValue(e.target.value)}
                    placeholder={
                      eventDiscountType === "percent" ? "e.g. 10" : "e.g. 5.00"
                    }
                    className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                  />
                </div>
              </div>
            </div>

            {/* Benefit Description */}
            <div className="border-t border-gray-200 pt-6 dark:border-white/[0.05]">
              <h3 className="mb-4 text-sm font-semibold text-gray-800 dark:text-white/90">
                Benefit Description
              </h3>
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                Optional text shown on the Member Benefits page. Describe what
                makes your membership worthwhile.
              </p>
              <textarea
                value={benefitDescription}
                onChange={(e) => setBenefitDescription(e.target.value)}
                rows={4}
                placeholder="e.g. Members also get priority lane access and a free locker."
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
              />
            </div>

          </>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}
      </div>

      <StickyFooter
        isDirty={hasChanges}
        saving={saving}
        onSave={handleSave}
        submitLabel="Save Membership Settings"
      />

      {showToast && (
        <Toast
          message="Membership settings saved."
          duration={5000}
          onClose={() => setShowToast(false)}
        />
      )}
    </>
  );
}
