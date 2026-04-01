"use client";

import { useState, useCallback } from "react";
import { AlertTriangle, Plus, Trash2, ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { StickyFooter } from "@/components/admin/sticky-footer";
import { Toast } from "@/components/ui/toast";

type DiscountType = "flat" | "percent";
type CreditPeriod = "daily" | "weekly" | "monthly";
type CreditType = "hours" | "value" | null;

type TierData = {
  id?: string;
  sort_order: number;
  tier_name: string;
  benefit_description: string;
  discount_type: DiscountType;
  discount_value: string;
  event_discount_type: DiscountType;
  event_discount_value: string;
  price_monthly: string;
  price_yearly: string;
  bookable_window_days: string;
  credit_amount: string;
  credit_period: CreditPeriod | "";
};

type TierSubscriberCounts = Record<string, number>;

type MembershipTiersSettingsProps = {
  orgId: string;
  initialEnabled: boolean;
  initialBookableWindowDays: number;
  initialGuestBookableWindowDays: number | null;
  initialCreditType: CreditType;
  initialTiers: Array<{
    id: string;
    sort_order: number;
    name: string;
    benefit_description: string | null;
    discount_type: DiscountType;
    discount_value: number;
    event_discount_type: DiscountType;
    event_discount_value: number;
    price_monthly_cents: number | null;
    price_yearly_cents: number | null;
    bookable_window_days: number | null;
    credit_amount: number | null;
    credit_period: CreditPeriod | null;
  }>;
  stripeConnected: boolean;
  activeStripeSubscriberCount: number;
  tierSubscriberCounts: TierSubscriberCounts;
};

function makeTierData(tier?: MembershipTiersSettingsProps["initialTiers"][0], orgCreditType?: CreditType): TierData {
  if (!tier) {
    return {
      sort_order: 1,
      tier_name: "",
      benefit_description: "",
      discount_type: "percent",
      discount_value: "0",
      event_discount_type: "percent",
      event_discount_value: "0",
      price_monthly: "",
      price_yearly: "",
      bookable_window_days: "",
      credit_amount: "",
      credit_period: "",
    };
  }

  // For value-based credits, DB stores cents — display as dollars
  let creditAmountDisplay = "";
  if (tier.credit_amount != null) {
    creditAmountDisplay = orgCreditType === "value"
      ? (tier.credit_amount / 100).toFixed(2)
      : tier.credit_amount.toString();
  }

  return {
    id: tier.id,
    sort_order: tier.sort_order,
    tier_name: tier.name,
    benefit_description: tier.benefit_description ?? "",
    discount_type: tier.discount_type,
    discount_value: tier.discount_value.toString(),
    event_discount_type: tier.event_discount_type,
    event_discount_value: tier.event_discount_value.toString(),
    price_monthly: tier.price_monthly_cents != null ? (tier.price_monthly_cents / 100).toFixed(2) : "",
    price_yearly: tier.price_yearly_cents != null ? (tier.price_yearly_cents / 100).toFixed(2) : "",
    bookable_window_days: tier.bookable_window_days?.toString() ?? "",
    credit_amount: creditAmountDisplay,
    credit_period: tier.credit_period ?? "",
  };
}

const inputClass =
  "h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30";

const labelClass = "text-xs font-medium text-gray-500 dark:text-gray-400";

function DiscountTypeToggle({
  value,
  onChange,
}: {
  value: DiscountType;
  onChange: (v: DiscountType) => void;
}) {
  return (
    <div className="flex gap-2">
      {(["percent", "flat"] as const).map((type) => (
        <button
          key={type}
          type="button"
          onClick={() => onChange(type)}
          className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors ${
            value === type
              ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/20 dark:text-blue-300"
              : "border-gray-200 text-gray-600 hover:border-gray-300 dark:border-white/10 dark:text-gray-400 dark:hover:border-white/20"
          }`}
        >
          {type === "percent" ? "Percentage (%)" : "Flat Amount ($)"}
        </button>
      ))}
    </div>
  );
}

function TierCard({
  tier,
  index,
  creditType,
  subscriberCount,
  expanded,
  onToggleExpand,
  onChange,
  onRemove,
  canRemove,
}: {
  tier: TierData;
  index: number;
  creditType: CreditType;
  subscriberCount: number;
  expanded: boolean;
  onToggleExpand: () => void;
  onChange: (updates: Partial<TierData>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
      {/* Header */}
      <div
        className="flex cursor-pointer items-center gap-3 px-4 py-3"
        onClick={onToggleExpand}
      >
        <GripVertical className="h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              {tier.sort_order}
            </span>
            <span className="text-sm font-medium text-gray-800 dark:text-white/90 truncate">
              {tier.tier_name || `Tier ${index + 1}`}
            </span>
            {tier.price_monthly && (
              <span className="text-xs text-gray-400">
                ${parseFloat(tier.price_monthly).toFixed(2)}/mo
              </span>
            )}
          </div>
        </div>
        {subscriberCount > 0 && (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
            {subscriberCount} subscriber{subscriberCount !== 1 ? "s" : ""}
          </span>
        )}
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        )}
      </div>

      {/* Body */}
      {expanded && (
        <div className="space-y-5 border-t border-gray-200 px-4 py-4 dark:border-white/[0.05]">
          {/* Name + Level */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className={labelClass}>Tier Name</label>
              <input
                type="text"
                value={tier.tier_name}
                onChange={(e) => onChange({ tier_name: e.target.value })}
                placeholder="e.g. Gold Member"
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Level (1 = lowest)</label>
              <input
                type="number"
                min={1}
                max={10}
                value={tier.sort_order}
                onChange={(e) => onChange({ sort_order: parseInt(e.target.value) || 1 })}
                className={inputClass}
              />
            </div>
          </div>

          {/* Pricing */}
          <div className="border-t border-gray-100 pt-4 dark:border-white/[0.03]">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Subscription Pricing
            </h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className={labelClass}>Monthly Price ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={tier.price_monthly}
                  onChange={(e) => onChange({ price_monthly: e.target.value })}
                  placeholder="e.g. 29.99"
                  className={inputClass}
                />
              </div>
              <div className="space-y-1.5">
                <label className={labelClass}>Yearly Price ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={tier.price_yearly}
                  onChange={(e) => onChange({ price_yearly: e.target.value })}
                  placeholder="e.g. 249.99"
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* Bookable Window */}
          <div className="border-t border-gray-100 pt-4 dark:border-white/[0.03]">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Booking Window
            </h4>
            <div className="space-y-1.5">
              <label className={labelClass}>
                Bookable Window (days) — leave empty to use org default
              </label>
              <input
                type="number"
                min={1}
                max={365}
                value={tier.bookable_window_days}
                onChange={(e) => onChange({ bookable_window_days: e.target.value })}
                placeholder="Inherit from org default"
                className={inputClass}
              />
            </div>
          </div>

          {/* Member Discount */}
          <div className="border-t border-gray-100 pt-4 dark:border-white/[0.03]">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Member Discount
            </h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className={labelClass}>Discount Type</label>
                <DiscountTypeToggle
                  value={tier.discount_type}
                  onChange={(v) => onChange({ discount_type: v })}
                />
              </div>
              <div className="space-y-1.5">
                <label className={labelClass}>
                  {tier.discount_type === "percent" ? "Discount %" : "Discount Amount ($)"}
                </label>
                <input
                  type="number"
                  min="0"
                  step={tier.discount_type === "percent" ? "1" : "0.01"}
                  max={tier.discount_type === "percent" ? "100" : undefined}
                  value={tier.discount_value}
                  onChange={(e) => onChange({ discount_value: e.target.value })}
                  placeholder={tier.discount_type === "percent" ? "e.g. 10" : "e.g. 5.00"}
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* Event Discount */}
          <div className="border-t border-gray-100 pt-4 dark:border-white/[0.03]">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Event Discount
            </h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className={labelClass}>Discount Type</label>
                <DiscountTypeToggle
                  value={tier.event_discount_type}
                  onChange={(v) => onChange({ event_discount_type: v })}
                />
              </div>
              <div className="space-y-1.5">
                <label className={labelClass}>
                  {tier.event_discount_type === "percent" ? "Discount %" : "Discount Amount ($)"}
                </label>
                <input
                  type="number"
                  min="0"
                  step={tier.event_discount_type === "percent" ? "1" : "0.01"}
                  max={tier.event_discount_type === "percent" ? "100" : undefined}
                  value={tier.event_discount_value}
                  onChange={(e) => onChange({ event_discount_value: e.target.value })}
                  placeholder={tier.event_discount_type === "percent" ? "e.g. 10" : "e.g. 5.00"}
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* Credits (only shown when org has credit_type set) */}
          {creditType && (
            <div className="border-t border-gray-100 pt-4 dark:border-white/[0.03]">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                Credits / Free Sessions
              </h4>
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                {creditType === "hours"
                  ? "Grant free play time (in minutes) per period. E.g. 60 = 1 hour."
                  : "Grant credit value per period in dollars. E.g. 50.00 = $50.00."}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className={labelClass}>
                    {creditType === "hours" ? "Credit Amount (minutes)" : "Credit Amount"}
                  </label>
                  <div className="relative">
                    {creditType === "value" && (
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                    )}
                    <input
                      type="number"
                      min="0"
                      step={creditType === "hours" ? "1" : "0.01"}
                      value={tier.credit_amount}
                      onChange={(e) => onChange({ credit_amount: e.target.value })}
                      placeholder={creditType === "hours" ? "e.g. 60" : "e.g. 50.00"}
                      className={`${inputClass} ${creditType === "value" ? "pl-7" : ""}`}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className={labelClass}>Credit Period</label>
                  <select
                    value={tier.credit_period}
                    onChange={(e) => onChange({ credit_period: e.target.value as CreditPeriod | "" })}
                    className={inputClass}
                  >
                    <option value="">No credits</option>
                    <option value="daily">Per Day</option>
                    <option value="weekly">Per Week</option>
                    <option value="monthly">Per Month</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Benefit Description */}
          <div className="border-t border-gray-100 pt-4 dark:border-white/[0.03]">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Benefit Description
            </h4>
            <textarea
              value={tier.benefit_description}
              onChange={(e) => onChange({ benefit_description: e.target.value })}
              rows={3}
              placeholder="e.g. Priority lane access, free locker..."
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
            />
          </div>

          {/* Remove button */}
          {canRemove && (
            <div className="border-t border-gray-100 pt-4 dark:border-white/[0.03]">
              {subscriberCount > 0 ? (
                <p className="text-xs text-gray-400">
                  Cannot remove — {subscriberCount} active subscriber{subscriberCount !== 1 ? "s" : ""}.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={onRemove}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 transition-colors hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove Tier
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MembershipTiersSettings({
  initialEnabled,
  initialBookableWindowDays,
  initialGuestBookableWindowDays,
  initialCreditType,
  initialTiers,
  stripeConnected,
  activeStripeSubscriberCount,
  tierSubscriberCounts,
}: MembershipTiersSettingsProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Org-level settings
  const [guestWindow, setGuestWindow] = useState(
    initialGuestBookableWindowDays ?? initialBookableWindowDays
  );
  const [creditType, setCreditType] = useState<CreditType>(initialCreditType);

  // Tiers
  const [tiers, setTiers] = useState<TierData[]>(
    initialTiers.length > 0
      ? initialTiers.map((t) => makeTierData(t, initialCreditType))
      : [{ ...makeTierData(undefined, initialCreditType), sort_order: 1, tier_name: "Membership" }]
  );
  const [expandedIndex, setExpandedIndex] = useState<number | null>(
    tiers.length > 0 ? 0 : null
  );

  // Disable guard
  const [showDisableError, setShowDisableError] = useState(false);

  const updateTier = useCallback(
    (index: number, updates: Partial<TierData>) => {
      setTiers((prev) => prev.map((t, i) => (i === index ? { ...t, ...updates } : t)));
    },
    []
  );

  function addTier() {
    if (tiers.length >= 10) return;
    const maxOrder = Math.max(0, ...tiers.map((t) => t.sort_order));
    const newTier = makeTierData();
    newTier.sort_order = Math.min(10, maxOrder + 1);
    setTiers([...tiers, newTier]);
    setExpandedIndex(tiers.length);
  }

  function removeTier(index: number) {
    setTiers((prev) => prev.filter((_, i) => i !== index));
    setExpandedIndex(null);
  }

  function handleToggle() {
    if (enabled) {
      if (activeStripeSubscriberCount > 0) {
        setShowDisableError(true);
        return;
      }
      setEnabled(false);
      setShowDisableError(false);
    } else {
      if (!stripeConnected) {
        setError("Stripe Connect must be set up before enabling Membership Tiers.");
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

    if (enabled) {
      // Validate tiers
      for (const tier of tiers) {
        if (!tier.tier_name.trim()) {
          setError("All tiers must have a name.");
          return;
        }
        if (!tier.price_monthly && !tier.price_yearly) {
          setError(`Tier "${tier.tier_name}" must have at least one subscription price.`);
          return;
        }
        const dv = parseFloat(tier.discount_value);
        if (isNaN(dv) || dv < 0) {
          setError(`Tier "${tier.tier_name}": discount must be a positive number.`);
          return;
        }
        if (tier.discount_type === "percent" && dv > 100) {
          setError(`Tier "${tier.tier_name}": percentage discount cannot exceed 100%.`);
          return;
        }
        const edv = parseFloat(tier.event_discount_value);
        if (isNaN(edv) || edv < 0) {
          setError(`Tier "${tier.tier_name}": event discount must be a positive number.`);
          return;
        }
        if (tier.event_discount_type === "percent" && edv > 100) {
          setError(`Tier "${tier.tier_name}": event percentage discount cannot exceed 100%.`);
          return;
        }
      }

      // Check sort_order uniqueness
      const orders = tiers.map((t) => t.sort_order);
      if (new Set(orders).size !== orders.length) {
        setError("Each tier must have a unique level number.");
        return;
      }
    }

    setSaving(true);

    try {
      const res = await fetch("/api/admin/membership-tiers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          guest_booking_window_days: guestWindow,
          credit_type: creditType,
          tiers: tiers.map((t) => ({
            id: t.id,
            sort_order: t.sort_order,
            tier_name: t.tier_name,
            benefit_description: t.benefit_description || undefined,
            discount_type: t.discount_type,
            discount_value: parseFloat(t.discount_value) || 0,
            event_discount_type: t.event_discount_type,
            event_discount_value: parseFloat(t.event_discount_value) || 0,
            price_monthly_cents: t.price_monthly
              ? Math.round(parseFloat(t.price_monthly) * 100)
              : null,
            price_yearly_cents: t.price_yearly
              ? Math.round(parseFloat(t.price_yearly) * 100)
              : null,
            bookable_window_days: t.bookable_window_days
              ? parseInt(t.bookable_window_days)
              : null,
            credit_amount: t.credit_amount
              ? (creditType === "value"
                ? Math.round(parseFloat(t.credit_amount) * 100)
                : parseInt(t.credit_amount))
              : null,
            credit_period: t.credit_period || null,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      setShowToast(true);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  // Simple dirty check (always allow save to simplify)
  const hasChanges = true;

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
              Offer tiered memberships with different pricing, discounts, and perks.
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
                {activeStripeSubscriberCount === 1 ? "subscriber" : "subscribers"}.
                Cancel all subscriptions first.
              </p>
            </div>
          </div>
        )}

        {/* Stripe not connected warning */}
        {!stripeConnected && !enabled && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-white/5">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Stripe Connect must be set up before enabling Membership Tiers.
              Configure it in the Payment Processing section.
            </p>
          </div>
        )}

        {/* Configuration (only when enabled) */}
        {enabled && (
          <>
            {/* Org-level settings */}
            <div className="border-t border-gray-200 pt-6 dark:border-white/[0.05]">
              <h3 className="mb-4 text-sm font-semibold text-gray-800 dark:text-white/90">
                Organization Settings
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className={labelClass}>Guest Bookable Window (days)</label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={guestWindow}
                    onChange={(e) => setGuestWindow(parseInt(e.target.value) || 1)}
                    className={inputClass}
                  />
                  <p className="text-xs text-gray-400">
                    Non-members can book this many days ahead. Tiers can override with a longer window.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className={labelClass}>Credit Type</label>
                  <select
                    value={creditType ?? ""}
                    onChange={(e) =>
                      setCreditType(e.target.value === "" ? null : (e.target.value as CreditType))
                    }
                    className={inputClass}
                  >
                    <option value="">No Credits</option>
                    <option value="hours">Hour-Based (free play time)</option>
                    <option value="value">Value-Based (dollar credit)</option>
                  </select>
                  <p className="text-xs text-gray-400">
                    {creditType === "hours"
                      ? "Members get free play time (minutes) per period."
                      : creditType === "value"
                        ? "Members get dollar credit per period, deducted at checkout."
                        : "Enable to give members free sessions or credit per period."}
                  </p>
                </div>
              </div>
            </div>

            {/* Tier list */}
            <div className="border-t border-gray-200 pt-6 dark:border-white/[0.05]">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">
                  Membership Tiers ({tiers.length}/10)
                </h3>
                {tiers.length < 10 && (
                  <button
                    type="button"
                    onClick={addTier}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Tier
                  </button>
                )}
              </div>
              <div className="space-y-3">
                {tiers
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((tier, i) => (
                    <TierCard
                      key={tier.id ?? `new-${i}`}
                      tier={tier}
                      index={i}
                      creditType={creditType}
                      subscriberCount={tier.id ? tierSubscriberCounts[tier.id] ?? 0 : 0}
                      expanded={expandedIndex === i}
                      onToggleExpand={() =>
                        setExpandedIndex(expandedIndex === i ? null : i)
                      }
                      onChange={(updates) => updateTier(i, updates)}
                      onRemove={() => removeTier(i)}
                      canRemove={tiers.length > 1}
                    />
                  ))}
              </div>
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
