"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  BookingDetailsModal,
  type BookingDetailData,
} from "@/components/booking-details-modal";
import { formatTimeInZone, getVisualBookingStatus } from "@/lib/utils";

type ModifiedFromInfo = {
  startTime: string;
  endTime: string;
  date: string;
  bayName: string;
};

type Booking = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  total_price_cents: number;
  status: string;
  confirmation_code: string;
  notes: string | null;
  bay_id: string;
  created_at: string;
  modified_from: string | null;
  modified_from_info?: ModifiedFromInfo | null;
  locationName?: string | null;
};

type Props = {
  upcoming: Booking[];
  past: Booking[];
  bayMap: Record<string, string>;
  timezone: string;
  orgId: string;
  initialBookingCode?: string | null;
  cancelAction: (formData: FormData) => Promise<void>;
  cancellationWindowHours?: number;
  paymentMode?: string;
};

function updateBookingUrl(code: string | null) {
  const url = new URL(window.location.href);
  if (code) {
    url.searchParams.set("booking", code);
  } else {
    url.searchParams.delete("booking");
  }
  window.history.replaceState(null, "", url.toString());
}

function isInsideCancellationWindow(
  bookingStartTime: string,
  windowHours: number
): boolean {
  const bookingStart = new Date(bookingStartTime).getTime();
  const cutoff = bookingStart - windowHours * 60 * 60 * 1000;
  return Date.now() >= cutoff;
}

