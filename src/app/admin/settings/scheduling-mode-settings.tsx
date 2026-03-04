"use client";

import { useState } from "react";
import { CalendarCog, AlertTriangle } from "lucide-react";

type SchedulingMode = "slot_based" | "dynamic";

export function SchedulingModeSettings({
  initialMode,
  initialBookableWindowDays,
}: {
  initialMode: SchedulingMode;
  initialBookableWindowDays: number;
}) {
  const [mode, setMode] = useState<SchedulingMode>(initialMode);
  const [bookableWindowDays, setBookableWindowDays] = useState(
    initialBookableWindowDays
  );
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingMode, setPendingMode] = useState<SchedulingMode | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasChanges =
    mode !== initialMode || bookableWindowDays !== initialBookableWindowDays;

  function handleModeChange(newMode: SchedulingMode) {
    if (newMode === mode) return;
    // Show confirmation dialog when switching modes
    setPendingMode(newMode);
    setShowConfirm(true);
  }

  function confirmModeChange() {
    if (pendingMode) {
      setMode(pendingMode);
    }
    setShowConfirm(false);
    setPendingMode(null);
    setSaved(false);
  }

  function cancelModeChange() {
    setShowConfirm(false);
    setPendingMode(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch("/api/admin/scheduling-mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduling_type: mode,
          bookable_window_days: bookableWindowDays,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      setSaved(true);
      // Reload to reflect changes across the admin UI (nav links, etc.)
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
      <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
        <div className="flex items-center gap-2">
          <CalendarCog className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          <h2 className="font-semibold text-gray-800 dark:text-white/90">
            Scheduling Mode
          </h2>
        </div>
        <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
          Choose how customers book time at your facility.
        </p>
      </div>
      <div className="p-6 space-y-6">
        {/* Mode Selection */}
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => handleModeChange("slot_based")}
            className={`rounded-xl border-2 p-4 text-left transition-colors ${
              mode === "slot_based"
                ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/20"
                : "border-gray-200 hover:border-gray-300 dark:border-white/10 dark:hover:border-white/20"
            }`}
          >
            <div className="text-sm font-semibold text-gray-800 dark:text-white/90">
              Slot-Based
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Create pre-defined time slots using templates. Customers see fixed
              available/unavailable slots and book them directly.
            </p>
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("dynamic")}
            className={`rounded-xl border-2 p-4 text-left transition-colors ${
              mode === "dynamic"
                ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/20"
                : "border-gray-200 hover:border-gray-300 dark:border-white/10 dark:hover:border-white/20"
            }`}
          >
            <div className="text-sm font-semibold text-gray-800 dark:text-white/90">
              Dynamic
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Define operating hours, durations, and buffers per facility.
              Available times are calculated on the fly based on existing
              bookings.
            </p>
          </button>
        </div>

        {/* Bookable Window (shown for dynamic mode) */}
        {mode === "dynamic" && (
          <div className="border-t border-gray-200 pt-6 dark:border-white/[0.05]">
            <div className="max-w-xs space-y-1.5">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Bookable Window (days)
              </label>
              <input
                type="number"
                min="1"
                max="365"
                value={bookableWindowDays}
                onChange={(e) =>
                  setBookableWindowDays(parseInt(e.target.value) || 30)
                }
                className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              />
              <p className="text-xs text-gray-400 dark:text-gray-500">
                How many days into the future customers can book. Default is 30.
              </p>
            </div>
          </div>
        )}

        {/* Save Button */}
        {hasChanges && (
          <div className="flex items-center gap-3 border-t border-gray-200 pt-6 dark:border-white/[0.05]">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Scheduling Mode"}
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

      {/* Confirmation Dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-800 dark:text-white/90">
                  Switch Scheduling Mode?
                </h3>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  {pendingMode === "dynamic"
                    ? "Switching to Dynamic Scheduling will hide your existing templates and published schedules from customers. They won't be deleted — if you switch back, they'll still be there."
                    : "Switching to Slot-Based Scheduling will stop using dynamic rules for availability. Your dynamic schedule rules will be preserved if you switch back."}
                </p>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  All existing bookings remain valid regardless of which mode
                  you use.
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={cancelModeChange}
                className="h-9 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmModeChange}
                className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
              >
                Switch Mode
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
