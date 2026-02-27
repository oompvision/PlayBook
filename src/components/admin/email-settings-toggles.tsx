"use client";

import React, { useState, useTransition } from "react";
import { Mail, MailX } from "lucide-react";
import { updateEmailSetting } from "@/app/admin/settings/email-actions";

type EmailSetting = {
  id: string;
  notification_type: string;
  email_to_customer: boolean;
  email_to_admin: boolean;
};

const TYPE_LABELS: Record<string, string> = {
  booking_confirmed: "Booking Confirmed",
  booking_canceled: "Booking Cancelled",
  booking_modified: "Booking Modified",
  booking_reminder_48hr: "48-Hour Reminder",
  cancellation_window_closed: "Cancellation Window Closed",
  guest_booking_created: "Guest Booking Created",
  new_customer_signup: "New Customer Sign-up",
  welcome: "Welcome Message",
  admin_daily_digest: "Daily Digest",
};

// Types that have a customer email toggle
const CUSTOMER_TYPES = new Set([
  "booking_confirmed",
  "booking_canceled",
  "booking_modified",
  "booking_reminder_48hr",
  "cancellation_window_closed",
  "welcome",
]);

// Types that have an admin email toggle
const ADMIN_TYPES = new Set([
  "booking_confirmed",
  "booking_canceled",
  "booking_modified",
  "new_customer_signup",
  "guest_booking_created",
]);

// Display order
const DISPLAY_ORDER = [
  "booking_confirmed",
  "booking_canceled",
  "booking_modified",
  "booking_reminder_48hr",
  "cancellation_window_closed",
  "guest_booking_created",
  "new_customer_signup",
  "welcome",
];

export function EmailSettingsToggles({
  settings,
}: {
  settings: EmailSetting[];
}) {
  const [localSettings, setLocalSettings] = useState(settings);
  const [isPending, startTransition] = useTransition();

  function handleToggle(
    settingId: string,
    field: "email_to_customer" | "email_to_admin",
    currentValue: boolean
  ) {
    const newValue = !currentValue;

    // Optimistic update
    setLocalSettings((prev) =>
      prev.map((s) =>
        s.id === settingId ? { ...s, [field]: newValue } : s
      )
    );

    startTransition(async () => {
      const result = await updateEmailSetting(settingId, field, newValue);
      if (result.error) {
        // Revert on error
        setLocalSettings((prev) =>
          prev.map((s) =>
            s.id === settingId ? { ...s, [field]: currentValue } : s
          )
        );
      }
    });
  }

  const ordered = DISPLAY_ORDER.map((type) =>
    localSettings.find((s) => s.notification_type === type)
  ).filter(Boolean) as EmailSetting[];

  return (
    <div className="divide-y divide-gray-100">
      {/* Column headers */}
      <div className="flex items-center gap-4 px-1 pb-3">
        <div className="flex-1 text-xs font-medium uppercase tracking-wider text-gray-400">
          Notification Type
        </div>
        <div className="w-24 text-center text-xs font-medium uppercase tracking-wider text-gray-400">
          Customer
        </div>
        <div className="w-24 text-center text-xs font-medium uppercase tracking-wider text-gray-400">
          Admin
        </div>
      </div>

      {ordered.map((setting) => {
        const label =
          TYPE_LABELS[setting.notification_type] || setting.notification_type;
        const hasCustomer = CUSTOMER_TYPES.has(setting.notification_type);
        const hasAdmin = ADMIN_TYPES.has(setting.notification_type);

        return (
          <div
            key={setting.id}
            className="flex items-center gap-4 px-1 py-3"
          >
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-700">{label}</p>
            </div>

            {/* Customer toggle */}
            <div className="flex w-24 justify-center">
              {hasCustomer ? (
                <button
                  onClick={() =>
                    handleToggle(
                      setting.id,
                      "email_to_customer",
                      setting.email_to_customer
                    )
                  }
                  disabled={isPending}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    setting.email_to_customer
                      ? "bg-blue-600"
                      : "bg-gray-200"
                  }`}
                  aria-label={`${label} email to customer ${setting.email_to_customer ? "on" : "off"}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                      setting.email_to_customer
                        ? "translate-x-6"
                        : "translate-x-1"
                    }`}
                  />
                </button>
              ) : (
                <span className="text-xs text-gray-300">—</span>
              )}
            </div>

            {/* Admin toggle */}
            <div className="flex w-24 justify-center">
              {hasAdmin ? (
                <button
                  onClick={() =>
                    handleToggle(
                      setting.id,
                      "email_to_admin",
                      setting.email_to_admin
                    )
                  }
                  disabled={isPending}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    setting.email_to_admin ? "bg-blue-600" : "bg-gray-200"
                  }`}
                  aria-label={`${label} email to admin ${setting.email_to_admin ? "on" : "off"}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                      setting.email_to_admin
                        ? "translate-x-6"
                        : "translate-x-1"
                    }`}
                  />
                </button>
              ) : (
                <span className="text-xs text-gray-300">—</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