export function MyBookingsList({
  upcoming,
  past,
  bayMap,
  timezone,
  orgId,
  initialBookingCode,
  cancelAction,
  cancellationWindowHours = 24,
  paymentMode = "none",
}: Props) {
  const [selectedBooking, setSelectedBooking] =
    useState<BookingDetailData | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [filterNotice, setFilterNotice] = useState<string | null>(null);
  const [autoOpenedCode, setAutoOpenedCode] = useState<string | null>(null);

  const allBookings = [...upcoming, ...past];

  // Fetch a booking independently by confirmation code
  async function fetchBookingByCode(code: string): Promise<BookingDetailData | null> {
    const supabase = createClient();
    const { data: booking } = await supabase
      .from("bookings")
      .select(
        "id, date, start_time, end_time, total_price_cents, status, confirmation_code, notes, bay_id, created_at, modified_from"
      )
      .eq("org_id", orgId)
      .eq("confirmation_code", code)
      .single();

    if (!booking) return null;

    // Get bay name
    let bayName = bayMap[booking.bay_id] ?? null;
    if (!bayName) {
      const { data: bay } = await supabase
        .from("bays")
        .select("name")
        .eq("id", booking.bay_id)
        .single();
      bayName = bay?.name ?? "Facility";
    }

    // Get modified_from info
    let modifiedFrom: ModifiedFromInfo | null = null;
    if (booking.modified_from) {
      const { data: original } = await supabase
        .from("bookings")
        .select("start_time, end_time, date, bay_id")
        .eq("id", booking.modified_from)
        .single();
      if (original) {
        let origBayName = bayMap[original.bay_id] ?? null;
        if (!origBayName) {
          const { data: origBay } = await supabase
            .from("bays")
            .select("name")
            .eq("id", original.bay_id)
            .single();
          origBayName = origBay?.name ?? "Facility";
        }
        modifiedFrom = {
          startTime: original.start_time,
          endTime: original.end_time,
          date: original.date,
          bayName: origBayName,
        };
      }
    }

    const isUpcoming = booking.status === "confirmed" && booking.date >= new Date().toISOString().slice(0, 10);

    return {
      id: booking.id,
      date: booking.date,
      start_time: booking.start_time,
      end_time: booking.end_time,
      total_price_cents: booking.total_price_cents,
      status: booking.status,
      confirmation_code: booking.confirmation_code,
      notes: booking.notes,
      created_at: booking.created_at,
      bayName,
      canCancel: isUpcoming,
      canModify: isUpcoming,
      modifiedFrom,
    };
  }

  // Auto-open booking from URL param (on mount or when prop changes via soft nav)
  useEffect(() => {
    if (!initialBookingCode) return;
    if (autoOpenedCode === initialBookingCode) return;
    setAutoOpenedCode(initialBookingCode);

    const found = allBookings.find(
      (b) => b.confirmation_code === initialBookingCode
    );
    if (found) {
      const isUpcoming = upcoming.some((b) => b.id === found.id);
      setSelectedBooking({
        id: found.id,
        date: found.date,
        start_time: found.start_time,
        end_time: found.end_time,
        total_price_cents: found.total_price_cents,
        status: found.status,
        confirmation_code: found.confirmation_code,
        notes: found.notes,
        created_at: found.created_at,
        bayName: bayMap[found.bay_id] || "Facility",
        locationName: found.locationName,
        canCancel: isUpcoming,
        canModify: isUpcoming,
        modifiedFrom: found.modified_from_info || null,
      });
      setModalOpen(true);
      return;
    }

    // Not found in current list — fetch independently
    fetchBookingByCode(initialBookingCode).then((data) => {
      if (data) {
        setFilterNotice(
          "Heads up — this booking was not found in your current bookings list."
        );
        setSelectedBooking(data);
        setModalOpen(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBookingCode, autoOpenedCode]);

  function openBooking(booking: Booking, canCancel: boolean) {
    setSelectedBooking({
      id: booking.id,
      date: booking.date,
      start_time: booking.start_time,
      end_time: booking.end_time,
      total_price_cents: booking.total_price_cents,
      status: booking.status,
      confirmation_code: booking.confirmation_code,
      notes: booking.notes,
      created_at: booking.created_at,
      bayName: bayMap[booking.bay_id] || "Facility",
      locationName: booking.locationName,
      canCancel,
      canModify: canCancel, // Same conditions as cancel: upcoming + confirmed
      modifiedFrom: booking.modified_from_info || null,
    });
    setFilterNotice(null);
    setModalOpen(true);
    updateBookingUrl(booking.confirmation_code);
  }

  function handleOpenChange(open: boolean) {
    setModalOpen(open);
    if (!open) {
      setFilterNotice(null);
      updateBookingUrl(null);
    }
  }

  return (
    <>
      {/* Upcoming */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold">Upcoming</h2>
        {upcoming.length === 0 && (
          <p className="mt-4 py-8 text-center text-muted-foreground">
            No upcoming bookings.{" "}
            <Link href="/" className="text-primary hover:underline">
              Book a session
            </Link>
          </p>
        )}
        <div className="mt-3 space-y-2">
          {upcoming.map((booking) => {
            const d = new Date(booking.date + "T12:00:00");
            const dateStr = d.toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            const timeStr = `${formatTimeInZone(booking.start_time, timezone)} – ${formatTimeInZone(booking.end_time, timezone)}`;
            const visualStatus = getVisualBookingStatus(booking.status, booking.start_time, booking.end_time);
            const isActive = visualStatus === "active";

            return (
              <button
                key={booking.id}
                type="button"
                onClick={() => openBooking(booking, true)}
                className="w-full rounded-lg border p-4 text-left transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{dateStr}</p>
                      {isActive ? (
                        <Badge className="bg-green-600 text-white hover:bg-green-600">
                          <span className="relative mr-1.5 flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                          </span>
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="default">Confirmed</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {timeStr} · {bayMap[booking.bay_id] || "Facility"}
                      {booking.locationName ? ` · ${booking.locationName}` : ""} · $
                      {(booking.total_price_cents / 100).toFixed(2)}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {booking.confirmation_code}
                    </p>
                    {booking.modified_from_info && (
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400">
                        <ArrowRight className="h-3 w-3" />
                        Modified from{" "}
                        <span className="font-semibold">
                          {formatTimeInZone(booking.modified_from_info.startTime, timezone)} – {formatTimeInZone(booking.modified_from_info.endTime, timezone)},{" "}
                          {new Date(booking.modified_from_info.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })},{" "}
                          {booking.modified_from_info.bayName}
                        </span>
                      </p>
                    )}
                    {booking.notes && (
                      <p className="mt-1 text-xs italic text-muted-foreground">
                        {booking.notes}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Past */}
      {past.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold">Past & Cancelled</h2>
          <div className="mt-3 space-y-2">
            {past.map((booking) => {
              const d = new Date(booking.date + "T12:00:00");
              const dateStr = d.toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              });
              const timeStr = `${formatTimeInZone(booking.start_time, timezone)} – ${formatTimeInZone(booking.end_time, timezone)}`;

              return (
                <button
                  key={booking.id}
                  type="button"
                  onClick={() => openBooking(booking, false)}
                  className="w-full rounded-lg border p-4 text-left opacity-60 transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{dateStr}</p>
                        <Badge
                          variant={
                            booking.status === "cancelled"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {booking.status === "cancelled"
                            ? "Cancelled"
                            : "Completed"}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {timeStr} · {bayMap[booking.bay_id] || "Facility"}
                        {booking.locationName ? ` · ${booking.locationName}` : ""} · $
                        {(booking.total_price_cents / 100).toFixed(2)}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {booking.confirmation_code}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <BookingDetailsModal
        booking={selectedBooking}
        variant="customer"
        timezone={timezone}
        open={modalOpen}
        onOpenChange={handleOpenChange}
        cancelAction={cancelAction}
        notice={filterNotice}
        cancellationWindowHours={cancellationWindowHours}
        paymentMode={paymentMode}
      />
    </>
  );
}
