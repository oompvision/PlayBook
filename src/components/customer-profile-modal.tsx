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
import { Mail, Phone, Calendar, Clock, Hash, DollarSign, StickyNote } from "lucide-react";

export type CustomerEntry = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  bookingCount: number;
  date: string;
  isGuest: boolean;
};

type Booking = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  confirmation_code: string | null;
  total_price_cents: number | null;
  notes: string | null;
  bay_name: string | null;
  slot_count: number;
  // guest fields
  guest_name?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
};

const avatarColors = [
  "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
  "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
  "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
  "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400",
  "bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400",
];

function getAvatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

function getInitials(name: string | null, email: string | null): string {
  if (name) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  if (email) return email[0].toUpperCase();
  return "?";
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatPrice(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

type Props = {
  customer: CustomerEntry | null;
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CustomerProfileModal({
  customer,
  orgId,
  open,
  onOpenChange,
}: Props) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !customer) {
      setBookings([]);
      return;
    }

    async function fetchBookings() {
      setLoading(true);
      const supabase = createClient();

      if (customer!.isGuest) {
        // For guest customers, fetch bookings matching guest identity
        let query = supabase
          .from("bookings")
          .select(
            "id, date, start_time, end_time, status, confirmation_code, total_price_cents, notes, guest_name, guest_email, guest_phone, bay_id, bays(name), booking_slots(id)"
          )
          .eq("org_id", orgId)
          .eq("is_guest", true)
          .order("date", { ascending: false });

        // Match by email or name from the guest key
        const guestKey = customer!.id.replace("guest-", "");
        if (guestKey.startsWith("name:")) {
          query = query.eq("guest_name", guestKey.replace("name:", ""));
        } else {
          query = query.eq("guest_email", guestKey);
        }

        const { data } = await query;
        setBookings(
          (data ?? []).map((b: Record<string, unknown>) => ({
            id: b.id as string,
            date: b.date as string,
            start_time: b.start_time as string,
            end_time: b.end_time as string,
            status: b.status as string,
            confirmation_code: b.confirmation_code as string | null,
            total_price_cents: b.total_price_cents as number | null,
            notes: b.notes as string | null,
            bay_name: (b.bays as { name: string } | null)?.name ?? null,
            slot_count: Array.isArray(b.booking_slots)
              ? b.booking_slots.length
              : 0,
          }))
        );
      } else {
        // For registered customers, fetch by customer_id
        const { data } = await supabase
          .from("bookings")
          .select(
            "id, date, start_time, end_time, status, confirmation_code, total_price_cents, notes, bay_id, bays(name), booking_slots(id)"
          )
          .eq("org_id", orgId)
          .eq("customer_id", customer!.id)
          .order("date", { ascending: false });

        setBookings(
          (data ?? []).map((b: Record<string, unknown>) => ({
            id: b.id as string,
            date: b.date as string,
            start_time: b.start_time as string,
            end_time: b.end_time as string,
            status: b.status as string,
            confirmation_code: b.confirmation_code as string | null,
            total_price_cents: b.total_price_cents as number | null,
            notes: b.notes as string | null,
            bay_name: (b.bays as { name: string } | null)?.name ?? null,
            slot_count: Array.isArray(b.booking_slots)
              ? b.booking_slots.length
              : 0,
          }))
        );
      }

      setLoading(false);
    }

    fetchBookings();
  }, [open, customer, orgId]);

  if (!customer) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-full text-sm font-semibold ${getAvatarColor(customer.id)}`}
            >
              {getInitials(customer.name, customer.email)}
            </div>
            <div>
              <DialogTitle className="flex items-center gap-2">
                {customer.name || "No name"}
                {customer.isGuest && (
                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    Guest
                  </span>
                )}
              </DialogTitle>
              <DialogDescription className="mt-0.5">
                Customer since{" "}
                {new Date(customer.date).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Contact Info */}
        <div className="flex flex-wrap gap-4 rounded-lg bg-muted/50 px-4 py-3">
          {customer.email && (
            <div className="flex items-center gap-2 text-sm">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span>{customer.email}</span>
            </div>
          )}
          {customer.phone && (
            <div className="flex items-center gap-2 text-sm">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{customer.phone}</span>
            </div>
          )}
          {!customer.email && !customer.phone && (
            <span className="text-sm text-muted-foreground">
              No contact info on file
            </span>
          )}
        </div>

        {/* Bookings */}
        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">
            Bookings ({loading ? "..." : bookings.length})
          </h3>

          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Loading bookings...
            </div>
          ) : bookings.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No bookings found
            </div>
          ) : (
            <div className="space-y-3 pb-2">
              {bookings.map((booking) => (
                <div
                  key={booking.id}
                  className="rounded-lg border bg-card p-3 space-y-2"
                >
                  {/* Top row: date, status, code */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm font-medium">
                        {new Date(booking.date + "T00:00:00").toLocaleDateString(
                          "en-US",
                          {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          }
                        )}
                      </span>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        booking.status === "confirmed"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      }`}
                    >
                      {booking.status}
                    </span>
                  </div>

                  {/* Details grid */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    {booking.bay_name && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {booking.bay_name}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      <span>
                        {formatTime(booking.start_time)} –{" "}
                        {formatTime(booking.end_time)}
                      </span>
                    </div>
                    {booking.confirmation_code && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Hash className="h-3.5 w-3.5" />
                        <span className="font-mono text-xs">
                          {booking.confirmation_code}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <DollarSign className="h-3.5 w-3.5" />
                      <span>{formatPrice(booking.total_price_cents)}</span>
                      {booking.slot_count > 0 && (
                        <span className="text-xs">
                          ({booking.slot_count} slot
                          {booking.slot_count !== 1 ? "s" : ""})
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Notes */}
                  {booking.notes && (
                    <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
                      <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="italic">{booking.notes}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
