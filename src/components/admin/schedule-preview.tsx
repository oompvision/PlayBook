"use client";

import { useState, useMemo } from "react";
import { X, Monitor, Smartphone, Clock, Sun, Sunset, Moon } from "lucide-react";
import { formatPrice } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

type RateTier = {
  type?: "rate" | "blockout";
  start_time: string;
  end_time: string;
  hourly_rate_cents: number;
};

type Rule = {
  id?: string;
  bay_id: string;
  day_of_week: number;
  open_time: string;
  close_time: string;
  available_durations: number[];
  buffer_minutes: number;
  start_time_granularity: number;
  rate_tiers?: RateTier[] | null;
};

type PreviewSlot = {
  key: string;
  start_time: string; // "HH:MM" format
  end_time: string;
  price_cents: number;
  is_blockout: boolean;
  duration_minutes: number;
};

type TimePeriod = "morning" | "midday" | "evening";

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatTime12h(time: string): string {
  const mins = timeToMinutes(time);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}:00 ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function getTimePeriod(time: string): TimePeriod {
  const h = Math.floor(timeToMinutes(time) / 60);
  if (h < 12) return "morning";
  if (h < 17) return "midday";
  return "evening";
}

const timePeriodConfig: Record<TimePeriod, { label: string; Icon: typeof Sun }> = {
  morning: { label: "Morning", Icon: Sun },
  midday: { label: "Midday", Icon: Sunset },
  evening: { label: "Evening", Icon: Moon },
};

// ─── Generate Preview Slots ─────────────────────────────────────────────────

function generatePreviewSlots(
  rule: Rule,
  bayName: string,
  defaultRateCents: number
): PreviewSlot[] {
  const openMins = timeToMinutes(rule.open_time);
  const closeMins = timeToMinutes(rule.close_time);
  const granularity = rule.start_time_granularity;
  const durations = rule.available_durations;
  const buffer = rule.buffer_minutes;
  const tiers = rule.rate_tiers || [];

  // For each possible start time, generate slots for each available duration
  const slots: PreviewSlot[] = [];

  // Use the shortest duration for slot generation to show the finest grain
  const primaryDuration = durations.length > 0 ? Math.min(...durations) : 60;

  for (let startMins = openMins; startMins + primaryDuration <= closeMins; startMins += granularity) {
    const endMins = startMins + primaryDuration;
    const startTime = minutesToTime(startMins);
    const endTime = minutesToTime(endMins);

    // Check if this slot falls entirely within a blockout
    const inBlockout = tiers.some(
      (t) =>
        t.type === "blockout" &&
        timeToMinutes(t.start_time) <= startMins &&
        timeToMinutes(t.end_time) >= endMins
    );

    if (inBlockout) continue; // Skip blocked-out slots

    // Check if slot partially overlaps a blockout — also skip
    const partialBlockout = tiers.some(
      (t) =>
        t.type === "blockout" &&
        timeToMinutes(t.start_time) < endMins &&
        timeToMinutes(t.end_time) > startMins
    );

    if (partialBlockout) continue;

    // Determine price: find the rate tier that covers this slot's start time
    let priceCents = defaultRateCents;
    // Calculate price based on which rate tiers the slot spans
    // Use the tier that covers the start time
    for (const tier of tiers) {
      if (
        tier.type !== "blockout" &&
        timeToMinutes(tier.start_time) <= startMins &&
        timeToMinutes(tier.end_time) >= endMins
      ) {
        // Slot is fully within this tier
        priceCents = Math.round((tier.hourly_rate_cents * primaryDuration) / 60);
        break;
      }
    }

    // If no tier fully covers it, use default rate
    if (
      priceCents === defaultRateCents &&
      !tiers.some(
        (t) =>
          t.type !== "blockout" &&
          timeToMinutes(t.start_time) <= startMins &&
          timeToMinutes(t.end_time) >= endMins
      )
    ) {
      priceCents = Math.round((defaultRateCents * primaryDuration) / 60);
    }

    slots.push({
      key: `${startTime}-${endTime}`,
      start_time: startTime,
      end_time: endTime,
      price_cents: priceCents,
      is_blockout: false,
      duration_minutes: primaryDuration,
    });
  }

  return slots;
}

