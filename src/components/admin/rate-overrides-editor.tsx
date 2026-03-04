"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Plus,
  Trash2,
  DollarSign,
  Calendar,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

type Bay = {
  id: string;
  name: string;
  resource_type: string | null;
  hourly_rate_cents: number;
};

type RateOverride = {
  id: string;
  bay_id: string;
  org_id: string;
  date: string;
  start_time: string; // time "HH:MM:SS"
  end_time: string;
  hourly_rate_cents: number;
  reason: string | null;
  created_at: string;
};

type NewOverride = {
  bay_id: string;
  date: string;
  start_time: string;
  end_time: string;
  hourly_rate_dollars: string;
  reason: string;
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimeStr(time: string): string {
  // Convert "HH:MM" or "HH:MM:SS" to display format
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

export function RateOverridesEditor({
  orgId,
  timezone,
  bays,
  existingOverrides,
}: {
  orgId: string;
  timezone: string;
  bays: Bay[];
  existingOverrides: RateOverride[];
}) {
  const [overrides, setOverrides] = useState<RateOverride[]>(existingOverrides);
  const [showForm, setShowForm] = useState(false);
  const [newOverride, setNewOverride] = useState<NewOverride>({
    bay_id: bays[0]?.id || "",
    date: new Date().toISOString().split("T")[0],
    start_time: "09:00",
    end_time: "21:00",
    hourly_rate_dollars: "",
    reason: "",
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Group overrides by date
  const groupedOverrides = useMemo(() => {
    const groups = new Map<string, RateOverride[]>();
    for (const o of overrides) {
      const list = groups.get(o.date) || [];
      list.push(o);
      groups.set(o.date, list);
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [overrides]);

  function getBayName(bayId: string): string {
    return bays.find((b) => b.id === bayId)?.name || "Unknown";
  }

  function getBayDefaultRate(bayId: string): number {
    return bays.find((b) => b.id === bayId)?.hourly_rate_cents || 0;
  }

  async function handleCreate() {
    const rateCents = Math.round(parseFloat(newOverride.hourly_rate_dollars) * 100);
    if (!newOverride.bay_id) {
      setError("Select a facility");
      return;
    }
    if (isNaN(rateCents) || rateCents < 0) {
      setError("Enter a valid hourly rate");
      return;
    }
    if (newOverride.start_time >= newOverride.end_time) {
      setError("End time must be after start time");
      return;
    }

    // Check for overlapping overrides on the same bay + date
    const overlapping = overrides.find(
      (o) =>
        o.bay_id === newOverride.bay_id &&
        o.date === newOverride.date &&
        newOverride.start_time < o.end_time &&
        newOverride.end_time > o.start_time
    );
    if (overlapping) {
      setError(
        `Overlaps with existing override for ${getBayName(overlapping.bay_id)} on ${formatDate(overlapping.date)} (${formatTimeStr(overlapping.start_time)} – ${formatTimeStr(overlapping.end_time)})`
      );
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const supabase = createClient();

      const { data, error: insertError } = await supabase
        .from("dynamic_rate_overrides")
        .insert({
          bay_id: newOverride.bay_id,
          org_id: orgId,
          date: newOverride.date,
          start_time: newOverride.start_time,
          end_time: newOverride.end_time,
          hourly_rate_cents: rateCents,
          reason: newOverride.reason || null,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      if (data) {
        setOverrides((prev) => [...prev, data]);
      }

      setShowForm(false);
      setNewOverride({
        bay_id: bays[0]?.id || "",
        date: new Date().toISOString().split("T")[0],
        start_time: "09:00",
        end_time: "21:00",
        hourly_rate_dollars: "",
        reason: "",
      });
      setSuccess("Rate override created");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create rate override");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    setError(null);

    try {
      const supabase = createClient();
      const { error: deleteError } = await supabase
        .from("dynamic_rate_overrides")
        .delete()
        .eq("id", id);

      if (deleteError) throw deleteError;

      setOverrides((prev) => prev.filter((o) => o.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete override");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Status messages */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {success}
        </div>
      )}

      {/* Create new override */}
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-600 transition-colors hover:border-blue-400 hover:bg-blue-50/50 hover:text-blue-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-400 dark:hover:border-blue-500 dark:hover:text-blue-400"
        >
          <Plus className="h-4 w-4" />
          Add Rate Override
        </button>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
            <h2 className="font-semibold text-gray-800 dark:text-white/90">
              New Rate Override
            </h2>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              Set a custom hourly rate for a specific date and time range
            </p>
          </div>

          <div className="space-y-4 px-6 py-4">
            {/* Facility selector */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Facility
              </label>
              <select
                value={newOverride.bay_id}
                onChange={(e) =>
                  setNewOverride((prev) => ({
                    ...prev,
                    bay_id: e.target.value,
                  }))
                }
                className="h-9 w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              >
                {bays.map((bay) => (
                  <option key={bay.id} value={bay.id}>
                    {bay.name} (default: ${(bay.hourly_rate_cents / 100).toFixed(2)}/hr)
                  </option>
                ))}
              </select>
            </div>

            {/* Date + time range */}
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Date
                </label>
                <input
                  type="date"
                  value={newOverride.date}
                  onChange={(e) =>
                    setNewOverride((prev) => ({ ...prev, date: e.target.value }))
                  }
                  className="h-9 rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Start
                </label>
                <input
                  type="time"
                  value={newOverride.start_time}
                  onChange={(e) =>
                    setNewOverride((prev) => ({
                      ...prev,
                      start_time: e.target.value,
                    }))
                  }
                  className="h-9 rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  End
                </label>
                <input
                  type="time"
                  value={newOverride.end_time}
                  onChange={(e) =>
                    setNewOverride((prev) => ({
                      ...prev,
                      end_time: e.target.value,
                    }))
                  }
                  className="h-9 rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                />
              </div>
            </div>

            {/* Rate + reason */}
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Hourly Rate ($)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                    $
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={newOverride.hourly_rate_dollars}
                    onChange={(e) =>
                      setNewOverride((prev) => ({
                        ...prev,
                        hourly_rate_dollars: e.target.value,
                      }))
                    }
                    placeholder="0.00"
                    className="h-9 w-32 rounded-lg border border-gray-300 bg-white pl-7 pr-2.5 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                  />
                </div>
                {newOverride.bay_id && (
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    Default: ${(getBayDefaultRate(newOverride.bay_id) / 100).toFixed(2)}/hr
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Reason (optional)
                </label>
                <input
                  type="text"
                  value={newOverride.reason}
                  onChange={(e) =>
                    setNewOverride((prev) => ({
                      ...prev,
                      reason: e.target.value,
                    }))
                  }
                  placeholder="e.g. Holiday rate, Happy hour..."
                  className="h-9 w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-gray-500"
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 border-t border-gray-200 px-6 py-4 dark:border-white/[0.05]">
            <button
              type="button"
              onClick={handleCreate}
              disabled={saving}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {saving ? "Creating..." : "Add Override"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setError(null);
              }}
              className="h-9 rounded-lg px-4 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Existing overrides */}
      {groupedOverrides.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-16 text-center dark:border-white/[0.05] dark:bg-white/[0.03]">
          <DollarSign className="mx-auto h-8 w-8 text-gray-400" />
          <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">
            No rate overrides configured
          </p>
          <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
            Rate overrides let you set custom pricing for specific dates
            (holidays, events, etc).
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedOverrides.map(([date, items]) => (
            <div
              key={date}
              className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]"
            >
              <div className="border-b border-gray-200 px-6 py-3 dark:border-white/[0.05]">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">
                  {formatDate(date)}
                </h3>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                {items.map((o) => (
                  <div
                    key={o.id}
                    className="flex items-center justify-between px-6 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <DollarSign className="h-4 w-4 text-gray-400" />
                      <div>
                        <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                          {getBayName(o.bay_id)} &mdash;{" "}
                          <span className="text-green-600 dark:text-green-400">
                            ${(o.hourly_rate_cents / 100).toFixed(2)}/hr
                          </span>
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {formatTimeStr(o.start_time)} &ndash;{" "}
                          {formatTimeStr(o.end_time)}
                          {o.reason && (
                            <span className="ml-2 text-gray-400 dark:text-gray-500">
                              &middot; {o.reason}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(o.id)}
                      disabled={deleting === o.id}
                      className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                    >
                      {deleting === o.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
