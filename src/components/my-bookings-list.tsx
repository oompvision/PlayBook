"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  BookingDetailsModal,
  type BookingDetailData,
} from "@/components/booking-details-modal";
import { formatTimeInZone } from "@/lib/utils";

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
};

type Props = {
  upcoming: Booking[];
  past: Booking[];
  bayMap: Record<string, string>;
  timezone: string;
  cancelAction: (formData: FormData) => Promise<void>;
};

export function MyBookingsList({
  upcoming,
  past,
  bayMap,
  timezone,
  cancelAction,
}: Props) {
  const [selectedBooking, setSelectedBooking] =
    useState<BookingDetailData | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

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
      canCancel,
    });
    setModalOpen(true);
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
                      <Badge variant="default">Confirmed</Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {timeStr} · {bayMap[booking.bay_id] || "Facility"} · $
                      {(booking.total_price_cents / 100).toFixed(2)}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {booking.confirmation_code}
                    </p>
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
                        {timeStr} · {bayMap[booking.bay_id] || "Facility"} · $
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
        onOpenChange={setModalOpen}
        cancelAction={cancelAction}
      />
    </>
  );
}
