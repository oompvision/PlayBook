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
  start_time: string; // "HH:MM" format
  end_time: string;
  price_cents: number;
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

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
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
  defaultRateCents: number,
  duration: number
): PreviewSlot[] {
  const openMins = timeToMinutes(rule.open_time);
  const closeMins = timeToMinutes(rule.close_time);
  const granularity = rule.start_time_granularity;
  const tiers = rule.rate_tiers || [];

  const slots: PreviewSlot[] = [];

  for (let startMins = openMins; startMins + duration <= closeMins; startMins += granularity) {
    const endMins = startMins + duration;
    const startTime = minutesToTime(startMins);
    const endTime = minutesToTime(endMins);

    // Skip if any part overlaps a blockout
    const overlapsBlockout = tiers.some(
      (t) =>
        t.type === "blockout" &&
        timeToMinutes(t.start_time) < endMins &&
        timeToMinutes(t.end_time) > startMins
    );
    if (overlapsBlockout) continue;

    // Determine price: find the rate tier that covers this slot
    let hourlyRate = defaultRateCents;
    for (const tier of tiers) {
      if (
        tier.type !== "blockout" &&
        timeToMinutes(tier.start_time) <= startMins &&
        timeToMinutes(tier.end_time) >= endMins
      ) {
        hourlyRate = tier.hourly_rate_cents;
        break;
      }
    }

    const priceCents = Math.round((hourlyRate * duration) / 60);

    slots.push({
      start_time: startTime,
      end_time: endTime,
      price_cents: priceCents,
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
  hasUnsavedChanges = false,
  onClose,
}: {
  rule: Rule;
  bayName: string;
  defaultRateCents: number;
  dayLabel: string;
  hasUnsavedChanges?: boolean;
  onClose: () => void;
}) {
  const [deviceMode, setDeviceMode] = useState<"desktop" | "mobile">("desktop");
  const durations = rule.available_durations.length > 0 ? rule.available_durations : [60];
  const [selectedDuration, setSelectedDuration] = useState(durations[0]);

  const slots = useMemo(
    () => generatePreviewSlots(rule, defaultRateCents, selectedDuration),
    [rule, defaultRateCents, selectedDuration]
  );

  const grouped = useMemo(() => groupByTimePeriod(slots), [slots]);

  const isMobile = deviceMode === "mobile";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      {/* Modal container */}
      <div
        className={`relative flex flex-col overflow-hidden rounded-2xl bg-background shadow-2xl ${
          isMobile ? "h-[700px] w-[390px]" : "h-[85vh] w-full max-w-3xl"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold">
              Customer Booking Preview
            </h2>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {bayName}
            </span>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              {dayLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Device toggle */}
            <div className="flex rounded-lg border p-0.5">
              <button
                type="button"
                onClick={() => setDeviceMode("desktop")}
                className={`rounded-md px-2 py-1 transition-colors ${
                  deviceMode === "desktop"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
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
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title="Mobile view"
              >
                <Smartphone className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Preview content */}
        <div className="flex-1 overflow-y-auto bg-muted/30">
          {/* Info banner */}
          {hasUnsavedChanges ? (
            <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 dark:border-amber-900/30 dark:bg-amber-950/20">
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Preview includes unsaved changes. Save your rules to apply them.
              </p>
            </div>
          ) : (
            <div className="border-b border-emerald-200 bg-emerald-50 px-5 py-2 dark:border-emerald-900/30 dark:bg-emerald-950/20">
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                Preview of your saved rules. This is how customers see the booking page.
              </p>
            </div>
          )}

          <div className="space-y-3 p-4">
            {/* Duration picker — matches dynamic-availability-widget */}
            <div className="surface-1 rounded-xl bg-card px-4 py-3">
              <p className="mb-2 text-sm font-medium text-foreground">
                Play for {formatDuration(selectedDuration)}
              </p>
              <div className="flex flex-wrap gap-2">
                {durations.map((dur) => (
                  <button
                    key={dur}
                    type="button"
                    onClick={() => setSelectedDuration(dur)}
                    className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                      selectedDuration === dur
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/50 hover:bg-accent"
                    }`}
                  >
                    {formatDuration(dur)}
                  </button>
                ))}
              </div>
            </div>

            {/* Time slots grid — matches dynamic-availability-widget */}
            <div className="surface-1 rounded-xl bg-card px-4 py-3">
              <div className="mb-2.5 flex items-center justify-between">
                <h3 className="text-sm font-medium text-muted-foreground">
                  Select a time
                </h3>
                {slots.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {slots.length} time{slots.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {slots.length === 0 ? (
                <div className="py-12 text-center">
                  <Clock className="mx-auto h-8 w-8 text-muted-foreground/50" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    No availability for this duration
                  </p>
                </div>
              ) : (
                <div className="space-y-5">
                  {grouped.map(({ period, items }) => {
                    const { label, Icon } = timePeriodConfig[period];
                    return (
                      <div key={period}>
                        {/* Period header */}
                        <div className="mb-2 flex items-center gap-2">
                          <Icon className="h-4 w-4 text-primary" />
                          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {label}
                          </span>
                          <div className="h-px flex-1 bg-border" />
                        </div>

                        {/* Time grid */}
                        <div className={`grid gap-2 ${
                          isMobile
                            ? "grid-cols-3"
                            : "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"
                        }`}>
                          {items.map((slot) => (
                            <div
                              key={slot.start_time}
                              className="rounded-[10px] border border-border px-3 py-2.5 text-center transition-colors hover:border-primary/50 hover:bg-accent"
                            >
                              <div className="text-sm font-semibold">
                                {formatTime12h(slot.start_time)}
                              </div>
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                {formatPrice(slot.price_cents)}
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
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-3">
          <p className="text-center text-xs text-muted-foreground">
            {slots.length} available time{slots.length !== 1 ? "s" : ""} &middot;{" "}
            {formatDuration(selectedDuration)} &middot; {bayName} &middot; {dayLabel}
          </p>
        </div>
      </div>
    </div>
  );
}
