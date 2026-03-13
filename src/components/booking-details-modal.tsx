"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatPrice, getVisualBookingStatus } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  Calendar,
  Clock,
  MapPin,
  User,
  Mail,
  Phone,
  StickyNote,
  X,
  Pencil,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  RotateCcw,
  Loader2,
  ShieldCheck,
  ChevronDown,
  Settings2,
} from "lucide-react";

type ModifiedFromInfo = {
  startTime: string;
  endTime: string;
  date: string;
  bayName: string;
};

export type BookingDetailData = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  total_price_cents: number;
  discount_cents?: number;
  discount_description?: string | null;
  status: string;
  confirmation_code: string;
  notes: string | null;
  created_at: string;
  bayName: string;
  locationName?: string | null;
  canCancel?: boolean;
  canModify?: boolean;
  modifiedFrom?: ModifiedFromInfo | null;
  // Admin-only fields
  customerName?: string;
  customerEmail?: string | null;
  isGuest?: boolean;
  guestPhone?: string | null;
};

type PaymentInfo = {
  id: string;
  status: string;
  amount_cents: number | null;
  refunded_amount_cents: number | null;
  charge_type: string | null;
  stripe_payment_intent_id: string | null;
  cancellation_policy_text: string | null;
} | null;

type SlotDetail = {
  start_time: string;
  end_time: string;
  price_cents: number;
};

type Props = {
  booking: BookingDetailData | null;
  variant: "admin" | "customer";
  timezone: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cancelAction?: (formData: FormData) => Promise<void>;
  notice?: string | null;
  cancellationWindowHours?: number;
  paymentMode?: string;
};

function formatTime(timestamp: string, timezone: string): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
}

function isInsideCancellationWindow(
  bookingStartTime: string,
  windowHours: number
): boolean {
  const bookingStart = new Date(bookingStartTime).getTime();
  const cutoff = bookingStart - windowHours * 60 * 60 * 1000;
  return Date.now() >= cutoff;
}

