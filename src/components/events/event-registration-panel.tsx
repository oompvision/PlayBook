"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import {
  CalendarDays,
  Clock,
  MapPin,
  Users,
  Loader2,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  X,
  Crown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PaymentSection,
  type CheckoutFormHandle,
} from "@/components/checkout-form";
import type { EventDiscountInfo } from "./events-feed";
import { formatPrice } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type EventForPanel = {
  id: string;
  name: string;
  description: string | null;
  startTime: string;
  endTime: string;
  capacity: number;
  registeredCount: number;
  priceCents: number;
  membersOnly: boolean;
  bayNames: string;
};

type EventRegistrationPanelProps = {
  event: EventForPanel;
  timezone: string;
  isAuthenticated: boolean;
  isMember: boolean;
  eventDiscount?: EventDiscountInfo;
  paymentMode: string;
  onClose: () => void;
  onRegistered: (status: string) => void;
};

type CheckoutIntent = {
  client_secret: string;
  intent_type: "payment" | "setup";
  intent_id: string;
  stripe_customer_id: string;
  stripe_account_id: string;
  amount_cents: number;
  cancellation_policy_text: string;
};

// ─── Component ──────────────────────────────────────────────────────────────────

function calcEventDiscount(priceCents: number, discount: EventDiscountInfo): { discountCents: number; finalCents: number; label: string } {
  if (!discount || discount.value <= 0) return { discountCents: 0, finalCents: priceCents, label: "" };
  let discountCents: number;
  let label: string;
  if (discount.type === "percent") {
    discountCents = Math.round(priceCents * discount.value / 100);
    label = `${discount.value}% member discount`;
  } else {
    discountCents = Math.min(discount.value * 100, priceCents);
    label = `${formatPrice(discount.value * 100)} member discount`;
  }
  return { discountCents, finalCents: priceCents - discountCents, label };
}

