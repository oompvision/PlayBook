"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Calendar,
  Clock,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

type Bay = {
  id: string;
  name: string;
  resource_type: string | null;
};

type BlockOut = {
  id: string;
  bay_id: string;
  org_id: string;
  date: string;
  start_time: string;
  end_time: string;
  reason: string | null;
  created_at: string;
};

type NewBlockOut = {
  bay_ids: string[];
  date: string;
  start_time: string;
  end_time: string;
  reason: string;
};

function formatTime(timestamp: string, timezone: string) {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toTimestamp(dateStr: string, timeStr: string, timezone: string): string {
  // Build a timezone-aware ISO timestamp
  const naive = new Date(`${dateStr}T${timeStr}:00`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });

  const getParts = (tz: string) => {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const parts = f.formatToParts(naive);
    const get = (type: string) =>
      parseInt(parts.find((p) => p.type === type)?.value || "0", 10);
    return {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: get("hour") === 24 ? 0 : get("hour"),
      minute: get("minute"),
    };
  };

  const utcParts = getParts("UTC");
  const tzParts = getParts(timezone);

  const utcDate = new Date(
    Date.UTC(utcParts.year, utcParts.month - 1, utcParts.day, utcParts.hour, utcParts.minute)
  );
  const tzAsUtc = new Date(
    Date.UTC(tzParts.year, tzParts.month - 1, tzParts.day, tzParts.hour, tzParts.minute)
  );

  const offsetMs = tzAsUtc.getTime() - utcDate.getTime();
  const offsetMinutes = offsetMs / 60000;
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absMinutes / 60)).padStart(2, "0");
  const offsetMins = String(absMinutes % 60).padStart(2, "0");

  return `${dateStr}T${timeStr}:00${sign}${offsetHours}:${offsetMins}`;
}

