"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
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
  orgId: string;
  initialBookingCode?: string | null;
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

function updateBookingUrl(code: string | null) {
  const url = new URL(window.location.href);
  if (code) {
    url.searchParams.set("booking", code);
  } else {
    url.searchParams.delete("booking");
  }
  window.history.replaceState(null, "", url.toString());
}

export function AdminBookingsList({
  bookings,
  bayMap,
  customerMap,
  timezone,
  orgId,
  initialBookingCode,
  cancelAction,
}: Props) {
  const [selectedBooking, setSelectedBooking] =
    useState<BookingDetailData | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [filterNotice, setFilterNotice] = useState<string | null>(null);
  // Track which booking code we've auto-opened (state resets properly on remount,
  // and re-triggers correctly when initialBookingCode changes via soft navigation)
  const [autoOpenedCode, setAutoOpenedCode] = useState<string | null>(null);

  // Fetch a booking independently by confirmation code (when not in filtered list)
  async function fetchBookingByCode(code: string): Promise<BookingDetailData | null> {
    const supabase = createClient();
    const { data: booking } = await supabase
      .from("bookings")
      .select(
        "id, date, start_time, end_time, total_price_cents, status, confirmation_code, notes, created_at, customer_id, bay_id, is_guest, guest_name, guest_email, guest_phone, modified_from"
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
      bayName = bay?.name ?? "Unknown";
    }

    // Get customer info
    let customerName = "Unknown";
    let customerEmail: string | null = null;
    if (booking.is_guest) {
      customerName = booking.guest_name || "Guest";
      customerEmail = booking.guest_email;
    } else if (booking.customer_id) {
      const cached = customerMap[booking.customer_id];
      if (cached) {
        customerName = cached.full_name || cached.email;
        customerEmail = cached.full_name ? cached.email : null;
      } else {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, email")
          .eq("id", booking.customer_id)
          .single();
        if (profile) {
          customerName = profile.full_name || profile.email;
          customerEmail = profile.full_name ? profile.email : null;
        }
      }
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
      canCancel: booking.status === "confirmed",
      canModify: booking.status === "confirmed",
      modifiedFrom,
      customerName,
      customerEmail,
      isGuest: booking.is_guest,
      guestPhone: booking.is_guest ? booking.guest_phone : null,
    };
  }

  // Auto-open booking from URL param (on mount or when prop changes via soft nav)
  useEffect(() => {
    if (!initialBookingCode) return;
    if (autoOpenedCode === initialBookingCode) return;
    setAutoOpenedCode(initialBookingCode);

    // Check if the booking is in the current filtered list
    const found = bookings.find(
      (b) => b.confirmation_code === initialBookingCode
    );
    if (found) {
      const display = getCustomerDisplay(found, customerMap);
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
        bayName: bayMap[found.bay_id] ?? "Unknown",
        canCancel: found.status === "confirmed",
        canModify: found.status === "confirmed",
        modifiedFrom: found.modified_from_info || null,
        customerName: display.name,
        customerEmail: display.email,
        isGuest: display.isGuest,
        guestPhone: found.is_guest ? found.guest_phone : null,
      });
      setModalOpen(true);
      return;
    }

    // Not in current filtered results — fetch independently
    fetchBookingByCode(initialBookingCode).then((data) => {
      if (data) {
        setFilterNotice(
          "Heads up — this booking is not included in your current filtered results."
        );
        setSelectedBooking(data);
        setModalOpen(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBookingCode, autoOpenedCode]);

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
        onOpenChange={handleOpenChange}
        cancelAction={cancelAction}
        notice={filterNotice}
      />
    </>
  );
}
