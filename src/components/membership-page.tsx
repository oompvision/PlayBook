"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Crown, Check, ArrowRight, Calendar, BadgePercent, Gift } from "lucide-react";

type MembershipPageProps = {
  orgName: string;
  tier: {
    name: string;
    benefitDescription: string | null;
    discountType: "flat" | "percent";
    discountValue: number;
    priceMonthly: number | null;
    priceYearly: number | null;
  };
  guestWindow: number;
  memberWindow: number;
  isAuthenticated: boolean;
  membership: {
    status: string;
    source: string;
    currentPeriodEnd: string | null;
    expiresAt: string | null;
    cancelledAt: string | null;
    hasActivePerks: boolean;
  } | null;
  showSuccess?: boolean;
  showCancelled?: boolean;
};

export function MembershipPage({
  orgName,
  tier,
  guestWindow,
  memberWindow,
  isAuthenticated,
  membership,
  showSuccess,
  showCancelled,
}: MembershipPageProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<"month" | "year" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isMember = membership?.hasActivePerks ?? false;
  const isCancelledButActive =
    membership?.status === "cancelled" && membership?.hasActivePerks;
  const isPastDue = membership?.status === "past_due";
  const isAdminGranted = membership?.status === "admin_granted";

  const discountLabel =
    tier.discountType === "percent"
      ? `${tier.discountValue}%`
      : `$${tier.discountValue.toFixed(2)}`;

  async function handleJoin(interval: "month" | "year") {
    if (!isAuthenticated) {
      // Redirect to login with return_to
      router.push(`/auth/login?return_to=/membership`);
      return;
    }

    setLoading(interval);
    setError(null);

    try {
      const res = await fetch("/api/stripe/membership-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to start checkout");
      }

      const { url } = await res.json();
      if (url) {
        window.location.href = url;
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
      if (url) {
        window.location.href = url;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading("portal");
    }
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-lg">
          <Crown className="h-7 w-7 text-white" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
          {tier.name}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {orgName}
        </p>
      </div>

      {/* Success banner */}
      {showSuccess && (
        <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/30">
          <Check className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
          <div>
            <p className="font-medium text-green-800 dark:text-green-200">
              Welcome to {tier.name}!
            </p>
            <p className="text-sm text-green-700 dark:text-green-300">
              Your membership is now active. Enjoy your extended booking window
              and member discounts.
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

      {/* Status badge */}
      {isAuthenticated && (
        <div className="flex justify-center">
          {isMember ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-100 px-4 py-1.5 text-sm font-medium text-teal-800 dark:bg-teal-900/30 dark:text-teal-300">
              <Crown className="h-4 w-4" />
              {isCancelledButActive
                ? "Member (until period end)"
                : isPastDue
                  ? "Member (payment issue)"
                  : "Active Member"}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-4 py-1.5 text-sm font-medium text-gray-600 dark:bg-white/10 dark:text-gray-400">
              Guest
            </span>
          )}
        </div>
      )}

      {/* Member state: show plan info + manage */}
      {isMember && membership?.source === "stripe" && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-white/[0.05] dark:bg-white/[0.03]">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-white/90">
            Your Plan
          </h2>
          <div className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-400">
            {isCancelledButActive ? (
              <p>
                Your membership is active until{" "}
                <span className="font-medium text-gray-900 dark:text-white">
                  {formatDate(membership.currentPeriodEnd)}
                </span>
                . After that, you&apos;ll return to guest status.
              </p>
            ) : isPastDue ? (
              <p>
                Your last payment failed. Please update your payment method to
                keep your membership active.
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
                {" "}
                Active until{" "}
                <span className="font-medium text-gray-900 dark:text-white">
                  {formatDate(membership.expiresAt)}
                </span>
                .
              </>
            )}
          </p>
        </div>
      )}

      {/* Pricing cards (shown to guests and logged-out users) */}
      {!isMember && (
        <div className="grid gap-4 sm:grid-cols-2">
          {tier.priceMonthly && (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-white/[0.05] dark:bg-white/[0.03]">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Monthly
              </p>
              <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">
                ${(tier.priceMonthly / 100).toFixed(2)}
                <span className="text-base font-normal text-gray-500 dark:text-gray-400">
                  /mo
                </span>
              </p>
              <button
                onClick={() => handleJoin("month")}
                disabled={loading !== null}
                className="mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {loading === "month" ? (
                  "Redirecting..."
                ) : (
                  <>
                    Join Monthly
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          )}
          {tier.priceYearly && (
            <div className="relative rounded-2xl border-2 border-blue-500 bg-white p-6 dark:bg-white/[0.03]">
              {tier.priceMonthly && (
                <span className="absolute -top-3 right-4 rounded-full bg-blue-600 px-3 py-0.5 text-xs font-medium text-white">
                  Save{" "}
                  {Math.round(
                    (1 - tier.priceYearly / (tier.priceMonthly * 12)) * 100
                  )}
                  %
                </span>
              )}
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Yearly
              </p>
              <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">
                ${(tier.priceYearly / 100).toFixed(2)}
                <span className="text-base font-normal text-gray-500 dark:text-gray-400">
                  /yr
                </span>
              </p>
              <button
                onClick={() => handleJoin("year")}
                disabled={loading !== null}
                className="mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {loading === "year" ? (
                  "Redirecting..."
                ) : (
                  <>
                    Join Yearly
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Benefits comparison table */}
      <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
          <h2 className="font-semibold text-gray-800 dark:text-white/90">
            Member Benefits
          </h2>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-white/[0.05]">
          {/* Booking Window */}
          <div className="flex items-center gap-4 px-6 py-4">
            <Calendar className="h-5 w-5 shrink-0 text-gray-400" />
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                Advance Booking Window
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                How far ahead you can book
              </p>
            </div>
            <div className="text-right text-sm">
              <div className="text-gray-500 dark:text-gray-400">
                Guest: {guestWindow} days
              </div>
              <div className="font-medium text-teal-600 dark:text-teal-400">
                Member: {memberWindow} days
              </div>
            </div>
          </div>

          {/* Discount */}
          {tier.discountValue > 0 && (
            <div className="flex items-center gap-4 px-6 py-4">
              <BadgePercent className="h-5 w-5 shrink-0 text-gray-400" />
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                  Booking Discount
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Applied automatically at checkout
                </p>
              </div>
              <div className="text-right text-sm">
                <div className="text-gray-500 dark:text-gray-400">
                  Guest: Full price
                </div>
                <div className="font-medium text-teal-600 dark:text-teal-400">
                  Member: {discountLabel} off
                </div>
              </div>
            </div>
          )}

          {/* Priority access */}
          <div className="flex items-center gap-4 px-6 py-4">
            <Gift className="h-5 w-5 shrink-0 text-gray-400" />
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                Member Status
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Recognized as a valued member
              </p>
            </div>
            <div className="text-right text-sm">
              <div className="text-gray-500 dark:text-gray-400">Guest: —</div>
              <div className="font-medium text-teal-600 dark:text-teal-400">
                Member: <Check className="inline h-4 w-4" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Benefit description (free-form text from admin) */}
      {tier.benefitDescription && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-white/[0.05] dark:bg-white/[0.03]">
          <h2 className="mb-3 text-sm font-semibold text-gray-800 dark:text-white/90">
            About This Membership
          </h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            {tier.benefitDescription}
          </p>
        </div>
      )}

      {/* Login nudge for non-authenticated users */}
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