export function BlockOutsEditor({
  orgId,
  locationId,
  timezone,
  bays,
  existingBlockOuts,
}: {
  orgId: string;
  locationId: string | null;
  timezone: string;
  bays: Bay[];
  existingBlockOuts: BlockOut[];
}) {
  const router = useRouter();
  const [blockOuts, setBlockOuts] = useState<BlockOut[]>(existingBlockOuts);
  const [showForm, setShowForm] = useState(false);
  const [newBlockOut, setNewBlockOut] = useState<NewBlockOut>({
    bay_ids: [],
    date: new Date().toISOString().split("T")[0],
    start_time: "09:00",
    end_time: "17:00",
    reason: "",
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Group block-outs by date
  const groupedBlockOuts = useMemo(() => {
    const groups = new Map<string, BlockOut[]>();
    for (const bo of blockOuts) {
      const list = groups.get(bo.date) || [];
      list.push(bo);
      groups.set(bo.date, list);
    }
    // Sort dates descending (most recent first)
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [blockOuts]);

  function getBayName(bayId: string): string {
    return bays.find((b) => b.id === bayId)?.name || "Unknown";
  }

  function toggleBay(bayId: string) {
    setNewBlockOut((prev) => ({
      ...prev,
      bay_ids: prev.bay_ids.includes(bayId)
        ? prev.bay_ids.filter((id) => id !== bayId)
        : [...prev.bay_ids, bayId],
    }));
  }

  function selectAllBays() {
    setNewBlockOut((prev) => ({
      ...prev,
      bay_ids: bays.map((b) => b.id),
    }));
  }

  async function handleCreate() {
    if (newBlockOut.bay_ids.length === 0) {
      setError("Select at least one facility");
      return;
    }
    if (newBlockOut.start_time >= newBlockOut.end_time) {
      setError("End time must be after start time");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const supabase = createClient();

      const rows = newBlockOut.bay_ids.map((bayId) => ({
        bay_id: bayId,
        org_id: orgId,
        ...(locationId ? { location_id: locationId } : {}),
        date: newBlockOut.date,
        start_time: toTimestamp(newBlockOut.date, newBlockOut.start_time, timezone),
        end_time: toTimestamp(newBlockOut.date, newBlockOut.end_time, timezone),
        reason: newBlockOut.reason || null,
      }));

      const { data, error: insertError } = await supabase
        .from("schedule_block_outs")
        .insert(rows)
        .select();

      if (insertError) throw insertError;

      if (data) {
        setBlockOuts((prev) => [...prev, ...data]);
      }

      setShowForm(false);
      setNewBlockOut({
        bay_ids: [],
        date: new Date().toISOString().split("T")[0],
        start_time: "09:00",
        end_time: "17:00",
        reason: "",
      });
      setSuccess(`Block-out created for ${newBlockOut.bay_ids.length} facilit${newBlockOut.bay_ids.length === 1 ? "y" : "ies"}`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "Failed to create block-out");
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
        .from("schedule_block_outs")
        .delete()
        .eq("id", id);

      if (deleteError) throw deleteError;

      setBlockOuts((prev) => prev.filter((bo) => bo.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "Failed to delete block-out");
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

      {/* Create new block-out */}
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-600 transition-colors hover:border-blue-400 hover:bg-blue-50/50 hover:text-blue-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-400 dark:hover:border-blue-500 dark:hover:text-blue-400"
        >
          <Plus className="h-4 w-4" />
          Create Block-Out
        </button>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
          <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
            <h2 className="font-semibold text-gray-800 dark:text-white/90">
              New Block-Out
            </h2>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              Block a time range to prevent customer bookings
            </p>
          </div>

          <div className="space-y-4 px-6 py-4">
            {/* Facility selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Facilities
                </label>
                <button
                  type="button"
                  onClick={selectAllBays}
                  className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  Select all
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {bays.map((bay) => {
                  const isSelected = newBlockOut.bay_ids.includes(bay.id);
                  return (
                    <button
                      key={bay.id}
                      type="button"
                      onClick={() => toggleBay(bay.id)}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        isSelected
                          ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/20 dark:text-blue-400"
                          : "border-gray-200 text-gray-600 hover:border-gray-300 dark:border-white/10 dark:text-gray-400 dark:hover:border-white/20"
                      }`}
                    >
                      {bay.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date + Time */}
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Date
                </label>
                <input
                  type="date"
                  value={newBlockOut.date}
                  onChange={(e) =>
                    setNewBlockOut((prev) => ({ ...prev, date: e.target.value }))
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
                  value={newBlockOut.start_time}
                  onChange={(e) =>
                    setNewBlockOut((prev) => ({
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
                  value={newBlockOut.end_time}
                  onChange={(e) =>
                    setNewBlockOut((prev) => ({
                      ...prev,
                      end_time: e.target.value,
                    }))
                  }
                  className="h-9 rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                />
              </div>
            </div>

            {/* Reason */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Reason (optional)
              </label>
              <input
                type="text"
                value={newBlockOut.reason}
                onChange={(e) =>
                  setNewBlockOut((prev) => ({ ...prev, reason: e.target.value }))
                }
                placeholder="e.g. Holiday, Maintenance, Private event..."
                className="h-9 w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-gray-500"
              />
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
              {saving ? "Creating..." : "Create Block-Out"}
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

      {/* Existing block-outs */}
      {groupedBlockOuts.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-16 text-center dark:border-white/[0.05] dark:bg-white/[0.03]">
          <Calendar className="mx-auto h-8 w-8 text-gray-400" />
          <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">
            No block-outs configured
          </p>
          <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
            Block-outs prevent customers from booking during specific time
            ranges.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedBlockOuts.map(([date, items]) => (
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
                {items.map((bo) => (
                  <div
                    key={bo.id}
                    className="flex items-center justify-between px-6 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <Clock className="h-4 w-4 text-gray-400" />
                      <div>
                        <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                          {getBayName(bo.bay_id)}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {formatTime(bo.start_time, timezone)} &ndash;{" "}
                          {formatTime(bo.end_time, timezone)}
                          {bo.reason && (
                            <span className="ml-2 text-gray-400 dark:text-gray-500">
                              &middot; {bo.reason}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(bo.id)}
                      disabled={deleting === bo.id}
                      className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                    >
                      {deleting === bo.id ? (
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
