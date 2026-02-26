"use client";

import { useState } from "react";
import {
  BookingDetailsModal,
  type BookingDetailData,
} from "@/components/booking-details-modal";
import { formatTimeInZone } from "@/lib/utils";
import { ArrowRight } from "lucide-react";

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
  created_at: string;
  customer_id: string | null;
  bay_id: string;
  is_guest: boolean;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  modified_from: string | null;
  modified_from_info?: ModifiedFromInfo | null;
};

type Props = {
  bookings: Booking[];
  bayMap: Record<string, string>;
  customerMap: Record<string, { full_name: string | null; email: string }>;
  timezone: string;
  cancelAction: (formData: FormData) => Promise<void>;
};

function getCustomerDisplay(
  booking: Booking,
  customerMap: Record<string, { full_name: string | null; email: string }>
) {
  if (booking.is_guest) {
    return {
      name: booking.guest_name || "Guest",
      email: booking.guest_email || null,
      isGuest: true,
    };
  }
  const c = booking.customer_id ? customerMap[booking.customer_id] : null;
  return {
    name: c?.full_name || c?.email || "Unknown",
    email: c?.full_name ? c.email : null,
    isGuest: false,
  };
}

export function AdminBookingsList({
  bookings,
  bayMap,
  customerMap,
  timezone,
  cancelAction,
}: Props) {
  const [selectedBooking, setSelectedBooking] =
    useState<BookingDetailData | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  function openBooking(booking: Booking) {
    const display = getCustomerDisplay(booking, customerMap);
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
      bayName: bayMap[booking.bay_id] ?? "Unknown",
      canCancel: booking.status === "confirmed",
      canModify: booking.status === "confirmed",
      modifiedFrom: booking.modified_from_info || null,
      customerName: display.name,
      customerEmail: display.email,
      isGuest: display.isGuest,
      guestPhone: booking.is_guest ? booking.guest_phone : null,
    });
    setModalOpen(true);
  }

  return (
    <>
      {/* Desktop Table */}
      <div className="hidden md:block">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
          {bookings.length === 0 ? (
            <div className="px-5 py-16 text-center text-sm text-gray-500 dark:text-gray-400">
              No bookings found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-white/[0.05]">
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                      Customer
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                      Confirmation
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                      Date &amp; Time
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                      Facility
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                      Price
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                  {bookings.map((booking) => {
                    const display = getCustomerDisplay(booking, customerMap);
                    const timeStr = `${formatTimeInZone(booking.start_time, timezone)} – ${formatTimeInZone(booking.end_time, timezone)}`;
                    const dateStr = new Date(
                      booking.date + "T12:00:00"
                    ).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    });

                    return (
                      <tr
                        key={booking.id}
                        onClick={() => openBooking(booking)}
                        className="cursor-pointer transition-colors hover:bg-gray-50/50 dark:hover:bg-white/[0.02]"
                      >
                        <td className="px-5 py-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                                {display.name}
                              </p>
                              {display.isGuest && (
                                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                  Guest
                                </span>
                              )}
                            </div>
                            {display.email && (
                              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                                {display.email}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className="font-mono text-sm text-gray-600 dark:text-gray-300">
                            {booking.confirmation_code}
                          </span>
                          {booking.modified_from_info && (
                            <p className="mt-0.5 flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400">
                              <ArrowRight className="h-2.5 w-2.5" />
                              from{" "}
                              {formatTimeInZone(booking.modified_from_info.startTime, timezone)} – {formatTimeInZone(booking.modified_from_info.endTime, timezone)},{" "}
                              {new Date(booking.modified_from_info.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })},{" "}
                              {booking.modified_from_info.bayName}
                            </p>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <div>
                            <p className="text-sm text-gray-800 dark:text-white/90">
                              {dateStr}
                            </p>
                            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                              {timeStr}
                            </p>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className="text-sm text-gray-800 dark:text-white/90">
                            {bayMap[booking.bay_id] ?? "Unknown"}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <span className="text-sm font-semibold text-gray-800 dark:text-white/90">
                            ${(booking.total_price_cents / 100).toFixed(2)}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              booking.status === "confirmed"
                                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            }`}
                          >
                            {booking.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Card View */}
      <div className="space-y-3 md:hidden">
        {bookings.length === 0 && (
          <div className="rounded-xl border border-gray-200 bg-white px-5 py-16 text-center text-sm text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
            No bookings found.
          </div>
        )}

        {bookings.map((booking) => {
          const display = getCustomerDisplay(booking, customerMap);
          const timeStr = `${formatTimeInZone(booking.start_time, timezone)} – ${formatTimeInZone(booking.end_time, timezone)}`;
          const dateStr = new Date(booking.date + "T12:00:00").toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          });

          return (
            <button
              key={booking.id}
              type="button"
              onClick={() => openBooking(booking)}
              className="w-full rounded-xl border border-gray-200 bg-white p-4 text-left transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-white/[0.03] dark:hover:bg-white/[0.05]"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-gray-800 dark:text-white/90">
                      {display.name}
                    </p>
                    {display.isGuest && (
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
                    {dateStr} · {timeStr} · {bayMap[booking.bay_id] ?? "Unknown"}
                  </p>
                </div>
                <span className="ml-3 text-sm font-semibold text-gray-800 dark:text-white/90">
                  ${(booking.total_price_cents / 100).toFixed(2)}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <BookingDetailsModal
        booking={selectedBooking}
        variant="admin"
        timezone={timezone}
        open={modalOpen}
        onOpenChange={setModalOpen}
        cancelAction={cancelAction}
      />
    </>
  );
}
