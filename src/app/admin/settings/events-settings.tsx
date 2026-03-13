"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";

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
  const [saved, setSaved] = useState(false);
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
    setSaved(false);
  }

  async function handleSave() {
    setError(null);
    setSaved(false);
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

      setSaved(true);
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

      {/* Save button (only show when changed) */}
      {hasChanged && (
        <div className="flex items-center gap-3 border-t border-gray-200 pt-6 dark:border-white/[0.05]">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
          {saved && (
            <span className="text-sm text-green-600 dark:text-green-400">
              Saved!
            </span>
          )}
          {error && (
            <span className="text-sm text-red-600 dark:text-red-400">
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
