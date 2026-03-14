"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { StickyFooter } from "@/components/admin/sticky-footer";
import { Toast } from "@/components/ui/toast";

type EventsSettingsProps = {
  initialEnabled: boolean;
  activeEventCount: number;
};

export function EventsSettings({
  initialEnabled,
  activeEventCount,
}: EventsSettingsProps) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [baseEnabled, setBaseEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDisableError, setShowDisableError] = useState(false);

  function handleToggle() {
    if (enabled) {
      // Trying to disable — block if active event registrations exist
      if (activeEventCount > 0) {
        setShowDisableError(true);
        return;
      }
      setEnabled(false);
      setShowDisableError(false);
    } else {
      setEnabled(true);
    }
    setError(null);
    setShowToast(false);
  }

  async function handleSave() {
    setError(null);
    setShowToast(false);
    setSaving(true);

    try {
      const res = await fetch("/api/admin/events-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events_enabled: enabled }),
      });

      // Guard against redirect responses (HTML instead of JSON)
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("Session expired — please refresh the page and try again");
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to save");
      }

      // Verify the persisted value matches what we sent
      if (typeof data.events_enabled === "boolean" && data.events_enabled !== enabled) {
        throw new Error("Save appeared to succeed but the value did not persist. Please try again.");
      }

      setShowToast(true);
      setBaseEnabled(enabled);
      // Use Next.js router refresh to invalidate server component cache
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const hasChanged = enabled !== baseEnabled;

  return (
    <>
    <div className="space-y-6">
      {/* Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-white/90">
            Enable Events
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Show the Events tab in the admin dashboard and display upcoming events to customers.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
            enabled ? "bg-blue-600" : "bg-gray-200 dark:bg-gray-700"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {/* Disable guard error */}
      {showDisableError && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Cannot disable Events
            </p>
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
              There {activeEventCount === 1 ? "is" : "are"}{" "}
              {activeEventCount} published{" "}
              {activeEventCount === 1 ? "event" : "events"} with active
              registrations. Cancel or complete all events with registrations
              before disabling.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}
    </div>

    <StickyFooter
      isDirty={hasChanged}
      saving={saving}
      onSave={handleSave}
      submitLabel="Save Changes"
    />

    {showToast && (
      <Toast
        message="Events settings saved."
        duration={5000}
        onClose={() => setShowToast(false)}
      />
    )}
    </>
  );
}
