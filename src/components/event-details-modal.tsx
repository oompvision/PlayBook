"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Calendar,
  Clock,
  MapPin,
  Users,
  DollarSign,
  X,
  AlertTriangle,
  Loader2,
  FileText,
  Settings2,
  ChevronDown,
  CheckCircle2,
} from "lucide-react";
import { formatPrice } from "@/lib/utils";

export type EventDetailData = {
  registrationId: string;
  eventId: string;
  eventName: string;
  description: string | null;
  startTime: string;
  endTime: string;
  priceCents: number;
  capacity: number;
  registeredCount: number;
  bayNames: string;
  registrationStatus: string;
  waitlistPosition: number | null;
  registeredAt: string;
};

type Props = {
  event: EventDetailData | null;
  timezone: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cancelAction?: (formData: FormData) => Promise<void>;
  onCancelClient?: (registrationId: string) => Promise<void>;
  onCancelComplete?: (eventName: string) => void;
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
  eventStartTime: string,
  windowHours: number
): boolean {
  const eventStart = new Date(eventStartTime).getTime();
  const cutoff = eventStart - windowHours * 60 * 60 * 1000;
  return Date.now() >= cutoff;
}

function getStatusBadge(status: string, waitlistPosition: number | null) {
  switch (status) {
    case "confirmed":
      return <Badge className="bg-green-600 text-white hover:bg-green-600">Confirmed</Badge>;
    case "waitlisted":
      return (
        <Badge className="bg-blue-600 text-white hover:bg-blue-600">
          Waitlisted{waitlistPosition != null ? ` #${waitlistPosition}` : ""}
        </Badge>
      );
    case "pending_payment":
      return (
        <Badge className="bg-amber-500 text-white hover:bg-amber-500">
          Payment Pending
        </Badge>
      );
    case "cancelled":
      return <Badge variant="secondary">Cancelled</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function EventDetailsModal({
  event,
  timezone,
  open,
  onOpenChange,
  cancelAction,
  onCancelClient,
  onCancelComplete,
  cancellationWindowHours = 24,
  paymentMode = "none",
}: Props) {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setShowCancelConfirm(false);
      setCancelling(false);
      setManageOpen(false);
    }
  }, [open]);

  if (!event) return null;

  const dateStr = new Date(event.startTime).toLocaleDateString("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeStr = `${formatTime(event.startTime, timezone)} – ${formatTime(event.endTime, timezone)}`;
  const registeredStr = new Date(event.registeredAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const spotsLeft = event.capacity - event.registeredCount;
  const isFull = spotsLeft <= 0;
  const canCancel = event.registrationStatus !== "cancelled";
  const hasPaidEvent = paymentMode !== "none" && event.priceCents > 0;
  const insideWindow = isInsideCancellationWindow(event.startTime, cancellationWindowHours);

  async function handleCancel() {
    setCancelling(true);
    try {
      if (cancelAction) {
        const formData = new FormData();
        formData.set("registration_id", event!.registrationId);
        await cancelAction(formData);
      } else if (onCancelClient) {
        await onCancelClient(event!.registrationId);
      }
      onOpenChange(false);
      onCancelComplete?.(event!.eventName);
    } catch {
      setCancelling(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setShowCancelConfirm(false);
          setCancelling(false);
          setManageOpen(false);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-between pr-6">
            <div className="flex items-center gap-2">
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400">
                Event
              </Badge>
              {getStatusBadge(event.registrationStatus, event.waitlistPosition)}
            </div>
          </div>
          <DialogTitle className="text-lg">{event.eventName}</DialogTitle>
          <DialogDescription>Registered on {registeredStr}</DialogDescription>
        </DialogHeader>

        <div className="-mx-6 flex-1 space-y-4 overflow-y-auto px-6">
          {/* Event Details */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{dateStr}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>{timeStr}</span>
            </div>
            {event.bayNames && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span>{event.bayNames}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span>
                {isFull ? (
                  <>
                    <span className="font-medium text-amber-600 dark:text-amber-400">Full</span>
                    {" · "}{event.registeredCount} / {event.capacity} registered
                  </>
                ) : (
                  <>
                    {spotsLeft} {spotsLeft === 1 ? "spot" : "spots"} left
                    {" · "}{event.registeredCount} / {event.capacity} registered
                  </>
                )}
              </span>
            </div>
            {event.priceCents > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">
                  {formatPrice(event.priceCents)}
                </span>
              </div>
            )}
            {event.priceCents === 0 && (
              <div className="flex items-center gap-2 text-sm">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-green-600 dark:text-green-400">Free</span>
              </div>
            )}
          </div>

          {/* Waitlist Info */}
          {event.registrationStatus === "waitlisted" && event.waitlistPosition != null && (
            <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-400">
              <Users className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                You are <span className="font-semibold">#{event.waitlistPosition}</span> on
                the waitlist. You&apos;ll be notified if a spot opens up.
              </span>
            </div>
          )}

          {/* Description */}
          {event.description && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                About
              </h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {event.description}
              </p>
            </div>
          )}
        </div>

        {/* Collapsible Manage section */}
        {canCancel && (cancelAction || onCancelClient) && (
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
                {/* Cancellation window notice */}
                {!showCancelConfirm && (() => {
                  if (hasPaidEvent && insideWindow) {
                    return (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          This event is within the {cancellationWindowHours}-hour cancellation window. Cancellations will not receive a refund.
                        </span>
                      </div>
                    );
                  }
                  if (hasPaidEvent && !insideWindow) {
                    const deadlineMs =
                      new Date(event.startTime).getTime() -
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
                        Free cancellation until {dlDateStr} at {dlTimeStr}
                      </p>
                    );
                  }
                  return null;
                })()}

                {showCancelConfirm ? (
                  <div className="space-y-3">
                    {hasPaidEvent && insideWindow && (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                          <p className="font-medium">No refund will be issued</p>
                          <p className="mt-0.5 text-xs">
                            This event is within the {cancellationWindowHours}-hour
                            cancellation window. If you believe you should receive a refund,
                            please contact the facility after cancelling.
                          </p>
                        </div>
                      </div>
                    )}

                    {hasPaidEvent && !insideWindow && (
                      <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                          <p className="font-medium">Full refund will be issued</p>
                          <p className="mt-0.5 text-xs">
                            You&apos;re cancelling more than {cancellationWindowHours} hours
                            before the event start time. A full refund of{" "}
                            {formatPrice(event.priceCents)} will be processed automatically.
                          </p>
                        </div>
                      </div>
                    )}

                    {!hasPaidEvent && (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          Are you sure you want to cancel your registration? This action cannot be undone.
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
                        onClick={handleCancel}
                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                      >
                        {cancelling ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                        Cancel Registration
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowCancelConfirm(true)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 shadow-sm transition-colors hover:bg-red-50 dark:border-red-800 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-950/30"
                  >
                    <X className="h-4 w-4" />
                    Cancel Registration
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
