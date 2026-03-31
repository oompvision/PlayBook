"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Crown,
  Check,
  ArrowRight,
  Calendar,
  BadgePercent,
  Gift,
  Clock,
  DollarSign,
  ArrowUpRight,
} from "lucide-react";

type TierInfo = {
  id: string;
  sortOrder: number;
  name: string;
  benefitDescription: string | null;
  discountType: "flat" | "percent";
  discountValue: number;
  priceMonthly: number | null;
  priceYearly: number | null;
  bookableWindowDays: number | null;
  creditAmount: number | null;
  creditPeriod: "daily" | "weekly" | "monthly" | null;
};

type MembershipPageProps = {
  orgName: string;
  tiers: TierInfo[];
  creditType: "hours" | "value" | null;
  guestWindow: number;
  defaultMemberWindow: number;
  isAuthenticated: boolean;
  membership: {
    status: string;
    source: string;
    tierId: string;
    currentPeriodEnd: string | null;
    expiresAt: string | null;
    cancelledAt: string | null;
    hasActivePerks: boolean;
  } | null;
  creditBalance: {
    has_credits: boolean;
    credits_total: number;
    credits_used: number;
    credits_remaining: number;
    credit_type: string | null;
    credit_period: string | null;
    period_end: string | null;
  } | null;
  showSuccess?: boolean;
  showCancelled?: boolean;
};