export function BookingDetailsModal({
  booking,
  variant,
  timezone,
  open,
  onOpenChange,
  cancelAction,
  notice,
  cancellationWindowHours = 24,
  paymentMode = "none",
}: Props) {
  const [slots, setSlots] = useState<SlotDetail[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo>(null);
  const [loadingPayment, setLoadingPayment] = useState(false);

  // Policy modal state
  const [showPolicyModal, setShowPolicyModal] = useState(false);

  // Collapsible manage section
  const [manageOpen, setManageOpen] = useState(false);

  // Cancel flow state
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [adminRefundType, setAdminRefundType] = useState<
    "full" | "partial" | "none"
  >("full");
  const [partialMode, setPartialMode] = useState<"dollars" | "percent">(
    "dollars"
  );
  const [partialAmount, setPartialAmount] = useState("");
  const [refundNote, setRefundNote] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelSuccess, setCancelSuccess] = useState(false);

  // Process refund state (for already-cancelled bookings)
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [refundFormType, setRefundFormType] = useState<"full" | "partial">(
    "full"
  );
  const [refundFormPartialMode, setRefundFormPartialMode] = useState<
    "dollars" | "percent"
  >("dollars");
  const [refundFormAmount, setRefundFormAmount] = useState("");
  const [refundFormNote, setRefundFormNote] = useState("");
  const [processingRefund, setProcessingRefund] = useState(false);
  const [refundResult, setRefundResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!open || !booking) {
      setSlots([]);
      setPaymentInfo(null);
      setShowPolicyModal(false);
      setShowCancelConfirm(false);
      setShowRefundForm(false);
      setRefundResult(null);
      setAdminRefundType("full");
      setPartialAmount("");
      setRefundNote("");
      setManageOpen(false);
      setCancelSuccess(false);
      return;
    }

    async function fetchSlots() {
      setLoadingSlots(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("booking_slots")
        .select("bay_schedule_slots(start_time, end_time, price_cents)")
        .eq("booking_id", booking!.id);

      if (data) {
        const mapped = data
          .map(
            (row: Record<string, unknown>) =>
              row.bay_schedule_slots as SlotDetail | null
          )
          .filter((s): s is SlotDetail => s !== null)
          .sort(
            (a, b) =>
              new Date(a.start_time).getTime() -
              new Date(b.start_time).getTime()
          );
        setSlots(mapped);
      }
      setLoadingSlots(false);
    }

    async function fetchPayment() {
      setLoadingPayment(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("booking_payments")
        .select(
          "id, status, amount_cents, refunded_amount_cents, charge_type, stripe_payment_intent_id, cancellation_policy_text"
        )
        .eq("booking_id", booking!.id)
        .maybeSingle();

      setPaymentInfo(data || null);
      setLoadingPayment(false);
    }

    fetchSlots();
    fetchPayment();
  }, [open, booking]);

  if (!booking) return null;

  const dateStr = new Date(booking.date + "T12:00:00").toLocaleDateString(
    "en-US",
    {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }
  );
  const timeStr = `${formatTime(booking.start_time, timezone)} – ${formatTime(booking.end_time, timezone)}`;
  const createdStr = new Date(booking.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const insideWindow = isInsideCancellationWindow(
    booking.start_time,
    cancellationWindowHours
  );

  const hasChargedPayment =
    paymentInfo &&
    (paymentInfo.status === "charged" ||
      paymentInfo.status === "partially_refunded") &&
    paymentInfo.stripe_payment_intent_id;

  // For customer: modify is blocked inside the cancellation window
  const effectiveCanModify =
    variant === "customer"
      ? booking.canModify && !insideWindow
      : booking.canModify;

  // Admin can process refund on cancelled bookings that were charged
  const canProcessRefund =
    variant === "admin" &&
    booking.status === "cancelled" &&
    hasChargedPayment;

  // Calculate refundable amount for display
  const chargedAmount = paymentInfo?.amount_cents || 0;
  const alreadyRefunded = paymentInfo?.refunded_amount_cents || 0;
  const refundable = chargedAmount - alreadyRefunded;

  async function handleAdminCancelWithRefund() {
    if (!booking || !cancelAction) return;
    setCancelling(true);

    try {
      // If there's a payment and admin chose to refund, process refund first
      if (hasChargedPayment && adminRefundType !== "none") {
        let refundAmountCents: number | undefined;
        let refundAmountPercent: number | undefined;

        if (adminRefundType === "full") {
          // Full refund — API handles it
        } else {
          // Partial refund
          const val = parseFloat(partialAmount);
          if (isNaN(val) || val <= 0) {
            setCancelling(false);
            return;
          }
          if (partialMode === "dollars") {
            refundAmountCents = Math.round(val * 100);
          } else {
            refundAmountPercent = val;
          }
        }

        const res = await fetch("/api/stripe/refund", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            booking_id: booking.id,
            refund_type: adminRefundType,
            amount_cents: refundAmountCents,
            amount_percent: refundAmountPercent,
            note: refundNote || undefined,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          setRefundResult({
            type: "error",
            message: data.error || "Failed to process refund",
          });
          setCancelling(false);
          return;
        }
      }

      // Now cancel the booking
      const formData = new FormData();
      formData.set("booking_id", booking.id);
      await cancelAction(formData);
      setCancelSuccess(true);
      setTimeout(() => {
        onOpenChange(false);
      }, 1500);
    } catch {
      setCancelling(false);
    }
  }

  async function handleCustomerCancel() {
    if (!booking || !cancelAction) return;
    setCancelling(true);

    try {
      // Cancel the booking first
      const formData = new FormData();
      formData.set("booking_id", booking.id);

      // Fire-and-forget auto-refund after cancel (if payment exists)
      if (
        paymentInfo &&
        (paymentInfo.status === "charged" ||
          paymentInfo.status === "card_saved") &&
        !insideWindow
      ) {
        // We'll trigger auto-refund after the cancel action completes
        // The cancel action redirects, so we do it async before
        fetch("/api/stripe/auto-refund", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ booking_id: booking.id }),
        }).catch(() => {});
      }

      await cancelAction(formData);
      setCancelSuccess(true);
      setTimeout(() => {
        onOpenChange(false);
      }, 1500);
    } catch {
      setCancelling(false);
    }
  }

  async function handleProcessRefund() {
    if (!booking) return;
    setProcessingRefund(true);
    setRefundResult(null);

    try {
      let refundAmountCents: number | undefined;
      let refundAmountPercent: number | undefined;

      if (refundFormType === "partial") {
        const val = parseFloat(refundFormAmount);
        if (isNaN(val) || val <= 0) {
          setRefundResult({
            type: "error",
            message: "Please enter a valid amount",
          });
          setProcessingRefund(false);
          return;
        }
        if (refundFormPartialMode === "dollars") {
          refundAmountCents = Math.round(val * 100);
        } else {
          refundAmountPercent = val;
        }
      }

      const res = await fetch("/api/stripe/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking_id: booking.id,
          refund_type: refundFormType,
          amount_cents: refundAmountCents,
          amount_percent: refundAmountPercent,
          note: refundFormNote || undefined,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setRefundResult({
          type: "success",
          message: `Refund of $${((data.refunded_amount_cents || 0) / 100).toFixed(2)} processed successfully.`,
        });
        // Refresh payment info
        const supabase = createClient();
        const { data: updated } = await supabase
          .from("booking_payments")
          .select(
            "id, status, amount_cents, refunded_amount_cents, charge_type, stripe_payment_intent_id, cancellation_policy_text"
          )
          .eq("booking_id", booking.id)
          .maybeSingle();
        setPaymentInfo(updated || null);
        setShowRefundForm(false);
      } else {
        setRefundResult({
          type: "error",
          message: data.error || "Failed to process refund",
        });
      }
    } catch {
      setRefundResult({
        type: "error",
        message: "Network error. Please try again.",
      });
    } finally {
      setProcessingRefund(false);
    }
  }

  // Render the cancel confirmation panel
  function renderCancelConfirmation() {
    if (variant === "admin" && hasChargedPayment) {
      return renderAdminCancelWithRefund();
    }
    if (variant === "customer") {
      return renderCustomerCancelConfirm();
    }
    // Admin with no payment — simple confirmation
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Are you sure you want to cancel this booking? This action cannot be
            undone.
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowCancelConfirm(false)}
            className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Go Back
          </button>
          <button
            type="button"
            disabled={cancelling}
            onClick={async () => {
              if (!cancelAction || !booking) return;
              setCancelling(true);
              const fd = new FormData();
              fd.set("booking_id", booking.id);
              await cancelAction(fd);
            }}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {cancelling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
            Confirm Cancel
          </button>
        </div>
      </div>
    );
  }

  function renderAdminCancelWithRefund() {
    return (
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-gray-800 dark:text-white/90">
          Cancel Booking & Refund
        </h4>

        {refundResult && (
          <div
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
              refundResult.type === "success"
                ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400"
                : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400"
            }`}
          >
            {refundResult.type === "success" ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            )}
            {refundResult.message}
          </div>
        )}

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-700 dark:bg-gray-800">
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">
              Amount charged
            </span>
            <span className="font-medium text-gray-800 dark:text-white/90">
              ${(chargedAmount / 100).toFixed(2)}
            </span>
          </div>
          {alreadyRefunded > 0 && (
            <div className="mt-1 flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">
                Already refunded
              </span>
              <span className="font-medium text-green-700 dark:text-green-400">
                -${(alreadyRefunded / 100).toFixed(2)}
              </span>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t border-gray-200 pt-1 dark:border-gray-600">
            <span className="text-gray-500 dark:text-gray-400">
              Refundable
            </span>
            <span className="font-semibold text-gray-800 dark:text-white/90">
              ${(refundable / 100).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Refund type selection */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Refund Option
          </label>
          <div className="space-y-1.5">
            {(
              [
                {
                  value: "full" as const,
                  label: "Full Refund",
                  desc: `Refund $${(refundable / 100).toFixed(2)}`,
                },
                {
                  value: "partial" as const,
                  label: "Partial Refund",
                  desc: "Specify a custom amount",
                },
                {
                  value: "none" as const,
                  label: "No Refund",
                  desc: "Cancel without issuing a refund",
                },
              ] as const
            ).map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                  adminRefundType === opt.value
                    ? "border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30"
                    : "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                }`}
              >
                <input
                  type="radio"
                  name="refund_type"
                  value={opt.value}
                  checked={adminRefundType === opt.value}
                  onChange={() => setAdminRefundType(opt.value)}
                  className="h-4 w-4 text-blue-600"
                />
                <div>
                  <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                    {opt.label}
                  </span>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {opt.desc}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Partial refund amount input */}
        {adminRefundType === "partial" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-md border border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setPartialMode("dollars")}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    partialMode === "dollars"
                      ? "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-white"
                      : "text-gray-500 hover:text-gray-700 dark:text-gray-400"
                  }`}
                >
                  $
                </button>
                <button
                  type="button"
                  onClick={() => setPartialMode("percent")}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    partialMode === "percent"
                      ? "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-white"
                      : "text-gray-500 hover:text-gray-700 dark:text-gray-400"
                  }`}
                >
                  %
                </button>
              </div>
              <input
                type="number"
                min="0"
                step={partialMode === "dollars" ? "0.01" : "1"}
                max={
                  partialMode === "dollars"
                    ? (refundable / 100).toFixed(2)
                    : "100"
                }
                value={partialAmount}
                onChange={(e) => setPartialAmount(e.target.value)}
                placeholder={
                  partialMode === "dollars" ? "0.00" : "50"
                }
                className="h-9 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              />
              {partialMode === "percent" && partialAmount && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  = $
                  {(
                    (chargedAmount * (parseFloat(partialAmount) || 0)) /
                    100 /
                    100
                  ).toFixed(2)}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Note */}
        {adminRefundType !== "none" && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Refund Note (optional)
            </label>
            <input
              type="text"
              value={refundNote}
              onChange={(e) => setRefundNote(e.target.value)}
              placeholder="Reason for refund..."
              className="h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            />
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setShowCancelConfirm(false);
              setRefundResult(null);
            }}
            className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Go Back
          </button>
          <button
            type="button"
            disabled={
              cancelling ||
              (adminRefundType === "partial" &&
                (!partialAmount || parseFloat(partialAmount) <= 0))
            }
            onClick={handleAdminCancelWithRefund}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {cancelling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
            {adminRefundType === "none"
              ? "Cancel (No Refund)"
              : adminRefundType === "full"
                ? "Cancel & Refund"
                : "Cancel & Partial Refund"}
          </button>
        </div>
      </div>
    );
  }

  function renderCustomerCancelConfirm() {
    const hasPaidBooking =
      paymentInfo &&
      (paymentInfo.status === "charged" ||
        paymentInfo.status === "card_saved");

    const policyText = paymentInfo?.cancellation_policy_text;

    return (
      <div className="space-y-3">
        {hasPaidBooking && insideWindow && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">No refund will be issued</p>
              <p className="mt-0.5 text-xs">
                This booking is within the {cancellationWindowHours}-hour
                cancellation window. If you believe you should receive a refund,
                please contact the facility after cancelling.
              </p>
              {policyText && (
                <button
                  type="button"
                  onClick={() => setShowPolicyModal(true)}
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-200"
                >
                  <ShieldCheck className="h-3 w-3" />
                  View Cancellation Policy
                </button>
              )}
            </div>
          </div>
        )}

        {hasPaidBooking && !insideWindow && (
          <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Full refund will be issued</p>
              <p className="mt-0.5 text-xs">
                You&apos;re cancelling more than {cancellationWindowHours} hours
                before the booking start time. A full refund of $
                {((paymentInfo?.amount_cents || 0) / 100).toFixed(2)} will be
                processed automatically.
              </p>
              {policyText && (
                <button
                  type="button"
                  onClick={() => setShowPolicyModal(true)}
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-green-800 underline underline-offset-2 hover:text-green-900 dark:text-green-300 dark:hover:text-green-200"
                >
                  <ShieldCheck className="h-3 w-3" />
                  View Cancellation Policy
                </button>
              )}
            </div>
          </div>
        )}

        {!hasPaidBooking && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Are you sure you want to cancel this booking? This action cannot
              be undone.
            </span>
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowCancelConfirm(false)}
            className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Go Back
          </button>
          <button
            type="button"
            disabled={cancelling}
            onClick={handleCustomerCancel}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {cancelling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
            Cancel Booking
          </button>
        </div>
      </div>
    );
  }

  // Render process refund form (for already-cancelled bookings)
  function renderProcessRefundForm() {
    return (
      <div className="space-y-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-white/90">
          <RotateCcw className="h-4 w-4" />
          Process Refund
        </h4>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-700 dark:bg-gray-800">
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">
              Amount charged
            </span>
            <span className="font-medium text-gray-800 dark:text-white/90">
              ${(chargedAmount / 100).toFixed(2)}
            </span>
          </div>
          {alreadyRefunded > 0 && (
            <div className="mt-1 flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">
                Already refunded
              </span>
              <span className="font-medium text-green-700 dark:text-green-400">
                -${(alreadyRefunded / 100).toFixed(2)}
              </span>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t border-gray-200 pt-1 dark:border-gray-600">
            <span className="text-gray-500 dark:text-gray-400">
              Refundable
            </span>
            <span className="font-semibold text-gray-800 dark:text-white/90">
              ${(refundable / 100).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Refund type */}
        <div className="space-y-1.5">
          {(
            [
              {
                value: "full" as const,
                label: "Full Refund",
                desc: `Refund $${(refundable / 100).toFixed(2)}`,
              },
              {
                value: "partial" as const,
                label: "Partial Refund",
                desc: "Specify a custom amount",
              },
            ] as const
          ).map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                refundFormType === opt.value
                  ? "border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30"
                  : "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              }`}
            >
              <input
                type="radio"
                name="refund_form_type"
                value={opt.value}
                checked={refundFormType === opt.value}
                onChange={() => setRefundFormType(opt.value)}
                className="h-4 w-4 text-blue-600"
              />
              <div>
                <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                  {opt.label}
                </span>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {opt.desc}
                </p>
              </div>
            </label>
          ))}
        </div>

        {/* Partial amount */}
        {refundFormType === "partial" && (
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setRefundFormPartialMode("dollars")}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  refundFormPartialMode === "dollars"
                    ? "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-white"
                    : "text-gray-500 hover:text-gray-700 dark:text-gray-400"
                }`}
              >
                $
              </button>
              <button
                type="button"
                onClick={() => setRefundFormPartialMode("percent")}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  refundFormPartialMode === "percent"
                    ? "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-white"
                    : "text-gray-500 hover:text-gray-700 dark:text-gray-400"
                }`}
              >
                %
              </button>
            </div>
            <input
              type="number"
              min="0"
              step={refundFormPartialMode === "dollars" ? "0.01" : "1"}
              max={
                refundFormPartialMode === "dollars"
                  ? (refundable / 100).toFixed(2)
                  : "100"
              }
              value={refundFormAmount}
              onChange={(e) => setRefundFormAmount(e.target.value)}
              placeholder={refundFormPartialMode === "dollars" ? "0.00" : "50"}
              className="h-9 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            />
            {refundFormPartialMode === "percent" && refundFormAmount && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                = $
                {(
                  (chargedAmount * (parseFloat(refundFormAmount) || 0)) /
                  100 /
                  100
                ).toFixed(2)}
              </span>
            )}
          </div>
        )}

        {/* Note */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Refund Note (optional)
          </label>
          <input
            type="text"
            value={refundFormNote}
            onChange={(e) => setRefundFormNote(e.target.value)}
            placeholder="Reason for refund..."
            className="h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
          />
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowRefundForm(false)}
            className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              processingRefund ||
              (refundFormType === "partial" &&
                (!refundFormAmount || parseFloat(refundFormAmount) <= 0))
            }
            onClick={handleProcessRefund}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {processingRefund ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <DollarSign className="h-4 w-4" />
            )}
            Process Refund
          </button>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-between pr-6">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              {dateStr}
            </DialogTitle>
          </div>
          <DialogDescription className="sr-only">Booking details</DialogDescription>
        </DialogHeader>

        <div className="-mx-6 flex-1 space-y-4 overflow-y-auto px-6">
          {/* Key booking details */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{timeStr}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span>
                {booking.bayName}
                {booking.locationName && (
                  <span className="text-muted-foreground"> – {booking.locationName}</span>
                )}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Booked on {createdStr}
            </p>
            <div className="flex items-center gap-2">
              <p className="font-mono text-xs text-muted-foreground">
                {booking.confirmation_code}
              </p>
              {(() => {
                const vs = getVisualBookingStatus(booking.status, booking.start_time, booking.end_time);
                switch (vs) {
                  case "active":
                    return (
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        <span className="relative mr-1 flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                        </span>
                        Active
                      </span>
                    );
                  case "confirmed":
                    return (
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        Confirmed
                      </span>
                    );
                  case "completed":
                    return (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                        Completed
                      </span>
                    );
                  case "cancelled":
                    return (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        Cancelled
                      </span>
                    );
                }
              })()}
              {/* Payment/refund badges */}
              {(() => {
                // For cancelled bookings: show refund % pill if refunded, nothing else
                if (booking.status === "cancelled" && paymentInfo && !loadingPayment) {
                  if ((paymentInfo.status === "refunded" || paymentInfo.status === "partially_refunded") && paymentInfo.refunded_amount_cents && paymentInfo.amount_cents) {
                    const pct = Math.round((paymentInfo.refunded_amount_cents / paymentInfo.amount_cents) * 100);
                    return (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        {pct}% Refunded
                      </span>
                    );
                  }
                  return null;
                }
                // Show "Paid" on all confirmed bookings when org uses charge_upfront
                if (paymentMode === "charge_upfront" && booking.status === "confirmed") {
                  return (
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      Paid
                    </span>
                  );
                }
                // Fallback: show payment status from actual payment record
                if (paymentInfo && !loadingPayment) {
                  if (paymentInfo.status === "charged") {
                    return (
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        Paid
                      </span>
                    );
                  }
                  if (paymentInfo.status === "card_saved") {
                    return (
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        Card Saved
                      </span>
                    );
                  }
                }
                return null;
              })()}
            </div>
          </div>

          {notice && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
              {notice}
            </div>
          )}

          {cancelSuccess && (
            <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Booking cancelled.</span>
            </div>
          )}

          {refundResult && !showCancelConfirm && !showRefundForm && (
            <div
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                refundResult.type === "success"
                  ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400"
                  : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400"
              }`}
            >
              {refundResult.type === "success" ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              )}
              {refundResult.message}
            </div>
          )}

          {/* Customer Info (admin only) */}
          {variant === "admin" && booking.customerName && (
            <div className="space-y-2 rounded-lg bg-muted/50 p-3">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {booking.customerName}
                </span>
                {booking.isGuest && (
                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    Guest
                  </span>
                )}
              </div>
              {booking.customerEmail && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-4 w-4" />
                  <span>{booking.customerEmail}</span>
                </div>
              )}
              {booking.isGuest && booking.guestPhone && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone className="h-4 w-4" />
                  <span>{booking.guestPhone}</span>
                </div>
              )}
            </div>
          )}

          {/* Slot Breakdown */}
          <div>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Pricing
            </h4>
            {loadingSlots ? (
              <div className="py-3 text-center text-sm text-muted-foreground">
                Loading slots...
              </div>
            ) : slots.length > 0 ? (
              <div className="rounded-lg border">
                <div className="divide-y">
                  {slots.map((slot, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between px-3 py-2 text-sm"
                    >
                      <span className="text-muted-foreground">
                        {formatTime(slot.start_time, timezone)} –{" "}
                        {formatTime(slot.end_time, timezone)}
                      </span>
                      <span>{formatPrice(slot.price_cents)}</span>
                    </div>
                  ))}
                </div>
                {(booking.discount_cents ?? 0) > 0 && (
                  <div className="flex items-center justify-between border-t px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="text-muted-foreground">
                      {formatPrice(booking.total_price_cents)}
                    </span>
                  </div>
                )}
                {(booking.discount_cents ?? 0) > 0 && (
                  <div className="flex items-center justify-between px-3 py-1 text-sm text-teal-600 dark:text-teal-400">
                    <span>★ {booking.discount_description || "Member discount"}</span>
                    <span>-${((booking.discount_cents ?? 0) / 100).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t bg-muted/30 px-3 py-2 text-sm font-semibold">
                  <span>Total</span>
                  <span>
                    {formatPrice(booking.total_price_cents - (booking.discount_cents ?? 0))}
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border">
                {(booking.discount_cents ?? 0) > 0 && (
                  <>
                    <div className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span className="text-muted-foreground">
                        {formatPrice(booking.total_price_cents)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-1 text-sm text-teal-600 dark:text-teal-400">
                      <span>★ {booking.discount_description || "Member discount"}</span>
                      <span>-${((booking.discount_cents ?? 0) / 100).toFixed(2)}</span>
                    </div>
                  </>
                )}
                <div className={`flex items-center justify-between px-3 py-2 text-sm ${(booking.discount_cents ?? 0) > 0 ? "border-t font-semibold" : ""}`}>
                  <span>Total</span>
                  <span className="font-semibold">
                    {formatPrice(booking.total_price_cents - (booking.discount_cents ?? 0))}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Payment / Refund info */}
          {paymentInfo &&
            !loadingPayment &&
            (paymentInfo.status === "refunded" ||
              paymentInfo.status === "partially_refunded") && (
              <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
                <DollarSign className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {paymentInfo.status === "refunded"
                    ? `Fully refunded: $${((paymentInfo.refunded_amount_cents || 0) / 100).toFixed(2)}`
                    : `Partially refunded: $${((paymentInfo.refunded_amount_cents || 0) / 100).toFixed(2)} of $${((paymentInfo.amount_cents || 0) / 100).toFixed(2)}`}
                </span>
              </div>
            )}

          {/* Notes */}
          {booking.notes && (
            <div>
              <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Notes
              </h4>
              <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm">
                <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="italic">{booking.notes}</p>
              </div>
            </div>
          )}

          {/* Modified from badge */}
          {booking.modifiedFrom && (
            <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-950/30 dark:text-blue-400">
              <ArrowRight className="h-3 w-3 shrink-0" />
              <span>
                Modified from{" "}
                <span className="font-semibold">
                  {formatTime(booking.modifiedFrom.startTime, timezone)} –{" "}
                  {formatTime(booking.modifiedFrom.endTime, timezone)},{" "}
                  {new Date(
                    booking.modifiedFrom.date + "T12:00:00"
                  ).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                  , {booking.modifiedFrom.bayName}
                </span>
              </span>
            </div>
          )}
        </div>

        {/* Collapsible Manage section */}
        {!cancelSuccess && (booking.canCancel || effectiveCanModify || canProcessRefund) && (
          <div className="border-t">
            <button
              type="button"
              onClick={() => setManageOpen(!manageOpen)}
              className="flex w-full items-center justify-between py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <span className="flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Manage
              </span>
              <ChevronDown
                className={`h-4 w-4 transition-transform duration-200 ${manageOpen ? "rotate-180" : ""}`}
              />
            </button>

            {manageOpen && (
              <div className="space-y-2 pb-2">
                {/* Cancellation/modification deadline notice */}
                {booking.status === "confirmed" &&
                  paymentMode !== "none" &&
                  !showCancelConfirm &&
                  !showRefundForm &&
                  (() => {
                    if (insideWindow) {
                      return (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>
                            This booking is within the {cancellationWindowHours}-hour cancellation window. Cancellations will not receive a refund. Modifications are not available.
                          </span>
                        </div>
                      );
                    }
                    if (booking.canCancel || booking.canModify) {
                      const deadlineMs =
                        new Date(booking.start_time).getTime() -
                        cancellationWindowHours * 60 * 60 * 1000;
                      const deadline = new Date(deadlineMs);
                      const dlDateStr = deadline.toLocaleDateString("en-US", {
                        timeZone: timezone,
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      });
                      const dlTimeStr = deadline.toLocaleTimeString("en-US", {
                        timeZone: timezone,
                        hour: "numeric",
                        minute: "2-digit",
                      });
                      return (
                        <p className="text-xs text-muted-foreground pb-1">
                          This booking can be canceled or modified until {dlDateStr} at {dlTimeStr}
                        </p>
                      );
                    }
                    return null;
                  })()}

                {showCancelConfirm ? (
                  renderCancelConfirmation()
                ) : showRefundForm ? (
                  renderProcessRefundForm()
                ) : (
                  <>
                    {effectiveCanModify && (
                      <Link
                        href={`/modify/${booking.id}`}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-primary/20 bg-white px-4 py-2.5 text-sm font-medium text-primary shadow-sm transition-colors hover:bg-primary/5 dark:border-primary/30 dark:bg-transparent dark:hover:bg-primary/10"
                      >
                        <Pencil className="h-4 w-4" />
                        Modify Booking
                      </Link>
                    )}

                    {booking.canCancel && cancelAction && (
                      <button
                        type="button"
                        onClick={() => setShowCancelConfirm(true)}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 shadow-sm transition-colors hover:bg-red-50 dark:border-red-800 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-950/30"
                      >
                        <X className="h-4 w-4" />
                        Cancel Booking
                      </button>
                    )}

                    {canProcessRefund && refundable > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowRefundForm(true)}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-green-200 bg-white px-4 py-2.5 text-sm font-medium text-green-700 shadow-sm transition-colors hover:bg-green-50 dark:border-green-800 dark:bg-transparent dark:text-green-400 dark:hover:bg-green-950/30"
                      >
                        <RotateCcw className="h-4 w-4" />
                        Process Refund
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>

      {/* Cancellation Policy Modal (nested dialog) */}
      {paymentInfo?.cancellation_policy_text && (
        <Dialog open={showPolicyModal} onOpenChange={setShowPolicyModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                Cancellation Policy
              </DialogTitle>
            </DialogHeader>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/50">
              <p className="text-sm leading-relaxed text-blue-700 dark:text-blue-300">
                {paymentInfo.cancellation_policy_text}
              </p>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}
