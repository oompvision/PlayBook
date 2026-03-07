"use client";

import { useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Clock,
  Save,
  Copy,
  CheckCircle2,
  Plus,
  X,
  Loader2,
  DollarSign,
  Trash2,
} from "lucide-react";

const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday", short: "Sun" },
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
];

const GRANULARITY_OPTIONS = [
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "60 min" },
];

const COMMON_DURATIONS = [30, 60, 90, 120, 150, 180];

type Bay = {
  id: string;
  name: string;
  resource_type: string | null;
  hourly_rate_cents: number;
};

type RateTier = {
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

type DbRule = Rule & {
  id: string;
  org_id: string;
  created_at: string;
  updated_at: string;
};

export function DynamicRulesEditor({
  orgId,
  locationId,
  bays,
  existingRules,
}: {
  orgId: string;
  locationId: string | null;
  bays: Bay[];
  existingRules: DbRule[];
}) {
  const [selectedBayId, setSelectedBayId] = useState(bays[0]?.id || "");
  const [rules, setRules] = useState<Map<string, Rule>>(() => {
    const map = new Map<string, Rule>();
    for (const r of existingRules) {
      map.set(`${r.bay_id}:${r.day_of_week}`, r);
    }
    return map;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedBay = bays.find((b) => b.id === selectedBayId);
  const bayRules = DAYS_OF_WEEK.map((day) => ({
    day,
    rule: rules.get(`${selectedBayId}:${day.value}`) || null,
  }));

  const enabledDays = bayRules.filter((r) => r.rule !== null);

  function getDefaultRule(bayId: string, dayOfWeek: number): Rule {
    // Try to copy from the first enabled day for this bay
    for (const [key, r] of rules.entries()) {
      if (key.startsWith(`${bayId}:`)) {
        return {
          bay_id: bayId,
          day_of_week: dayOfWeek,
          open_time: r.open_time,
          close_time: r.close_time,
          available_durations: [...r.available_durations],
          buffer_minutes: r.buffer_minutes,
          start_time_granularity: r.start_time_granularity,
          rate_tiers: r.rate_tiers ? r.rate_tiers.map((t) => ({ ...t })) : null,
        };
      }
    }
    return {
      bay_id: bayId,
      day_of_week: dayOfWeek,
      open_time: "09:00",
      close_time: "21:00",
      available_durations: [60],
      buffer_minutes: 0,
      start_time_granularity: 30,
    };
  }

  function toggleDay(dayOfWeek: number) {
    const key = `${selectedBayId}:${dayOfWeek}`;
    const newRules = new Map(rules);
    if (newRules.has(key)) {
      newRules.delete(key);
    } else {
      newRules.set(key, getDefaultRule(selectedBayId, dayOfWeek));
    }
    setRules(newRules);
    setSaved(false);
  }

  function updateRule(dayOfWeek: number, updates: Partial<Rule>) {
    const key = `${selectedBayId}:${dayOfWeek}`;
    const existing = rules.get(key);
    if (!existing) return;
    const newRules = new Map(rules);
    newRules.set(key, { ...existing, ...updates });
    setRules(newRules);
    setSaved(false);
  }

  function addRateTier(dayOfWeek: number) {
    const key = `${selectedBayId}:${dayOfWeek}`;
    const existing = rules.get(key);
    if (!existing) return;
    const tiers = existing.rate_tiers || [];
    const lastEnd = tiers.length > 0 ? tiers[tiers.length - 1].end_time : existing.open_time;
    const newTier: RateTier = {
      start_time: lastEnd,
      end_time: existing.close_time,
      hourly_rate_cents: selectedBay?.hourly_rate_cents || 0,
    };
    updateRule(dayOfWeek, { rate_tiers: [...tiers, newTier] });
  }

  function updateRateTier(dayOfWeek: number, index: number, updates: Partial<RateTier>) {
    const key = `${selectedBayId}:${dayOfWeek}`;
    const existing = rules.get(key);
    if (!existing || !existing.rate_tiers) return;
    const tiers = existing.rate_tiers.map((t, i) =>
      i === index ? { ...t, ...updates } : t
    );
    updateRule(dayOfWeek, { rate_tiers: tiers });
  }

  function removeRateTier(dayOfWeek: number, index: number) {
    const key = `${selectedBayId}:${dayOfWeek}`;
    const existing = rules.get(key);
    if (!existing || !existing.rate_tiers) return;
    const tiers = existing.rate_tiers.filter((_, i) => i !== index);
    updateRule(dayOfWeek, { rate_tiers: tiers.length > 0 ? tiers : null });
  }

  function toggleDuration(dayOfWeek: number, duration: number) {
    const key = `${selectedBayId}:${dayOfWeek}`;
    const existing = rules.get(key);
    if (!existing) return;
    const durations = existing.available_durations.includes(duration)
      ? existing.available_durations.filter((d) => d !== duration)
      : [...existing.available_durations, duration].sort((a, b) => a - b);
    if (durations.length === 0) return; // Must have at least one
    updateRule(dayOfWeek, { available_durations: durations });
  }

  function copyToAllDays() {
    // Find first enabled day for this bay
    const firstEnabled = bayRules.find((r) => r.rule !== null);
    if (!firstEnabled || !firstEnabled.rule) return;

    const newRules = new Map(rules);
    for (const day of DAYS_OF_WEEK) {
      const key = `${selectedBayId}:${day.value}`;
      newRules.set(key, {
        ...firstEnabled.rule,
        day_of_week: day.value,
        available_durations: [...firstEnabled.rule.available_durations],
        rate_tiers: firstEnabled.rule.rate_tiers
          ? firstEnabled.rule.rate_tiers.map((t) => ({ ...t }))
          : null,
      });
    }
    setRules(newRules);
    setSaved(false);
  }

  const copyFromBay = useCallback(
    (sourceBayId: string) => {
      const newRules = new Map(rules);
      // Remove existing rules for target bay
      for (const day of DAYS_OF_WEEK) {
        newRules.delete(`${selectedBayId}:${day.value}`);
      }
      // Copy from source bay
      for (const day of DAYS_OF_WEEK) {
        const sourceRule = rules.get(`${sourceBayId}:${day.value}`);
        if (sourceRule) {
          newRules.set(`${selectedBayId}:${day.value}`, {
            ...sourceRule,
            bay_id: selectedBayId,
            id: undefined,
            available_durations: [...sourceRule.available_durations],
            rate_tiers: sourceRule.rate_tiers
              ? sourceRule.rate_tiers.map((t) => ({ ...t }))
              : null,
          });
        }
      }
      setRules(newRules);
      setSaved(false);
    },
    [rules, selectedBayId]
  );

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const supabase = createClient();

      // Get all rules for this bay
      const bayRuleEntries: Rule[] = [];
      for (const [key, rule] of rules.entries()) {
        if (key.startsWith(`${selectedBayId}:`)) {
          bayRuleEntries.push(rule);
        }
      }

      // Delete existing rules for this bay
      const { error: deleteError } = await supabase
        .from("dynamic_schedule_rules")
        .delete()
        .eq("bay_id", selectedBayId)
        .eq("org_id", orgId);

      if (deleteError) throw deleteError;

      // Insert new rules
      if (bayRuleEntries.length > 0) {
        const rows = bayRuleEntries.map((r) => ({
          bay_id: selectedBayId,
          org_id: orgId,
          ...(locationId ? { location_id: locationId } : {}),
          day_of_week: r.day_of_week,
          open_time: r.open_time,
          close_time: r.close_time,
          available_durations: r.available_durations,
          buffer_minutes: r.buffer_minutes,
          start_time_granularity: r.start_time_granularity,
          rate_tiers: r.rate_tiers && r.rate_tiers.length > 0 ? r.rate_tiers : null,
        }));

        const { error: insertError } = await supabase
          .from("dynamic_schedule_rules")
          .insert(rows);

        if (insertError) throw insertError;
      }

      setSaved(true);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Failed to save rules";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  // Other bays that have rules configured (for "copy from" feature)
  const otherBaysWithRules = bays.filter((b) => {
    if (b.id === selectedBayId) return false;
    return Array.from(rules.keys()).some((k) => k.startsWith(`${b.id}:`));
  });

  return (
    <div className="space-y-6">
      {/* Bay Selector */}
      <div className="flex flex-wrap gap-2">
        {bays.map((bay) => {
          const hasRules = Array.from(rules.keys()).some((k) =>
            k.startsWith(`${bay.id}:`)
          );
          return (
            <button
              key={bay.id}
              onClick={() => {
                setSelectedBayId(bay.id);
                setSaved(false);
                setError(null);
              }}
              className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                bay.id === selectedBayId
                  ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/20 dark:text-blue-400"
                  : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:border-white/20"
              }`}
            >
              {bay.name}
              {hasRules && (
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              )}
            </button>
          );
        })}
      </div>

      {selectedBay && (
        <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
          {/* Header */}
          <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  <h2 className="font-semibold text-gray-800 dark:text-white/90">
                    {selectedBay.name}
                  </h2>
                  {selectedBay.resource_type && (
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      {selectedBay.resource_type}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                  ${(selectedBay.hourly_rate_cents / 100).toFixed(2)}/hr
                  &middot; {enabledDays.length} day
                  {enabledDays.length !== 1 ? "s" : ""} configured
                </p>
              </div>
              <div className="flex items-center gap-2">
                {enabledDays.length > 0 && (
                  <button
                    type="button"
                    onClick={copyToAllDays}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy to all days
                  </button>
                )}
                {otherBaysWithRules.length > 0 && (
                  <select
                    onChange={(e) => {
                      if (e.target.value) copyFromBay(e.target.value);
                      e.target.value = "";
                    }}
                    defaultValue=""
                    className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                  >
                    <option value="" disabled>
                      Copy from...
                    </option>
                    {otherBaysWithRules.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>

          {/* Day Rules */}
          <div className="divide-y divide-gray-100 dark:divide-white/[0.05]">
            {DAYS_OF_WEEK.map((day) => {
              const rule = rules.get(`${selectedBayId}:${day.value}`);
              const isEnabled = !!rule;

              return (
                <div key={day.value} className="px-6 py-4">
                  <div className="flex items-start gap-4">
                    {/* Day toggle */}
                    <button
                      type="button"
                      onClick={() => toggleDay(day.value)}
                      className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                        isEnabled ? "bg-blue-600" : "bg-gray-200 dark:bg-gray-700"
                      }`}
                    >
                      <span
                        className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                          isEnabled ? "translate-x-5.5" : "translate-x-0.5"
                        }`}
                      />
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm font-semibold ${
                            isEnabled
                              ? "text-gray-800 dark:text-white/90"
                              : "text-gray-400 dark:text-gray-500"
                          }`}
                        >
                          {day.label}
                        </span>
                        {!isEnabled && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            Closed
                          </span>
                        )}
                      </div>

                      {isEnabled && rule && (
                        <div className="mt-3 space-y-4">
                          {/* Operating Hours */}
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                Open
                              </label>
                              <input
                                type="time"
                                value={rule.open_time}
                                onChange={(e) =>
                                  updateRule(day.value, {
                                    open_time: e.target.value,
                                  })
                                }
                                className="h-9 rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                Close
                              </label>
                              <input
                                type="time"
                                value={rule.close_time}
                                onChange={(e) =>
                                  updateRule(day.value, {
                                    close_time: e.target.value,
                                  })
                                }
                                className="h-9 rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                Buffer (min)
                              </label>
                              <input
                                type="number"
                                min="0"
                                max="60"
                                step="5"
                                value={rule.buffer_minutes}
                                onChange={(e) =>
                                  updateRule(day.value, {
                                    buffer_minutes:
                                      parseInt(e.target.value) || 0,
                                  })
                                }
                                className="h-9 w-20 rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                Granularity
                              </label>
                              <select
                                value={rule.start_time_granularity}
                                onChange={(e) =>
                                  updateRule(day.value, {
                                    start_time_granularity: parseInt(
                                      e.target.value
                                    ),
                                  })
                                }
                                className="h-9 rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                              >
                                {GRANULARITY_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* Durations */}
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                              Available Durations
                            </label>
                            <div className="flex flex-wrap gap-2">
                              {COMMON_DURATIONS.map((dur) => {
                                const isSelected =
                                  rule.available_durations.includes(dur);
                                const label =
                                  dur < 60
                                    ? `${dur}m`
                                    : dur % 60 === 0
                                    ? `${dur / 60}h`
                                    : `${Math.floor(dur / 60)}h ${dur % 60}m`;
                                return (
                                  <button
                                    key={dur}
                                    type="button"
                                    onClick={() =>
                                      toggleDuration(day.value, dur)
                                    }
                                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                                      isSelected
                                        ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/20 dark:text-blue-400"
                                        : "border-gray-200 text-gray-500 hover:border-gray-300 dark:border-white/10 dark:text-gray-400 dark:hover:border-white/20"
                                    }`}
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Rate Tiers */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                <DollarSign className="mr-1 inline h-3 w-3" />
                                Rate Tiers{" "}
                                <span className="font-normal text-gray-400 dark:text-gray-500">
                                  (optional — overrides bay default rate)
                                </span>
                              </label>
                              <button
                                type="button"
                                onClick={() => addRateTier(day.value)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                              >
                                <Plus className="h-3 w-3" />
                                Add tier
                              </button>
                            </div>

                            {rule.rate_tiers && rule.rate_tiers.length > 0 ? (
                              <div className="space-y-2">
                                {rule.rate_tiers.map((tier, idx) => (
                                  <div
                                    key={idx}
                                    className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2 dark:border-white/[0.05] dark:bg-white/[0.02]"
                                  >
                                    <input
                                      type="time"
                                      value={tier.start_time}
                                      onChange={(e) =>
                                        updateRateTier(day.value, idx, {
                                          start_time: e.target.value,
                                        })
                                      }
                                      className="h-7 rounded border border-gray-300 bg-white px-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                                    />
                                    <span className="text-xs text-gray-400">
                                      to
                                    </span>
                                    <input
                                      type="time"
                                      value={tier.end_time}
                                      onChange={(e) =>
                                        updateRateTier(day.value, idx, {
                                          end_time: e.target.value,
                                        })
                                      }
                                      className="h-7 rounded border border-gray-300 bg-white px-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                                    />
                                    <span className="text-xs text-gray-400">
                                      @
                                    </span>
                                    <div className="relative">
                                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                                        $
                                      </span>
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={(
                                          tier.hourly_rate_cents / 100
                                        ).toFixed(2)}
                                        onChange={(e) =>
                                          updateRateTier(day.value, idx, {
                                            hourly_rate_cents: Math.round(
                                              parseFloat(e.target.value || "0") *
                                                100
                                            ),
                                          })
                                        }
                                        className="h-7 w-24 rounded border border-gray-300 bg-white pl-5 pr-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                                      />
                                    </div>
                                    <span className="text-xs text-gray-400">
                                      /hr
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        removeRateTier(day.value, idx)
                                      }
                                      className="ml-auto rounded p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-gray-400 dark:text-gray-500">
                                Using bay default: $
                                {(
                                  (selectedBay?.hourly_rate_cents || 0) / 100
                                ).toFixed(2)}
                                /hr for all times
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Save Footer */}
          <div className="flex items-center gap-3 border-t border-gray-200 px-6 py-4 dark:border-white/[0.05]">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? "Saving..." : `Save ${selectedBay.name} Rules`}
            </button>
            {saved && (
              <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                Rules saved
              </span>
            )}
            {error && (
              <span className="text-sm text-red-600 dark:text-red-400">
                {error}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
