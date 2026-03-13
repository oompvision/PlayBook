"use client";

import React, { useState } from "react";
import { updateEmailSetting } from "@/app/admin/settings/email-actions";
import { StickyFooter } from "@/components/admin/sticky-footer";
import { Toast } from "@/components/ui/toast";

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

type PendingChange = {
  settingId: string;
  field: "email_to_customer" | "email_to_admin";
  value: boolean;
};

export function EmailSettingsToggles({
  settings,
}: {
  settings: EmailSetting[];
}) {
  const [localSettings, setLocalSettings] = useState(settings);
  const [savedSettings, setSavedSettings] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if any toggles differ from saved state
  const isDirty = localSettings.some((local) => {
    const saved = savedSettings.find((s) => s.id === local.id);
    if (!saved) return false;
    return (
      local.email_to_customer !== saved.email_to_customer ||
      local.email_to_admin !== saved.email_to_admin
    );
  });

  function handleToggle(
    settingId: string,
    field: "email_to_customer" | "email_to_admin",
    currentValue: boolean
  ) {
    const newValue = !currentValue;
    setLocalSettings((prev) =>
      prev.map((s) =>
        s.id === settingId ? { ...s, [field]: newValue } : s
      )
    );
    setError(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    // Collect all changes
    const changes: PendingChange[] = [];
    for (const local of localSettings) {
      const saved = savedSettings.find((s) => s.id === local.id);
      if (!saved) continue;
      if (local.email_to_customer !== saved.email_to_customer) {
        changes.push({
          settingId: local.id,
          field: "email_to_customer",
          value: local.email_to_customer,
        });
      }
      if (local.email_to_admin !== saved.email_to_admin) {
        changes.push({
          settingId: local.id,
          field: "email_to_admin",
          value: local.email_to_admin,
        });
      }
    }

    try {
      // Save all changes
      for (const change of changes) {
        const result = await updateEmailSetting(
          change.settingId,
          change.field,
          change.value
        );
        if (result.error) {
          throw new Error(result.error);
        }
      }
      // Update saved baseline
      setSavedSettings([...localSettings]);
      setShowToast(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      // Revert to saved state
      setLocalSettings([...savedSettings]);
    } finally {
      setSaving(false);
    }
  }

  const ordered = DISPLAY_ORDER.map((type) =>
    localSettings.find((s) => s.notification_type === type)
  ).filter(Boolean) as EmailSetting[];

  return (
    <>
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
                    type="button"
                    onClick={() =>
                      handleToggle(
                        setting.id,
                        "email_to_customer",
                        setting.email_to_customer
                      )
                    }
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
                    type="button"
                    onClick={() =>
                      handleToggle(
                        setting.id,
                        "email_to_admin",
                        setting.email_to_admin
                      )
                    }
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

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      <StickyFooter
        isDirty={isDirty}
        saving={saving}
        onSave={handleSave}
        submitLabel="Save Changes"
      />

      {showToast && (
        <Toast
          message="Notification settings saved."
          duration={5000}
          onClose={() => setShowToast(false)}
        />
      )}
    </>
  );
}
