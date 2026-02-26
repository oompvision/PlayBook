"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
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
  User,
  Mail,
  Phone,
  StickyNote,
  X,
} from "lucide-react";

export type BookingDetailData = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  total_price_cents: number;
  status: string;
  confirmation_code: string;
  notes: string | null;
  created_at: string;
  bayName: string;
  canCancel?: boolean;
  // Admin-only fields
  customerName?: string;
  customerEmail?: string | null;
  isGuest?: boolean;
  guestPhone?: string | null;
};

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
};

function formatTime(timestamp: string, timezone: string): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
}

export function BookingDetailsModal({
  booking,
  variant,
  timezone,
  open,
  onOpenChange,
  cancelAction,
}: Props) {
  const [slots, setSlots] = useState<SlotDetail[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  useEffect(() => {
    if (!open || !booking) {
      setSlots([]);
      return;
    }

    async function fetchSlots() {
      setLoadingSlots(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("booking_slots")
        .select(
          "bay_schedule_slots(start_time, end_time, price_cents)"
        )
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

    fetchSlots();
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-between pr-6">
            <DialogTitle className="font-mono text-lg">
              {booking.confirmation_code}
            </DialogTitle>
            <Badge
              variant={
                booking.status === "confirmed" ? "default" : "secondary"
              }
            >
              {booking.status === "confirmed" ? "Confirmed" : "Cancelled"}
            </Badge>
          </div>
          <DialogDescription>Booked on {createdStr}</DialogDescription>
        </DialogHeader>

        <div className="-mx-6 flex-1 space-y-4 overflow-y-auto px-6">
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

          {/* Booking Details */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{dateStr}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>{timeStr}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span>{booking.bayName}</span>
            </div>
          </div>

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
                      <span>${(slot.price_cents / 100).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between border-t bg-muted/30 px-3 py-2 text-sm font-semibold">
                  <span>Total</span>
                  <span>
                    ${(booking.total_price_cents / 100).toFixed(2)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                <span>Total</span>
                <span className="font-semibold">
                  ${(booking.total_price_cents / 100).toFixed(2)}
                </span>
              </div>
            )}
          </div>

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
        </div>

        {/* Footer: Cancel button */}
        {booking.canCancel && cancelAction && (
          <div className="mt-2 border-t pt-4">
            <form action={cancelAction}>
              <input type="hidden" name="booking_id" value={booking.id} />
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 shadow-sm transition-colors hover:bg-red-50 dark:border-red-800 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-950/30"
              >
                <X className="h-4 w-4" />
                Cancel Booking
              </button>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