export function EventRegistrationPanel({
  event,
  timezone,
  isAuthenticated,
  isMember,
  eventDiscount = null,
  paymentMode,
  onClose,
  onRegistered,
}: EventRegistrationPanelProps) {
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registrationId, setRegistrationId] = useState<string | null>(null);
  const [checkoutIntent, setCheckoutIntent] = useState<CheckoutIntent | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const checkoutFormRef = useRef<CheckoutFormHandle | null>(null);

  const requiresPayment =
    paymentMode !== "none" && event.priceCents > 0;
  const totalSteps = requiresPayment ? 2 : 1;
  const spotsLeft = event.capacity - event.registeredCount;

  useEffect(() => {
    setMounted(true);
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Cancel a pending_payment registration that was never completed
  async function cancelPendingRegistration() {
    if (!registrationId || confirmed) return;
    try {
      const supabase = createClient();
      await supabase.rpc("cancel_event_registration", {
        p_registration_id: registrationId,
      });
    } catch {
      // Best-effort cleanup — don't block the user from closing
    }
  }

  function handleClose() {
    // If user is on a payment step with an uncommitted registration, cancel it
    if (step > 1 && registrationId && !confirmed) {
      cancelPendingRegistration();
    }
    onClose();
  }

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));

  const formatTime = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));

  // Step 1 → register + create intent (paid) or just register (free)
  async function handleContinue() {
    if (!isAuthenticated) {
      window.location.href =
        "/auth/login?redirect=" + encodeURIComponent(window.location.pathname);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = "/auth/login";
        return;
      }

      // Check if user is already registered for this event
      const { data: existingReg } = await supabase
        .from("event_registrations")
        .select("id, status")
        .eq("event_id", event.id)
        .eq("user_id", user.id)
        .in("status", ["confirmed", "waitlisted", "pending_payment"])
        .maybeSingle();

      if (existingReg) {
        const statusLabel =
          existingReg.status === "confirmed"
            ? "registered"
            : existingReg.status === "waitlisted"
              ? "on the waitlist"
              : "pending payment";
        setError(
          `You're already ${statusLabel} for this event. Check "My Bookings" to view or manage your registration.`
        );
        return;
      }

      // Register for the event
      const { data: regResult, error: regError } = await supabase.rpc(
        "register_for_event",
        { p_event_id: event.id, p_user_id: user.id }
      );

      if (regError) {
        setError(regError.message);
        return;
      }

      const result = regResult as {
        registration_id: string;
        status: string;
        waitlist_position: number | null;
        price_cents: number;
      };

      setRegistrationId(result.registration_id);

      // Free event or no payment required → confirmed immediately
      if (!requiresPayment || result.status === "confirmed") {
        setConfirmed(true);
        onRegistered(result.status);
        return;
      }

      // Waitlisted → no payment needed
      if (result.status === "waitlisted") {
        setConfirmed(true);
        onRegistered(result.status);
        return;
      }

      // Paid event → create checkout intent
      const disc = calcEventDiscount(event.priceCents, eventDiscount);
      const intentRes = await fetch("/api/stripe/create-event-checkout-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: event.id,
          registration_id: result.registration_id,
          discount_cents: disc.discountCents || undefined,
        }),
      });

      if (!intentRes.ok) {
        const body = await intentRes.json();
        setError(body.error || "Failed to create payment");
        return;
      }

      const intent: CheckoutIntent = await intentRes.json();
      setCheckoutIntent(intent);
      setStep(2);
    } catch {
      setError("Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Step 2 → confirm card + register & pay in one action
  async function handleRegisterAndPay() {
    if (!checkoutFormRef.current || !registrationId || !checkoutIntent) return;

    setLoading(true);
    setError(null);

    try {
      // Confirm card info
      const cardResult = await checkoutFormRef.current.confirmAndGetCardInfo();
      if (!cardResult.success) {
        setError(cardResult.error || "Payment confirmation failed");
        return;
      }

      // Record the payment in booking_payments (for refund tracking)
      const recordRes = await fetch("/api/stripe/record-booking-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_registration_id: registrationId,
          intent_id: checkoutIntent.intent_id,
          intent_type: checkoutIntent.intent_type,
          stripe_customer_id: checkoutIntent.stripe_customer_id,
          stripe_payment_method_id: cardResult.paymentMethodId || null,
          amount_cents: checkoutIntent.amount_cents,
          cancellation_policy_text: checkoutIntent.cancellation_policy_text,
          policy_agreed_at: new Date().toISOString(),
        }),
      });

      if (!recordRes.ok) {
        // Fallback: still try to confirm via RPC so registration isn't stuck
        const supabase = createClient();
        await supabase.rpc("confirm_event_payment", {
          p_registration_id: registrationId,
          p_payment_intent_id: checkoutIntent.intent_id,
        });
      }

      setConfirmed(true);
      onRegistered("confirmed");
    } catch {
      setError("Payment failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const disc = calcEventDiscount(event.priceCents, eventDiscount);
  const hasDiscount = disc.discountCents > 0;
  const priceLabel =
    event.priceCents === 0
      ? "Free"
      : hasDiscount
        ? formatPrice(disc.finalCents)
        : formatPrice(event.priceCents);

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40 transition-opacity"
        onClick={handleClose}
      />

      {/* Panel */}
      <div className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-background shadow-2xl">
        <div className="mx-auto max-w-lg px-6 py-6">
          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {step > 1 && !confirmed && (
                <button
                  onClick={() => {
                    // Going back from payment step 2 → cancel the pending registration
                    // so user doesn't end up with a dangling pending_payment record
                    if (step === 2 && registrationId) {
                      cancelPendingRegistration();
                      setRegistrationId(null);
                      setCheckoutIntent(null);
                    }
                    setStep(step - 1);
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <div>
                <h2 className="text-lg font-semibold">
                  {confirmed ? "Registration Confirmed" : "Event Registration"}
                </h2>
                {!confirmed && requiresPayment && (
                  <p className="text-xs text-muted-foreground">
                    Step {step} of {totalSteps}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={handleClose}
              className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Success State */}
          {confirmed ? (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-semibold">You&apos;re registered!</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {event.name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatDate(event.startTime)} &middot;{" "}
                  {formatTime(event.startTime)} – {formatTime(event.endTime)}
                </p>
              </div>
              <Button onClick={onClose} className="mt-4">
                Done
              </Button>
            </div>
          ) : (
            <>
              {/* Event Details (always visible) */}
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{event.name}</h3>
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        Event
                      </span>
                    </div>
                    {event.description && step === 1 && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {event.description}
                      </p>
                    )}
                  </div>
                  <span className="text-lg font-bold">
                    {hasDiscount ? (
                      <span className="inline-flex flex-col items-end">
                        <span className="text-sm text-gray-400 line-through">{formatPrice(event.priceCents)}</span>
                        <span className="text-green-600 dark:text-green-400">{priceLabel}</span>
                      </span>
                    ) : priceLabel}
                  </span>
                </div>

                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CalendarDays className="h-4 w-4 shrink-0" />
                    <span>{formatDate(event.startTime)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4 shrink-0" />
                    <span>
                      {formatTime(event.startTime)} –{" "}
                      {formatTime(event.endTime)}
                    </span>
                  </div>
                  {event.bayNames && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4 shrink-0" />
                      <span>{event.bayNames}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Users className="h-4 w-4 shrink-0" />
                    <span>
                      {spotsLeft > 0
                        ? `${spotsLeft} spot${spotsLeft !== 1 ? "s" : ""} remaining`
                        : "Event is full"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Discount breakdown */}
              {hasDiscount && event.priceCents > 0 && step === 1 && (
                <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatPrice(event.priceCents)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-green-600 dark:text-green-400">
                    <span className="flex items-center gap-1"><Crown className="h-3.5 w-3.5" />{disc.label}</span>
                    <span>-{formatPrice(disc.discountCents)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between border-t border-green-200 pt-1 text-sm font-semibold dark:border-green-800">
                    <span>Total</span>
                    <span>{formatPrice(disc.finalCents)}</span>
                  </div>
                </div>
              )}

              {/* Step 1: Register / Continue to Payment */}
              {step === 1 && (
                <div className="mt-6">
                  {!isAuthenticated ? (
                    <div className="text-center">
                      <p className="mb-4 text-sm text-muted-foreground">
                        Sign in to register for this event.
                      </p>
                      <Button
                        onClick={() => {
                          window.location.href =
                            "/auth/login?redirect=" +
                            encodeURIComponent(window.location.pathname);
                        }}
                        className="w-full"
                      >
                        Sign In to Register
                      </Button>
                    </div>
                  ) : (
                    <Button
                      onClick={handleContinue}
                      disabled={loading || spotsLeft <= 0}
                      className="w-full gap-2"
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : requiresPayment ? (
                        <>
                          Continue to Payment
                          <ArrowRight className="h-4 w-4" />
                        </>
                      ) : (
                        "Confirm Registration"
                      )}
                    </Button>
                  )}
                </div>
              )}

              {/* Step 2: Payment — enter card & register in one step */}
              {step === 2 && checkoutIntent && (
                <div className="mt-6">
                  <PaymentSection
                    stripeAccountId={checkoutIntent.stripe_account_id}
                    clientSecret={checkoutIntent.client_secret}
                    intentType={checkoutIntent.intent_type}
                    paymentMode={paymentMode}
                    amountCents={checkoutIntent.amount_cents}
                    cancellationPolicyText={
                      checkoutIntent.cancellation_policy_text
                    }
                    checkoutFormRef={checkoutFormRef}
                  />
                  <Button
                    onClick={handleRegisterAndPay}
                    disabled={loading}
                    className="mt-4 w-full gap-2"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : paymentMode === "charge_upfront" ? (
                      `Register & Pay ${priceLabel}`
                    ) : (
                      `Register & Save Card`
                    )}
                  </Button>
                </div>
              )}

              {/* Error display */}
              {error && (
                <p className="mt-3 text-center text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