function groupByTimePeriod(slots: PreviewSlot[]): { period: TimePeriod; items: PreviewSlot[] }[] {
  const buckets: Record<TimePeriod, PreviewSlot[]> = {
    morning: [],
    midday: [],
    evening: [],
  };
  for (const slot of slots) {
    buckets[getTimePeriod(slot.start_time)].push(slot);
  }
  const order: TimePeriod[] = ["morning", "midday", "evening"];
  return order.filter((p) => buckets[p].length > 0).map((p) => ({ period: p, items: buckets[p] }));
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SchedulePreview({
  rule,
  bayName,
  defaultRateCents,
  dayLabel,
  onClose,
}: {
  rule: Rule;
  bayName: string;
  defaultRateCents: number;
  dayLabel: string;
  onClose: () => void;
}) {
  const [deviceMode, setDeviceMode] = useState<"desktop" | "mobile">("desktop");

  const slots = useMemo(
    () => generatePreviewSlots(rule, bayName, defaultRateCents),
    [rule, bayName, defaultRateCents]
  );

  const grouped = useMemo(() => groupByTimePeriod(slots), [slots]);

  const isMobile = deviceMode === "mobile";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      {/* Modal container */}
      <div
        className={`relative flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-950 ${
          isMobile ? "h-[700px] w-[390px]" : "h-[85vh] w-full max-w-3xl"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-white/10">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Schedule Preview
            </h2>
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/10 dark:text-gray-400">
              {bayName}
            </span>
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
              {dayLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Device toggle */}
            <div className="flex rounded-lg border border-gray-200 p-0.5 dark:border-white/10">
              <button
                type="button"
                onClick={() => setDeviceMode("desktop")}
                className={`rounded-md px-2 py-1 transition-colors ${
                  deviceMode === "desktop"
                    ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                    : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
                title="Desktop view"
              >
                <Monitor className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setDeviceMode("mobile")}
                className={`rounded-md px-2 py-1 transition-colors ${
                  deviceMode === "mobile"
                    ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                    : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
                title="Mobile view"
              >
                <Smartphone className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Preview content */}
        <div className="flex-1 overflow-y-auto">
          {/* Info banner */}
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 dark:border-amber-900/30 dark:bg-amber-950/20">
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Preview of how customers will see available time slots. Based on your current (unsaved) rules.
            </p>
          </div>

          {/* Slot list */}
          <div className="p-5">
            {slots.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Clock className="mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                  No available slots
                </p>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  This day has no bookable time slots based on the current rules.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {grouped.map(({ period, items }) => {
                  const { label, Icon } = timePeriodConfig[period];
                  return (
                    <div key={period}>
                      {/* Period header */}
                      <div className="mb-2 flex items-center gap-2">
                        <Icon className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                          {label}
                        </span>
                        <div className="h-px flex-1 bg-gray-100 dark:bg-white/5" />
                      </div>

                      {/* Slot cards */}
                      <div className="space-y-1.5">
                        {items.map((slot) => (
                          <div
                            key={slot.key}
                            className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-left transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/[0.03]"
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 dark:bg-white/10">
                                <Clock className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                              </div>
                              <div>
                                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                  {formatTime12h(slot.start_time)} &ndash;{" "}
                                  {formatTime12h(slot.end_time)}
                                </p>
                                <div className="mt-0.5 flex flex-wrap gap-1.5">
                                  <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-white/10 dark:text-gray-400">
                                    {bayName}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                                {formatPrice(slot.price_cents)}
                              </span>
                              <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-gray-300/50 transition-colors dark:border-white/20" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-5 py-3 dark:border-white/10">
          <p className="text-center text-xs text-gray-400 dark:text-gray-500">
            {slots.length} available slot{slots.length !== 1 ? "s" : ""} &middot;{" "}
            {bayName} &middot; {dayLabel}
          </p>
        </div>
      </div>
    </div>
  );
}
