"use client";

import { useState } from "react";
import { ChevronDown, X } from "lucide-react";

interface BookingCardExpandableProps {
  booking: {
    id: string;
    date: string;
    start_time: string;
    end_time: string;
    total_price_cents: number;
    status: string;
    confirmation_code: string;
    notes: string | null;
    bay_id: string;
  };
  customerName: string;
  customerEmail: string;
  isGuest?: boolean;
  bayName: string;
  timeStr: string;
  dateStr: string;
  cancelAction: (formData: FormData) => Promise<void>;
}

export function BookingCardExpandable({
  booking,
  customerName,
  customerEmail,
  isGuest,
  bayName,
  timeStr,
  dateStr,
  cancelAction,
}: BookingCardExpandableProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-gray-800 dark:text-white/90">
              {customerName}
            </p>
            {isGuest && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                Guest
              </span>
            )}
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                booking.status === "confirmed"
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              }`}
            >
              {booking.status}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {dateStr} · {timeStr} · {bayName}
          </p>
        </div>
        <div className="ml-3 flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800 dark:text-white/90">
            ${(booking.total_price_cents / 100).toFixed(2)}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 dark:border-gray-800">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Confirmation</span>
              <span className="font-mono text-gray-800 dark:text-white/90">
                {booking.confirmation_code}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Customer</span>
              <span className="flex items-center gap-1.5 text-gray-800 dark:text-white/90">
                {customerName}
                {isGuest && (
                  <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    Guest
                  </span>
                )}
              </span>
            </div>
            {customerEmail && customerEmail !== customerName && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Email</span>
                <span className="text-gray-800 dark:text-white/90">{customerEmail}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Facility</span>
              <span className="text-gray-800 dark:text-white/90">{bayName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Date</span>
              <span className="text-gray-800 dark:text-white/90">{dateStr}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Time</span>
              <span className="text-gray-800 dark:text-white/90">{timeStr}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Price</span>
              <span className="font-semibold text-gray-800 dark:text-white/90">
                ${(booking.total_price_cents / 100).toFixed(2)}
              </span>
            </div>
            {booking.notes && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Notes</span>
                <span className="text-right text-gray-800 italic dark:text-white/90">
                  {booking.notes}
                </span>
              </div>
            )}
          </div>

          {booking.status === "confirmed" && (
            <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-800">
              <form action={cancelAction}>
                <input type="hidden" name="booking_id" value={booking.id} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 shadow-sm transition-colors hover:bg-red-50 dark:border-red-800 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  <X className="h-3 w-3" />
                  Cancel Booking
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
