"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { StickyFooter } from "@/components/admin/sticky-footer";
import { Toast } from "@/components/ui/toast";

type SchedulingMode = "slot_based" | "dynamic";

export function SchedulingModeSettings({
  initialMode,
  initialBookableWindowDays,
}: {
  initialMode: SchedulingMode;
  initialBookableWindowDays: number;
}) {
  const [mode, setMode] = useState<SchedulingMode>(initialMode);
  const [bookableWindowDays] = useState(
    initialBookableWindowDays
  );
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingMode, setPendingMode] = useState<SchedulingMode | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasChanges = mode !== initialMode;

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
    setShowToast(false);
  }

  function cancelModeChange() {
    setShowConfirm(false);
    setPendingMode(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setShowToast(false);

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

      setShowToast(true);
      // Reload to reflect changes across the admin UI (nav links, etc.)
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="space-y-6">
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

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}
      </div>

      <StickyFooter
        isDirty={hasChanges}
        saving={saving}
        onSave={handleSave}
        submitLabel="Save Scheduling Mode"
      />

      {showToast && (
        <Toast
          message="Scheduling mode saved."
          duration={5000}
          onClose={() => setShowToast(false)}
        />
      )}

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
    </>
  );
}