export function MembershipPage({
  orgName,
  tiers,
  creditType,
  guestWindow,
  defaultMemberWindow,
  isAuthenticated,
  membership,
  creditBalance,
  showSuccess,
  showCancelled,
}: MembershipPageProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<"month" | "year">("month");

  const isMember = membership?.hasActivePerks ?? false;
  const currentTier = isMember
    ? tiers.find((t) => t.id === membership?.tierId) ?? null
    : null;
  const isCancelledButActive =
    membership?.status === "cancelled" && membership?.hasActivePerks;
  const isPastDue = membership?.status === "past_due";
  const isAdminGranted = membership?.status === "admin_granted";

  async function handleJoin(tierId: string) {
    if (!isAuthenticated) {
      router.push(`/auth/login?return_to=/membership`);
      return;
    }

    setLoading(tierId);
    setError(null);

    try {
      const res = await fetch("/api/stripe/membership-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval: billingInterval, tier_id: tierId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to start checkout");
      }

      const { url } = await res.json();
      if (url) window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(null);
    }
  }

  async function handleChangeTier(tierId: string) {
    setLoading(tierId);
    setError(null);

    try {
      const res = await fetch("/api/stripe/membership-change-tier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier_id: tierId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to change tier");
      }

      const data = await res.json();
      if (data.effective === "immediate") {
        window.location.reload();
      } else {
        setError(null);
        // Show success and reload
        window.location.reload();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(null);
    }
  }

  async function handleManageSubscription() {
    setLoading("portal");
    setError(null);

    try {
      const res = await fetch("/api/stripe/membership-portal", {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to open portal");
      }

      const { url } = await res.json();
      if (url) window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(null);
    }
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "\u2014";
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function formatDiscount(tier: TierInfo) {
    if (tier.discountValue === 0) return null;
    return tier.discountType === "percent"
      ? `${tier.discountValue}% off`
      : `$${tier.discountValue.toFixed(2)} off`;
  }

  function formatCredits(tier: TierInfo) {
    if (!tier.creditAmount || !tier.creditPeriod || !creditType) return null;
    const periodLabel =
      tier.creditPeriod === "daily"
        ? "/day"
        : tier.creditPeriod === "weekly"
          ? "/week"
          : "/month";
    if (creditType === "hours") {
      const hours = tier.creditAmount / 60;
      return `${hours % 1 === 0 ? hours : hours.toFixed(1)} hr${hours !== 1 ? "s" : ""} free ${periodLabel}`;
    }
    return `$${(tier.creditAmount / 100).toFixed(2)} credit ${periodLabel}`;
  }

  function getPrice(tier: TierInfo) {
    if (billingInterval === "month") return tier.priceMonthly;
    return tier.priceYearly;
  }

  function getPriceLabel(tier: TierInfo) {
    const price = getPrice(tier);
    if (!price) return null;
    return billingInterval === "month"
      ? `$${(price / 100).toFixed(2)}/mo`
      : `$${(price / 100).toFixed(2)}/yr`;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-lg">
          <Crown className="h-7 w-7 text-white" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
          Membership Plans
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {orgName}
        </p>
      </div>

      {/* Success banner */}
      {showSuccess && currentTier && (
        <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/30">
          <Check className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
          <div>
            <p className="font-medium text-green-800 dark:text-green-200">
              Welcome to {currentTier.name}!
            </p>
            <p className="text-sm text-green-700 dark:text-green-300">
              Your membership is now active. Enjoy your member benefits.
            </p>
          </div>
        </div>
      )}

      {/* Cancelled banner */}
      {showCancelled && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-white/5">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Checkout was cancelled. You can try again anytime.
          </p>
        </div>
      )}

      {/* Current membership status */}
      {isAuthenticated && (
        <div className="flex justify-center">
          {isMember && currentTier ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-4 py-1.5 text-sm font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">
              <Crown className="h-4 w-4" />
              {currentTier.name}
              {isCancelledButActive
                ? " (until period end)"
                : isPastDue
                  ? " (payment issue)"
                  : ""}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-4 py-1.5 text-sm font-medium text-gray-600 dark:bg-white/10 dark:text-gray-400">
              Guest
            </span>
          )}
        </div>
      )}

      {/* Credit balance (for active members) */}
      {creditBalance?.has_credits && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 dark:border-blue-800 dark:bg-blue-950/30">
          <div className="flex items-center gap-2 text-sm font-semibold text-blue-800 dark:text-blue-200">
            {creditType === "hours" ? (
              <Clock className="h-4 w-4" />
            ) : (
              <DollarSign className="h-4 w-4" />
            )}
            Your Credits
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-bold text-blue-900 dark:text-blue-100">
              {creditType === "hours"
                ? `${(creditBalance.credits_remaining / 60).toFixed(1)} hrs`
                : `$${(creditBalance.credits_remaining / 100).toFixed(2)}`}
            </span>
            <span className="text-sm text-blue-600 dark:text-blue-300">
              remaining
            </span>
          </div>
          <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
            {creditType === "hours"
              ? `${(creditBalance.credits_used / 60).toFixed(1)} hrs used of ${(creditBalance.credits_total / 60).toFixed(1)} hrs`
              : `$${(creditBalance.credits_used / 100).toFixed(2)} used of $${(creditBalance.credits_total / 100).toFixed(2)}`}
            {creditBalance.period_end && (
              <> &middot; Resets {formatDate(creditBalance.period_end)}</>
            )}
          </p>
        </div>
      )}

      {/* Manage subscription (for Stripe members) */}
      {isMember && membership?.source === "stripe" && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-white/[0.05] dark:bg-white/[0.03]">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-white/90">
            Your Plan
          </h2>
          <div className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-400">
            {isCancelledButActive ? (
              <p>
                Active until{" "}
                <span className="font-medium text-gray-900 dark:text-white">
                  {formatDate(membership.currentPeriodEnd)}
                </span>.
                After that, you&apos;ll return to guest status.
              </p>
            ) : isPastDue ? (
              <p>
                Your last payment failed. Update your payment method to keep your membership.
              </p>
            ) : (
              <p>
                Next billing date:{" "}
                <span className="font-medium text-gray-900 dark:text-white">
                  {formatDate(membership.currentPeriodEnd)}
                </span>
              </p>
            )}
          </div>
          <button
            onClick={handleManageSubscription}
            disabled={loading === "portal"}
            className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {loading === "portal"
              ? "Opening..."
              : isPastDue
                ? "Update Payment Method"
                : "Manage Subscription"}
          </button>
        </div>
      )}

      {/* Admin-granted info */}
      {isAdminGranted && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-white/[0.05] dark:bg-white/[0.03]">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-white/90">
            Your Plan
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Your membership was granted by the facility admin.
            {membership?.expiresAt && (
              <>
                {" "}Active until{" "}
                <span className="font-medium text-gray-900 dark:text-white">
                  {formatDate(membership.expiresAt)}
                </span>.
              </>
            )}
          </p>
        </div>
      )}

      {/* Billing interval toggle */}
      {!isMember && tiers.some((t) => t.priceMonthly && t.priceYearly) && (
        <div className="flex justify-center">
          <div className="inline-flex rounded-lg border border-gray-200 p-1 dark:border-white/10">
            <button
              onClick={() => setBillingInterval("month")}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                billingInterval === "month"
                  ? "bg-blue-600 text-white"
                  : "text-gray-600 hover:text-gray-800 dark:text-gray-400"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingInterval("year")}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                billingInterval === "year"
                  ? "bg-blue-600 text-white"
                  : "text-gray-600 hover:text-gray-800 dark:text-gray-400"
              }`}
            >
              Yearly
            </button>
          </div>
        </div>
      )}

      {/* Tier cards */}
      <div
        className={`grid gap-4 ${
          tiers.length === 1
            ? "max-w-md mx-auto"
            : tiers.length === 2
              ? "sm:grid-cols-2"
              : "sm:grid-cols-2 lg:grid-cols-3"
        }`}
      >
        {tiers.map((tier) => {
          const price = getPrice(tier);
          const priceLabel = getPriceLabel(tier);
          const discount = formatDiscount(tier);
          const credits = formatCredits(tier);
          const isCurrentTier = currentTier?.id === tier.id;
          const window = tier.bookableWindowDays ?? defaultMemberWindow;

          return (
            <div
              key={tier.id}
              className={`relative rounded-2xl border-2 bg-white p-6 dark:bg-white/[0.03] ${
                isCurrentTier
                  ? "border-green-500 dark:border-green-400"
                  : "border-gray-200 dark:border-white/[0.05]"
              }`}
            >
              {isCurrentTier && (
                <span className="absolute -top-3 right-4 rounded-full bg-green-600 px-3 py-0.5 text-xs font-medium text-white">
                  Current Plan
                </span>
              )}

              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {tier.name}
              </h3>

              {price ? (
                <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">
                  {priceLabel}
                </p>
              ) : (
                <p className="mt-2 text-sm text-gray-400">
                  {billingInterval === "month" ? "Monthly" : "Yearly"} plan not available
                </p>
              )}

              {/* Benefits list */}
              <ul className="mt-5 space-y-3">
                <li className="flex items-start gap-2 text-sm">
                  <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                  <span className="text-gray-700 dark:text-gray-300">
                    Book <span className="font-medium">{window} days</span> ahead
                  </span>
                </li>
                {discount && (
                  <li className="flex items-start gap-2 text-sm">
                    <BadgePercent className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                    <span className="text-gray-700 dark:text-gray-300">
                      <span className="font-medium">{discount}</span> on bookings
                    </span>
                  </li>
                )}
                {credits && (
                  <li className="flex items-start gap-2 text-sm">
                    {creditType === "hours" ? (
                      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                    ) : (
                      <DollarSign className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                    )}
                    <span className="text-gray-700 dark:text-gray-300">
                      <span className="font-medium">{credits}</span>
                    </span>
                  </li>
                )}
                <li className="flex items-start gap-2 text-sm">
                  <Gift className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                  <span className="text-gray-700 dark:text-gray-300">
                    Member status
                  </span>
                </li>
              </ul>

              {tier.benefitDescription && (
                <p className="mt-4 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                  {tier.benefitDescription}
                </p>
              )}

              {/* Action button */}
              <div className="mt-6">
                {isCurrentTier ? (
                  <div className="flex h-10 items-center justify-center rounded-lg bg-green-50 text-sm font-medium text-green-700 dark:bg-green-900/20 dark:text-green-300">
                    <Check className="mr-1.5 h-4 w-4" />
                    Your Plan
                  </div>
                ) : isMember && price ? (
                  <button
                    onClick={() => handleChangeTier(tier.id)}
                    disabled={loading !== null}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-blue-600 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:opacity-50 dark:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-950/20"
                  >
                    {loading === tier.id ? (
                      "Processing..."
                    ) : (
                      <>
                        Switch to {tier.name}
                        <ArrowUpRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                ) : !isMember && price ? (
                  <button
                    onClick={() => handleJoin(tier.id)}
                    disabled={loading !== null}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                  >
                    {loading === tier.id ? (
                      "Redirecting..."
                    ) : (
                      <>
                        Join {tier.name}
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Comparison table */}
      <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
          <h2 className="font-semibold text-gray-800 dark:text-white/90">
            Compare Plans
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/[0.05]">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  Feature
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400">
                  Guest
                </th>
                {tiers.map((t) => (
                  <th
                    key={t.id}
                    className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400"
                  >
                    {t.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
              <tr>
                <td className="px-6 py-3 text-gray-700 dark:text-gray-300">
                  Booking Window
                </td>
                <td className="px-4 py-3 text-center text-gray-500">
                  {guestWindow} days
                </td>
                {tiers.map((t) => (
                  <td
                    key={t.id}
                    className="px-4 py-3 text-center font-medium text-green-600 dark:text-green-400"
                  >
                    {t.bookableWindowDays ?? defaultMemberWindow} days
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-6 py-3 text-gray-700 dark:text-gray-300">
                  Booking Discount
                </td>
                <td className="px-4 py-3 text-center text-gray-400">&mdash;</td>
                {tiers.map((t) => (
                  <td
                    key={t.id}
                    className="px-4 py-3 text-center font-medium text-green-600 dark:text-green-400"
                  >
                    {formatDiscount(t) || "\u2014"}
                  </td>
                ))}
              </tr>
              {creditType && (
                <tr>
                  <td className="px-6 py-3 text-gray-700 dark:text-gray-300">
                    {creditType === "hours" ? "Free Play Time" : "Credit Allowance"}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-400">&mdash;</td>
                  {tiers.map((t) => (
                    <td
                      key={t.id}
                      className="px-4 py-3 text-center font-medium text-green-600 dark:text-green-400"
                    >
                      {formatCredits(t) || "\u2014"}
                    </td>
                  ))}
                </tr>
              )}
              <tr>
                <td className="px-6 py-3 text-gray-700 dark:text-gray-300">
                  Member Status
                </td>
                <td className="px-4 py-3 text-center text-gray-400">&mdash;</td>
                {tiers.map((t) => (
                  <td key={t.id} className="px-4 py-3 text-center">
                    <Check className="mx-auto h-4 w-4 text-green-600 dark:text-green-400" />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Login nudge */}
      {!isAuthenticated && (
        <p className="text-center text-sm text-gray-500 dark:text-gray-400">
          Already a member?{" "}
          <a
            href="/auth/login?return_to=/membership"
            className="font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            Sign in
          </a>{" "}
          to view your plan.
        </p>
      )}
    </div>
  );
}
