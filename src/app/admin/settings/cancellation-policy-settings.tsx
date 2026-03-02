"use client";

import { useState } from "react";
import {
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RotateCcw,
} from "lucide-react";

type CancellationPolicyData = {
  payment_mode: string;
  cancellation_window_hours: number;
  cancellation_policy_text: string | null;
};

function generateDefaultPolicyText(windowHours: number, paymentMode: string): string {
  if (paymentMode === "none") {
    return `Cancellations made more than ${windowHours} hours before the scheduled booking time are free of charge. Cancellations made within ${windowHours} hours of the booking start time may not be accommodated.`;
  }

  if (paymentMode === "charge_upfront") {
    return `Cancellations made more than ${windowHours} hours before the scheduled booking time will receive a full refund. No refunds will be issued for cancellations made within ${windowHours} hours of the booking start time. Full payment is collected at the time of booking.`;
  }

  // hold / hold_charge_manual
  return `Your card is saved on file to secure your booking. Cancellations made more than ${windowHours} hours before the scheduled booking time will not be charged. Cancellations made within ${windowHours} hours of the booking start time may result in a charge of the full booking amount.`;
}

export function CancellationPolicySettings({
  initialSettings,
}: {
  initialSettings: CancellationPolicyData;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [windowHours, setWindowHours] = useState(
    initialSettings.cancellation_window_hours
  );
  const [policyText, setPolicyText] = useState(
    initialSettings.cancellation_policy_text ||
      generateDefaultPolicyText(
        initialSettings.cancellation_window_hours,
        initialSettings.payment_mode
      )
  );
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const hasChanges =
    windowHours !== settings.cancellation_window_hours ||
    policyText !== (settings.cancellation_policy_text || generateDefaultPolicyText(settings.cancellation_window_hours, settings.payment_mode));

  function handleResetToDefault() {
    setPolicyText(generateDefaultPolicyText(windowHours, settings.payment_mode));
  }

  async function handleSave() {
    setSaving(true);
    setStatusMessage(null);
    try {
      const defaultText = generateDefaultPolicyText(windowHours, settings.payment_mode);
      // If the text matches the auto-generated default, store null so it stays dynamic
      const textToSave = policyText.trim() === defaultText ? null : policyText.trim();

      const res = await fetch("/api/org/payment-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cancellation_window_hours: windowHours,
          cancellation_policy_text: textToSave,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSettings((s) => ({
          ...s,
          cancellation_window_hours: data.cancellation_window_hours,
          cancellation_policy_text: data.cancellation_policy_text,
        }));
        setStatusMessage({ type: "success", text: "Cancellation policy saved." });
      } else {
        setStatusMessage({
          type: "error",
          text: data.error || "Failed to save cancellation policy",
        });
      }
    } catch {
      setStatusMessage({
        type: "error",
        text: "Network error. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
      <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          <h2 className="font-semibold text-gray-800 dark:text-white/90">
            Cancellation Policy
          </h2>
        </div>
        <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
          Configure your cancellation window and refund policy. This policy is shown to
          customers during checkout and when they cancel a booking.
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

        {/* Cancellation Window */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-800 dark:text-white/90">
            Cancellation Window
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min="0"
              max="168"
              value={windowHours}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 0;
                setWindowHours(val);
              }}
              className="h-10 w-24 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              hours before booking start
            </span>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Customers who cancel before this window receive a full refund. Cancellations
            within this window are non-refundable.
          </p>
        </div>

        {/* Policy Summary */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/20">
          <h4 className="text-xs font-medium text-blue-800 dark:text-blue-300 uppercase tracking-wider mb-2">
            How it works
          </h4>
          <ul className="space-y-1.5 text-sm text-blue-700 dark:text-blue-400">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-green-600 dark:text-green-400" />
              <span>
                Cancel <strong>more than {windowHours}h</strong> before booking &rarr;{" "}
                <strong>full refund</strong>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span>
                Cancel <strong>within {windowHours}h</strong> of booking &rarr;{" "}
                <strong>no refund</strong>
              </span>
            </li>
          </ul>
        </div>

        {/* Custom Policy Text */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-800 dark:text-white/90">
              Refund Policy Text
            </label>
            <button
              type="button"
              onClick={handleResetToDefault}
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Reset to default
            </button>
          </div>
          <textarea
            value={policyText}
            onChange={(e) => setPolicyText(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 resize-y"
            placeholder="Enter your cancellation and refund policy..."
          />
          <p className="text-xs text-gray-400 dark:text-gray-500">
            This text is shown to customers during checkout (they must agree before booking)
            and in the cancellation confirmation dialog.
          </p>
        </div>

        {/* Customer Preview */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Customer Preview
          </label>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-white/[0.05] dark:bg-white/[0.02]">
            <div className="flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                {policyText || "No policy text configured."}
              </p>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center gap-3 border-t border-gray-200 pt-4 dark:border-white/[0.05]">
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Policy"
            )}
          </button>
          {!hasChanges && !statusMessage && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              No unsaved changes
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
