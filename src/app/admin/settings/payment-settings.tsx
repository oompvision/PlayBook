"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  CreditCard,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";

type PaymentSettingsData = {
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean;
  payment_mode: string;
  cancellation_window_hours: number;
  no_show_fee_cents: number | null;
  no_show_fee_type: string;
  processing_fee_absorbed_by: string;
};

type ConnectStatus = {
  status: "not_started" | "incomplete" | "complete";
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
};

const PAYMENT_MODES = [
  {
    value: "none",
    label: "No Payment Collection",
    description: "Customers book without providing payment info",
  },
  {
    value: "hold",
    label: "Hold Card on File",
    description:
      "Save customer's card during booking. Charge later for no-shows or cancellations.",
  },
  {
    value: "charge_upfront",
    label: "Charge Upfront",
    description:
      "Charge the full booking amount at the time of booking.",
  },
  {
    value: "hold_charge_manual",
    label: "Hold & Manual Charge",
    description:
      "Save customer's card and manually decide when to charge.",
  },
];

export function PaymentSettings({
  initialSettings,
}: {
  initialSettings: PaymentSettingsData;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(
    null
  );
  const [connecting, setConnecting] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const checkConnectStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/stripe/connect");
      if (res.ok) {
        const data = await res.json();
        setConnectStatus(data);
        // Sync local state if onboarding just completed
        if (data.status === "complete" && !settings.stripe_onboarding_complete) {
          setSettings((s) => ({ ...s, stripe_onboarding_complete: true }));
        }
      }
    } catch {
      // Silently fail — status will show from initial settings
    }
  }, [settings.stripe_onboarding_complete]);

  // Handle return from Stripe onboarding
  useEffect(() => {
    const stripeParam = searchParams.get("stripe");

    if (stripeParam === "complete") {
      checkConnectStatus().then(() => {
        setStatusMessage({
          type: "success",
          text: "Stripe account connected successfully!",
        });
      });
      // Clean up the URL
      router.replace("/admin/settings/payments", { scroll: false });
    } else if (stripeParam === "refresh") {
      // Onboarding link expired, auto-generate a new one
      handleConnect();
      router.replace("/admin/settings/payments", { scroll: false });
    } else if (settings.stripe_account_id) {
      // Already has an account — check current status
      checkConnectStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnect() {
    setConnecting(true);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/stripe/connect", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        setStatusMessage({
          type: "error",
          text: data.error || "Failed to start Stripe onboarding",
        });
        setConnecting(false);
      }
    } catch {
      setStatusMessage({
        type: "error",
        text: "Network error. Please try again.",
      });
      setConnecting(false);
    }
  }

  async function handlePaymentModeChange(mode: string) {
    setSavingMode(true);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/org/payment-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_mode: mode }),
      });
      const data = await res.json();
      if (res.ok) {
        setSettings((s) => ({ ...s, payment_mode: data.payment_mode }));
        setStatusMessage({
          type: "success",
          text: "Payment mode updated.",
        });
      } else {
        setStatusMessage({
          type: "error",
          text: data.error || "Failed to update payment mode",
        });
      }
    } catch {
      setStatusMessage({
        type: "error",
        text: "Network error. Please try again.",
      });
    } finally {
      setSavingMode(false);
    }
  }

  const isConnected =
    settings.stripe_onboarding_complete ||
    connectStatus?.status === "complete";
  const isIncomplete =
    settings.stripe_account_id &&
    !isConnected &&
    connectStatus?.status !== "not_started";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
      <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          <h2 className="font-semibold text-gray-800 dark:text-white/90">
            Payment Processing
          </h2>
          {isConnected && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950/30 dark:text-green-400">
              <CheckCircle2 className="h-3 w-3" />
              Connected
            </span>
          )}
          {isIncomplete && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
              <AlertCircle className="h-3 w-3" />
              Incomplete
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
          Connect your Stripe account to collect payments from customers.
        </p>
      </div>

      <div className="p-6 space-y-6">
        {/* Status Message */}
        {statusMessage && (
          <div
            className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
              statusMessage.type === "success"
                ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400"
                : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400"
            }`}
          >
            {statusMessage.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            {statusMessage.text}
          </div>
        )}

        {/* Stripe Connect Section */}
        {!isConnected && !isIncomplete && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-white/[0.05] dark:bg-white/[0.02]">
            <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">
              Connect your Stripe account
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Link your Stripe account to start accepting credit card payments
              for bookings. You&apos;ll be redirected to Stripe to complete
              setup.
            </p>
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-[#635bff] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#5851db] disabled:opacity-50"
            >
              {connecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Redirecting...
                </>
              ) : (
                <>
                  <ExternalLink className="h-4 w-4" />
                  Connect Stripe Account
                </>
              )}
            </button>
          </div>
        )}

        {isIncomplete && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
            <h3 className="text-sm font-medium text-amber-800 dark:text-amber-300">
              Stripe onboarding incomplete
            </h3>
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
              Your Stripe account setup isn&apos;t finished yet. Please complete
              the remaining steps to start accepting payments.
            </p>
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-[#635bff] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#5851db] disabled:opacity-50"
            >
              {connecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Redirecting...
                </>
              ) : (
                <>
                  <ExternalLink className="h-4 w-4" />
                  Continue Setup
                </>
              )}
            </button>
          </div>
        )}

        {isConnected && (
          <>
            {/* Account Info */}
            <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-white/[0.05] dark:bg-white/[0.02]">
              <div className="flex-1 text-sm">
                <span className="text-gray-500 dark:text-gray-400">
                  Stripe Account:{" "}
                </span>
                <span className="font-mono text-gray-700 dark:text-white/70">
                  {settings.stripe_account_id
                    ? `${settings.stripe_account_id.slice(0, 8)}...${settings.stripe_account_id.slice(-4)}`
                    : "—"}
                </span>
              </div>
              {connectStatus && (
                <div className="flex gap-3 text-xs">
                  <span
                    className={
                      connectStatus.charges_enabled
                        ? "text-green-600 dark:text-green-400"
                        : "text-gray-400"
                    }
                  >
                    Charges{" "}
                    {connectStatus.charges_enabled ? "enabled" : "disabled"}
                  </span>
                  <span
                    className={
                      connectStatus.payouts_enabled
                        ? "text-green-600 dark:text-green-400"
                        : "text-gray-400"
                    }
                  >
                    Payouts{" "}
                    {connectStatus.payouts_enabled ? "enabled" : "disabled"}
                  </span>
                </div>
              )}
            </div>

            {/* Payment Mode Selector */}
            <div>
              <h3 className="mb-3 text-sm font-medium text-gray-800 dark:text-white/90">
                Payment Collection Mode
              </h3>
              <div className="space-y-2">
                {PAYMENT_MODES.map((mode) => (
                  <label
                    key={mode.value}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                      settings.payment_mode === mode.value
                        ? "border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/20"
                        : "border-gray-200 hover:bg-gray-50 dark:border-white/[0.05] dark:hover:bg-white/[0.02]"
                    } ${savingMode ? "pointer-events-none opacity-60" : ""}`}
                  >
                    <input
                      type="radio"
                      name="payment_mode"
                      value={mode.value}
                      checked={settings.payment_mode === mode.value}
                      onChange={() => handlePaymentModeChange(mode.value)}
                      disabled={savingMode}
                      className="mt-0.5 h-4 w-4 accent-blue-600"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                        {mode.label}
                      </span>
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {mode.description}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
