"use client";

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Save,
  Copy,
  CheckCircle2,
  Loader2,
  X,
  Plus,
  Trash2,
  ChevronDown,
  Eye,
  GripVertical,
  DollarSign,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

// ─── Constants ──────────────────────────────────────────────────────────────

const DAYS_OF_WEEK = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
  { value: 0, label: "Sunday", short: "Sun" },
];

const GRANULARITY_OPTIONS = [
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "60 min" },
];

const COMMON_DURATIONS = [30, 60, 90, 120, 150, 180];

const SNAP_MINUTES = 15;

// ─── Types ──────────────────────────────────────────────────────────────────

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

function formatTimeShort(time: string): string {
  const mins = timeToMinutes(time);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? "p" : "a";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, "0")}${period}`;
}

function snapToGrid(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

function formatDuration(dur: number): string {
  if (dur < 60) return `${dur}m`;
  if (dur % 60 === 0) return `${dur / 60}h`;
  return `${Math.floor(dur / 60)}h ${dur % 60}m`;
}

// ─── Main Component ─────────────────────────────────────────────────────────

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
  // ── State ───────────────────────────────────────────────────────────────
  const [selectedBayId, setSelectedBayId] = useState(bays[0]?.id || "");
  const [rules, setRules] = useState<Map<string, Rule>>(() => {
    const map = new Map<string, Rule>();
    for (const r of existingRules) {
      map.set(`${r.bay_id}:${r.day_of_week}`, r);
    }
    return map;
  });
  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set());
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingBaySwitch, setPendingBaySwitch] = useState<string | null>(null);
  const [showBayDropdown, setShowBayDropdown] = useState(false);
  const [showCopyDropdown, setShowCopyDropdown] = useState(false);
  // Mobile sidebar
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);

  const selectedBay = bays.find((b) => b.id === selectedBayId);

  // ── Derived: rules for selected bay ──────────────────────────────────
  const bayRulesMap = useMemo(() => {
    const map = new Map<number, Rule>();
    for (const day of DAYS_OF_WEEK) {
      const rule = rules.get(`${selectedBayId}:${day.value}`);
      if (rule) map.set(day.value, rule);
    }
    return map;
  }, [rules, selectedBayId]);

  // ── Derived: timeline range (dynamic) ────────────────────────────────
  const timelineRange = useMemo(() => {
    let minOpen = 9 * 60; // 9AM default
    let maxClose = 21 * 60; // 9PM default
    let hasRules = false;

    for (const rule of bayRulesMap.values()) {
      hasRules = true;
      const open = timeToMinutes(rule.open_time);
      const close = timeToMinutes(rule.close_time);
      if (open < minOpen) minOpen = open;
      if (close > maxClose) maxClose = close;
    }

    // Pad by 1 hour on each side for breathing room, snap to hours
    const rangeStart = Math.max(0, Math.floor((minOpen - 60) / 60) * 60);
    const rangeEnd = Math.min(24 * 60, Math.ceil((maxClose + 60) / 60) * 60);

    return { start: rangeStart, end: rangeEnd, hasRules };
  }, [bayRulesMap]);

  // ── Other bays with rules (for copy) ─────────────────────────────────
  const otherBaysWithRules = bays.filter((b) => {
    if (b.id === selectedBayId) return false;
    return Array.from(rules.keys()).some((k) => k.startsWith(`${b.id}:`));
  });

  // ── Rule helpers ─────────────────────────────────────────────────────
  function getDefaultRule(bayId: string, dayOfWeek: number): Rule {
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

  function updateRule(dayOfWeek: number, updates: Partial<Rule>) {
    const key = `${selectedBayId}:${dayOfWeek}`;
    const existing = rules.get(key);
    if (!existing) return;
    const newRules = new Map(rules);
    newRules.set(key, { ...existing, ...updates });
    setRules(newRules);
    setIsDirty(true);
    setSaved(false);
  }

  function enableDay(dayOfWeek: number) {
    const key = `${selectedBayId}:${dayOfWeek}`;
    if (rules.has(key)) return;
    const newRules = new Map(rules);
    newRules.set(key, getDefaultRule(selectedBayId, dayOfWeek));
    setRules(newRules);
    setIsDirty(true);
    setSaved(false);
  }

  function disableDay(dayOfWeek: number) {
    const key = `${selectedBayId}:${dayOfWeek}`;
    if (!rules.has(key)) return;
    const newRules = new Map(rules);
    newRules.delete(key);
    setRules(newRules);
    setIsDirty(true);
    setSaved(false);
    setSelectedDays((prev) => {
      const next = new Set(prev);
      next.delete(dayOfWeek);
      return next;
    });
  }

  // ── Day selection ────────────────────────────────────────────────────
  function handleDayClick(dayOfWeek: number, shiftKey: boolean) {
    const rule = bayRulesMap.get(dayOfWeek);
    if (!rule) {
      // Clicking a closed day enables it and selects it
      enableDay(dayOfWeek);
      setSelectedDays(new Set([dayOfWeek]));
      return;
    }
    if (shiftKey) {
      setSelectedDays((prev) => {
        const next = new Set(prev);
        if (next.has(dayOfWeek)) {
          next.delete(dayOfWeek);
        } else {
          next.add(dayOfWeek);
        }
        return next;
      });
    } else {
      setSelectedDays(new Set([dayOfWeek]));
    }
  }

  // ── Copy from bay ────────────────────────────────────────────────────
  const copyFromBay = useCallback(
    (sourceBayId: string) => {
      const newRules = new Map(rules);
      for (const day of DAYS_OF_WEEK) {
        newRules.delete(`${selectedBayId}:${day.value}`);
      }
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
      setIsDirty(true);
      setSaved(false);
      setShowCopyDropdown(false);
    },
    [rules, selectedBayId]
  );

  // ── Bay switch with unsaved warning ──────────────────────────────────
  function handleBaySwitch(bayId: string) {
    if (bayId === selectedBayId) {
      setShowBayDropdown(false);
      return;
    }
    if (isDirty) {
      setPendingBaySwitch(bayId);
      setShowUnsavedDialog(true);
      setShowBayDropdown(false);
    } else {
      setSelectedBayId(bayId);
      setSelectedDays(new Set());
      setSaved(false);
      setError(null);
      setShowBayDropdown(false);
    }
  }

  function confirmBaySwitch() {
    if (pendingBaySwitch) {
      setSelectedBayId(pendingBaySwitch);
      setSelectedDays(new Set());
      setIsDirty(false);
      setSaved(false);
      setError(null);
    }
    setShowUnsavedDialog(false);
    setPendingBaySwitch(null);
  }

  // ── Save to database ─────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const supabase = createClient();
      const bayRuleEntries: Rule[] = [];
      for (const [key, rule] of rules.entries()) {
        if (key.startsWith(`${selectedBayId}:`)) {
          bayRuleEntries.push(rule);
        }
      }

      const { error: deleteError } = await supabase
        .from("dynamic_schedule_rules")
        .delete()
        .eq("bay_id", selectedBayId)
        .eq("org_id", orgId);

      if (deleteError) throw deleteError;

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
          rate_tiers:
            r.rate_tiers && r.rate_tiers.length > 0 ? r.rate_tiers : null,
        }));

        const { error: insertError } = await supabase
          .from("dynamic_schedule_rules")
          .insert(rows);

        if (insertError) throw insertError;
      }

      setSaved(true);
      setIsDirty(false);
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

  // ── Beforeunload warning ─────────────────────────────────────────────
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirty) {
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // ── Close dropdowns on outside click ─────────────────────────────────
  const bayDropdownRef = useRef<HTMLDivElement>(null);
  const copyDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: globalThis.MouseEvent) {
      if (
        bayDropdownRef.current &&
        !bayDropdownRef.current.contains(e.target as Node)
      ) {
        setShowBayDropdown(false);
      }
      if (
        copyDropdownRef.current &&
        !copyDropdownRef.current.contains(e.target as Node)
      ) {
        setShowCopyDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/[0.06] dark:bg-white/[0.02]">
      {/* ─── Panel 1: Top Toolbar ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-white/[0.06] sm:gap-3">
        {/* Facility dropdown */}
        <div className="relative" ref={bayDropdownRef}>
          <button
            type="button"
            onClick={() => setShowBayDropdown(!showBayDropdown)}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 shadow-sm transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/90 dark:hover:bg-white/[0.08]"
          >
            <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
              Facility:
            </span>
            {selectedBay?.name || "Select"}
            <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
          </button>
          {showBayDropdown && (
            <div className="absolute left-0 top-full z-30 mt-1 min-w-[200px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-gray-900">
              {bays.map((bay) => {
                const hasRules = Array.from(rules.keys()).some((k) =>
                  k.startsWith(`${bay.id}:`)
                );
                return (
                  <button
                    key={bay.id}
                    type="button"
                    onClick={() => handleBaySwitch(bay.id)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      bay.id === selectedBayId
                        ? "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
                        : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.05]"
                    }`}
                  >
                    {bay.name}
                    {bay.resource_type && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {bay.resource_type}
                      </span>
                    )}
                    {hasRules && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-green-500" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Copy From dropdown */}
        {otherBaysWithRules.length > 0 && (
          <div className="relative" ref={copyDropdownRef}>
            <button
              type="button"
              onClick={() => setShowCopyDropdown(!showCopyDropdown)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-gray-300 dark:hover:bg-white/[0.08]"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy From
              <ChevronDown className="h-3 w-3 text-gray-400" />
            </button>
            {showCopyDropdown && (
              <div className="absolute left-0 top-full z-30 mt-1 min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-gray-900">
                {otherBaysWithRules.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => copyFromBay(b.id)}
                    className="flex w-full items-center px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.05]"
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Preview Booking (placeholder) */}
        <button
          type="button"
          disabled
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-400 shadow-sm dark:border-white/10 dark:bg-white/[0.05] dark:text-gray-500"
          title="Coming soon"
        >
          <Eye className="h-3.5 w-3.5" />
          Preview Booking
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Dirty indicator */}
        {isDirty && (
          <span className="hidden text-xs text-amber-600 dark:text-amber-400 sm:block">
            Unsaved changes
          </span>
        )}

        {/* Save status */}
        {saved && (
          <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Saved
          </span>
        )}
        {error && (
          <span className="max-w-[200px] truncate text-xs text-red-600 dark:text-red-400">
            {error}
          </span>
        )}

        {/* Save Changes button */}
        <Button
          onClick={handleSave}
          disabled={saving || !isDirty}
          size="sm"
          className="gap-1.5"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      {/* ─── Main Content: Timeline + Sidebar ─────────────────────── */}
      <div className="flex flex-1 flex-col lg:flex-row">
        {/* ─── Panel 2: Weekly Timeline ───────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-x-auto p-4 sm:p-6">
          <WeeklyTimeline
            bayRulesMap={bayRulesMap}
            selectedDays={selectedDays}
            timelineRange={timelineRange}
            onDayClick={handleDayClick}
            onDisableDay={disableDay}
            onUpdateRule={updateRule}
          />

          {/* ─── Pricing Timeline (below schedule) ──────────────── */}
          {selectedDays.size > 0 && (
            <PricingTimeline
              bayRulesMap={bayRulesMap}
              selectedDays={selectedDays}
              defaultRate={selectedBay?.hourly_rate_cents || 0}
            />
          )}
        </div>

        {/* ─── Panel 3: Right Sidebar Editor ──────────────────────── */}
        {/* Desktop: always visible */}
        <div className="hidden w-80 shrink-0 border-t border-gray-200 dark:border-white/[0.06] lg:block lg:border-l lg:border-t-0">
          <SidebarEditor
            bayRulesMap={bayRulesMap}
            selectedDays={selectedDays}
            selectedBay={selectedBay || null}
            onUpdateRule={updateRule}
            onEnableDay={enableDay}
          />
        </div>

        {/* Mobile: toggle button + bottom sheet */}
        {selectedDays.size > 0 && (
          <div className="lg:hidden">
            <button
              type="button"
              onClick={() => setShowMobileSidebar(true)}
              className="flex w-full items-center justify-center gap-2 border-t border-gray-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700 dark:border-white/[0.06] dark:bg-blue-950/30 dark:text-blue-400"
            >
              Edit Selected Days ({selectedDays.size})
            </button>
            {showMobileSidebar && (
              <div className="fixed inset-0 z-50 flex flex-col justify-end">
                <div
                  className="absolute inset-0 bg-black/40"
                  onClick={() => setShowMobileSidebar(false)}
                />
                <div className="relative max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-white dark:border-white/[0.06] dark:bg-gray-900">
                  <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3 dark:border-white/[0.06] dark:bg-gray-900">
                    <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                      Edit Selected Days
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowMobileSidebar(false)}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.05]"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <SidebarEditor
                    bayRulesMap={bayRulesMap}
                    selectedDays={selectedDays}
                    selectedBay={selectedBay || null}
                    onUpdateRule={updateRule}
                    onEnableDay={enableDay}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Unsaved Changes Dialog ───────────────────────────────── */}
      <Dialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Unsaved Changes
            </DialogTitle>
            <DialogDescription>
              You have unsaved changes for{" "}
              <strong>{selectedBay?.name}</strong>. Switching facilities will
              discard these changes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setShowUnsavedDialog(false);
                setPendingBaySwitch(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmBaySwitch}
            >
              Discard & Switch
            </Button>
            <Button
              onClick={async () => {
                await handleSave();
                confirmBaySwitch();
              }}
            >
              Save & Switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Weekly Timeline Component ──────────────────────────────────────────────

function WeeklyTimeline({
  bayRulesMap,
  selectedDays,
  timelineRange,
  onDayClick,
  onDisableDay,
  onUpdateRule,
}: {
  bayRulesMap: Map<number, Rule>;
  selectedDays: Set<number>;
  timelineRange: { start: number; end: number; hasRules: boolean };
  onDayClick: (day: number, shiftKey: boolean) => void;
  onDisableDay: (day: number) => void;
  onUpdateRule: (day: number, updates: Partial<Rule>) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { start: rangeStart, end: rangeEnd } = timelineRange;
  const totalMinutes = rangeEnd - rangeStart;

  // Generate hour markers
  const hours: number[] = [];
  for (let m = rangeStart; m <= rangeEnd; m += 60) {
    hours.push(m);
  }

  function minutesToPercent(mins: number): number {
    return ((mins - rangeStart) / totalMinutes) * 100;
  }

  function percentToMinutes(pct: number): number {
    return rangeStart + (pct / 100) * totalMinutes;
  }

  return (
    <div className="space-y-1">
      {/* Hint text */}
      <p className="mb-3 text-xs text-gray-400 dark:text-gray-500">
        Click a day to select it. Shift-click for multi-select. Drag bar edges
        to adjust hours.
      </p>

      {/* Timeline container */}
      <div ref={containerRef} className="min-w-[500px]">
        {/* Time axis header */}
        <div className="flex">
          {/* Spacer for checkbox + day label columns */}
          <div className="w-[68px] shrink-0 sm:w-[76px]" />
          <div className="relative h-6 flex-1">
            {hours.map((m) => (
              <div
                key={m}
                className="absolute top-0 -translate-x-1/2 text-[10px] text-gray-400 dark:text-gray-500"
                style={{ left: `${minutesToPercent(m)}%` }}
              >
                {formatTimeShort(minutesToTime(m))}
              </div>
            ))}
          </div>
          {/* Spacer for close button column */}
          <div className="w-8 shrink-0" />
        </div>

        {/* Day rows */}
        {DAYS_OF_WEEK.map((day) => {
          const rule = bayRulesMap.get(day.value);
          const isSelected = selectedDays.has(day.value);
          const isEnabled = !!rule;

          return (
            <DayRow
              key={day.value}
              day={day}
              rule={rule || null}
              isSelected={isSelected}
              isEnabled={isEnabled}
              rangeStart={rangeStart}
              totalMinutes={totalMinutes}
              hours={hours}
              minutesToPercent={minutesToPercent}
              percentToMinutes={percentToMinutes}
              containerRef={containerRef}
              onClick={(e) => onDayClick(day.value, e.shiftKey)}
              onDisable={() => onDisableDay(day.value)}
              onUpdateTimes={(open, close) =>
                onUpdateRule(day.value, {
                  open_time: minutesToTime(open),
                  close_time: minutesToTime(close),
                })
              }
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Day Row Component ──────────────────────────────────────────────────────

function DayRow({
  day,
  rule,
  isSelected,
  isEnabled,
  rangeStart,
  totalMinutes,
  hours,
  minutesToPercent,
  percentToMinutes,
  containerRef,
  onClick,
  onDisable,
  onUpdateTimes,
}: {
  day: { value: number; label: string; short: string };
  rule: Rule | null;
  isSelected: boolean;
  isEnabled: boolean;
  rangeStart: number;
  totalMinutes: number;
  hours: number[];
  minutesToPercent: (m: number) => number;
  percentToMinutes: (p: number) => number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onClick: (e: ReactMouseEvent) => void;
  onDisable: () => void;
  onUpdateTimes: (openMins: number, closeMins: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"left" | "right" | null>(null);
  const [dragOpen, setDragOpen] = useState(0);
  const [dragClose, setDragClose] = useState(0);

  const openMins = rule ? timeToMinutes(rule.open_time) : 0;
  const closeMins = rule ? timeToMinutes(rule.close_time) : 0;

  const displayOpen = dragging ? dragOpen : openMins;
  const displayClose = dragging ? dragClose : closeMins;

  // ── Drag handlers ────────────────────────────────────────────────
  function startDrag(
    edge: "left" | "right",
    e: ReactMouseEvent
  ) {
    e.stopPropagation();
    e.preventDefault();
    setDragging(edge);
    setDragOpen(openMins);
    setDragClose(closeMins);

    const track = trackRef.current;
    if (!track) return;

    function handleMouseMove(ev: globalThis.MouseEvent) {
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const pct = Math.max(
        0,
        Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100)
      );
      const rawMins = percentToMinutes(pct);
      const snapped = snapToGrid(rawMins);

      if (edge === "left") {
        setDragOpen((prev) => {
          const currentClose =
            dragging === "left" ? dragClose : closeMins;
          return snapped < currentClose - SNAP_MINUTES
            ? snapped
            : prev;
        });
      } else {
        setDragClose((prev) => {
          const currentOpen =
            dragging === "right" ? dragOpen : openMins;
          return snapped > currentOpen + SNAP_MINUTES
            ? snapped
            : prev;
        });
      }
    }

    function handleMouseUp() {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);

      // Read the latest values from the DOM-managed state
      // We need to use a callback to get the final values
      if (edge === "left") {
        setDragOpen((finalOpen) => {
          setDragging(null);
          onUpdateTimes(finalOpen, closeMins);
          return finalOpen;
        });
      } else {
        setDragClose((finalClose) => {
          setDragging(null);
          onUpdateTimes(openMins, finalClose);
          return finalClose;
        });
      }
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  return (
    <div
      className={`group flex items-center transition-colors ${
        isSelected
          ? "rounded-lg bg-blue-50/80 dark:bg-blue-950/20"
          : "hover:bg-gray-50/50 dark:hover:bg-white/[0.02]"
      }`}
    >
      {/* Checkbox */}
      <div className="flex w-7 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => {
            // Simulate click with shift key support
            onClick(e as unknown as ReactMouseEvent);
          }}
          className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600"
        />
      </div>

      {/* Day label */}
      <button
        type="button"
        onClick={onClick}
        className={`w-10 shrink-0 py-3 text-left text-xs font-semibold sm:w-12 sm:text-sm ${
          isEnabled
            ? isSelected
              ? "text-blue-700 dark:text-blue-400"
              : "text-gray-700 dark:text-gray-300"
            : "text-gray-300 dark:text-gray-600"
        }`}
      >
        <span className="sm:hidden">{day.short}</span>
        <span className="hidden sm:inline">{day.short}</span>
      </button>

      {/* Timeline track */}
      <div
        ref={trackRef}
        className="relative h-10 flex-1 cursor-pointer"
        onClick={onClick}
      >
        {/* Grid lines */}
        {hours.map((m) => (
          <div
            key={m}
            className="absolute top-0 h-full w-px bg-gray-100 dark:bg-white/[0.04]"
            style={{ left: `${minutesToPercent(m)}%` }}
          />
        ))}

        {isEnabled ? (
          /* Active bar */
          <div
            className={`absolute top-1.5 h-7 rounded-md transition-colors ${
              isSelected
                ? "bg-blue-500 dark:bg-blue-600"
                : "bg-blue-400/70 dark:bg-blue-500/50"
            }`}
            style={{
              left: `${minutesToPercent(displayOpen)}%`,
              width: `${minutesToPercent(displayClose) - minutesToPercent(displayOpen)}%`,
            }}
          >
            {/* Left drag handle */}
            <div
              className="absolute -left-1 top-0 flex h-full w-3 cursor-col-resize items-center justify-center"
              onMouseDown={(e) => startDrag("left", e)}
            >
              <div className="h-4 w-1 rounded-full bg-white/60" />
            </div>

            {/* Time labels inside bar */}
            <div className="flex h-full items-center justify-between px-3 select-none">
              <span className="text-[10px] font-medium text-white/90">
                {formatTimeShort(minutesToTime(displayOpen))}
              </span>
              <span className="text-[10px] font-medium text-white/90">
                {formatTimeShort(minutesToTime(displayClose))}
              </span>
            </div>

            {/* Right drag handle */}
            <div
              className="absolute -right-1 top-0 flex h-full w-3 cursor-col-resize items-center justify-center"
              onMouseDown={(e) => startDrag("right", e)}
            >
              <div className="h-4 w-1 rounded-full bg-white/60" />
            </div>
          </div>
        ) : (
          /* Closed / greyed out row */
          <div className="absolute inset-x-0 top-1.5 flex h-7 items-center justify-center rounded-md border border-dashed border-gray-200 bg-gray-50/50 dark:border-white/[0.06] dark:bg-white/[0.02]">
            <span className="text-[10px] text-gray-300 dark:text-gray-600">
              Closed
            </span>
          </div>
        )}
      </div>

      {/* Close button */}
      <div className="flex w-8 shrink-0 items-center justify-center">
        {isEnabled && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDisable();
            }}
            className="rounded p-1 text-gray-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:text-gray-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
            title="Close this day"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Pricing Timeline Component ─────────────────────────────────────────────

function PricingTimeline({
  bayRulesMap,
  selectedDays,
  defaultRate,
}: {
  bayRulesMap: Map<number, Rule>;
  selectedDays: Set<number>;
  defaultRate: number;
}) {
  // Get rate tiers from selected days
  const selectedRules = Array.from(selectedDays)
    .map((d) => bayRulesMap.get(d))
    .filter(Boolean) as Rule[];

  if (selectedRules.length === 0) return null;

  // Check if all selected have same rate tiers
  const firstTiers = selectedRules[0]?.rate_tiers || [];
  const allSame = selectedRules.every((r) => {
    const tiers = r.rate_tiers || [];
    if (tiers.length !== firstTiers.length) return false;
    return tiers.every(
      (t, i) =>
        t.start_time === firstTiers[i].start_time &&
        t.end_time === firstTiers[i].end_time &&
        t.hourly_rate_cents === firstTiers[i].hourly_rate_cents
    );
  });

  const displayTiers = allSame ? firstTiers : null;

  return (
    <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50/50 p-4 dark:border-white/[0.04] dark:bg-white/[0.02]">
      <div className="mb-2 flex items-center gap-1.5">
        <DollarSign className="h-3.5 w-3.5 text-gray-400" />
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
          Pricing
        </span>
      </div>
      {displayTiers === null ? (
        <p className="text-xs text-gray-400 italic dark:text-gray-500">
          Mixed pricing across selected days — edit in sidebar
        </p>
      ) : displayTiers.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Default rate: ${(defaultRate / 100).toFixed(2)}/hr — add tiers in
          sidebar to override
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {displayTiers.map((tier, i) => (
            <div
              key={i}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs dark:border-white/[0.06] dark:bg-white/[0.04]"
            >
              <span className="text-gray-500 dark:text-gray-400">
                {formatTimeShort(tier.start_time)} –{" "}
                {formatTimeShort(tier.end_time)}
              </span>
              <span className="font-semibold text-gray-800 dark:text-white/90">
                ${(tier.hourly_rate_cents / 100).toFixed(2)}/hr
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sidebar Editor Component ───────────────────────────────────────────────

function SidebarEditor({
  bayRulesMap,
  selectedDays,
  selectedBay,
  onUpdateRule,
  onEnableDay,
}: {
  bayRulesMap: Map<number, Rule>;
  selectedDays: Set<number>;
  selectedBay: Bay | null;
  onUpdateRule: (day: number, updates: Partial<Rule>) => void;
  onEnableDay: (day: number) => void;
}) {
  const selectedRules = Array.from(selectedDays)
    .map((d) => bayRulesMap.get(d))
    .filter(Boolean) as Rule[];

  const dayLabels = Array.from(selectedDays)
    .sort((a, b) => {
      const order = [1, 2, 3, 4, 5, 6, 0];
      return order.indexOf(a) - order.indexOf(b);
    })
    .map((d) => DAYS_OF_WEEK.find((day) => day.value === d)?.short || "")
    .join(", ");

  // ── Compute "mixed" vs shared values ────────────────────────────
  function getSharedValue<T>(
    getter: (r: Rule) => T,
    eq?: (a: T, b: T) => boolean
  ): { value: T; mixed: boolean } | { value: null; mixed: true } {
    if (selectedRules.length === 0) return { value: null, mixed: true };
    const first = getter(selectedRules[0]);
    const isEqual = eq || ((a, b) => a === b);
    const allSame = selectedRules.every((r) => isEqual(getter(r), first));
    if (allSame) return { value: first, mixed: false };
    return { value: null, mixed: true };
  }

  const sharedBuffer = getSharedValue((r) => r.buffer_minutes);
  const sharedGranularity = getSharedValue((r) => r.start_time_granularity);
  const sharedDurations = getSharedValue(
    (r) => r.available_durations,
    (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
  );

  // For rate tiers
  const sharedTiers = getSharedValue(
    (r) => r.rate_tiers || [],
    (a, b) => {
      if (a.length !== b.length) return false;
      return a.every(
        (t, i) =>
          t.start_time === b[i].start_time &&
          t.end_time === b[i].end_time &&
          t.hourly_rate_cents === b[i].hourly_rate_cents
      );
    }
  );

  // ── Local form state for pending changes ─────────────────────────
  // Track which fields user has explicitly modified
  const [localBuffer, setLocalBuffer] = useState<string>("");
  const [localGranularity, setLocalGranularity] = useState<string>("");
  const [localDurations, setLocalDurations] = useState<number[] | null>(null);
  const [localTiers, setLocalTiers] = useState<RateTier[] | null>(null);
  const [hasLocalChanges, setHasLocalChanges] = useState(false);

  // Reset local state when selection changes
  const selectionKey = Array.from(selectedDays).sort().join(",");
  const prevSelectionRef = useRef(selectionKey);
  useEffect(() => {
    if (prevSelectionRef.current !== selectionKey) {
      prevSelectionRef.current = selectionKey;
      setLocalBuffer("");
      setLocalGranularity("");
      setLocalDurations(null);
      setLocalTiers(null);
      setHasLocalChanges(false);
    }
  }, [selectionKey]);

  // Display values: local override → shared value → "Mixed"
  const displayBuffer = localBuffer !== "" ? localBuffer : sharedBuffer.mixed ? "" : String(sharedBuffer.value);
  const displayGranularity = localGranularity !== "" ? localGranularity : sharedGranularity.mixed ? "" : String(sharedGranularity.value);
  const displayDurations = localDurations !== null ? localDurations : sharedDurations.mixed ? null : (sharedDurations.value as number[]);
  const displayTiers = localTiers !== null ? localTiers : sharedTiers.mixed ? null : (sharedTiers.value as RateTier[]);

  // ── Apply changes ────────────────────────────────────────────────
  function applyChanges() {
    for (const dayOfWeek of selectedDays) {
      const updates: Partial<Rule> = {};

      if (localBuffer !== "") {
        updates.buffer_minutes = parseInt(localBuffer) || 0;
      }
      if (localGranularity !== "") {
        updates.start_time_granularity = parseInt(localGranularity);
      }
      if (localDurations !== null) {
        updates.available_durations = [...localDurations];
      }
      if (localTiers !== null) {
        updates.rate_tiers =
          localTiers.length > 0
            ? localTiers.map((t) => ({ ...t }))
            : null;
      }

      if (Object.keys(updates).length > 0) {
        onUpdateRule(dayOfWeek, updates);
      }
    }

    // Reset local state
    setLocalBuffer("");
    setLocalGranularity("");
    setLocalDurations(null);
    setLocalTiers(null);
    setHasLocalChanges(false);
  }

  // ── Rate tier helpers ────────────────────────────────────────────
  function addTier() {
    const current = displayTiers || [];
    const rule = selectedRules[0];
    const lastEnd =
      current.length > 0
        ? current[current.length - 1].end_time
        : rule?.open_time || "09:00";
    const newTier: RateTier = {
      start_time: lastEnd,
      end_time: rule?.close_time || "21:00",
      hourly_rate_cents: selectedBay?.hourly_rate_cents || 0,
    };
    const updated = [...current, newTier];
    setLocalTiers(updated);
    setHasLocalChanges(true);
  }

  function updateTier(index: number, updates: Partial<RateTier>) {
    const current = displayTiers || [];
    const updated = current.map((t, i) =>
      i === index ? { ...t, ...updates } : t
    );
    setLocalTiers(updated);
    setHasLocalChanges(true);
  }

  function removeTier(index: number) {
    const current = displayTiers || [];
    const updated = current.filter((_, i) => i !== index);
    setLocalTiers(updated);
    setHasLocalChanges(true);
  }

  // ── No selection state ───────────────────────────────────────────
  if (selectedDays.size === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-white/[0.05]">
          <GripVertical className="h-5 w-5 text-gray-300 dark:text-gray-600" />
        </div>
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
          Select days to edit
        </p>
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          Click a day in the timeline, or shift-click to select multiple days.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-100 px-4 py-3 dark:border-white/[0.06]">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
          Editing:
        </p>
        <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
          {selectedDays.size === 1
            ? DAYS_OF_WEEK.find((d) => d.value === Array.from(selectedDays)[0])
                ?.label
            : dayLabels}
        </p>
        {selectedDays.size > 1 && (
          <p className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">
            Changes apply to all selected days
          </p>
        )}
      </div>

      <div className="space-y-5 overflow-y-auto p-4">
        {/* Copy Day From */}
        {(() => {
          // Days that have rules configured (and are NOT in the current selection)
          const copyableDays = DAYS_OF_WEEK.filter(
            (d) => bayRulesMap.has(d.value) && !selectedDays.has(d.value)
          );
          if (copyableDays.length === 0) return null;
          return (
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Copy Day From
              </label>
              <select
                value=""
                onChange={(e) => {
                  const sourceDayOfWeek = parseInt(e.target.value);
                  if (isNaN(sourceDayOfWeek)) return;
                  const sourceRule = bayRulesMap.get(sourceDayOfWeek);
                  if (!sourceRule) return;
                  // Set all local fields from the source day
                  setLocalBuffer(String(sourceRule.buffer_minutes));
                  setLocalGranularity(String(sourceRule.start_time_granularity));
                  setLocalDurations([...sourceRule.available_durations]);
                  setLocalTiers(
                    sourceRule.rate_tiers
                      ? sourceRule.rate_tiers.map((t) => ({ ...t }))
                      : []
                  );
                  setHasLocalChanges(true);
                  // Also update open/close times for all selected days
                  for (const dayOfWeek of selectedDays) {
                    onUpdateRule(dayOfWeek, {
                      open_time: sourceRule.open_time,
                      close_time: sourceRule.close_time,
                    });
                  }
                }}
                className="mt-1 flex h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white/90"
              >
                <option value="" disabled>
                  Select a day to copy from...
                </option>
                {copyableDays.map((d) => {
                  const r = bayRulesMap.get(d.value);
                  const timeInfo = r
                    ? ` (${formatTimeShort(r.open_time)}–${formatTimeShort(r.close_time)})`
                    : "";
                  return (
                    <option key={d.value} value={d.value}>
                      {d.label}{timeInfo}
                    </option>
                  );
                })}
              </select>
              <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                Copies hours, durations, buffer, interval &amp; rate tiers
              </p>
            </div>
          );
        })()}

        {/* Default price (read-only) */}
        {selectedBay && (
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Default Price
            </label>
            <div className="mt-1 flex h-9 items-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-600 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-gray-400">
              ${(selectedBay.hourly_rate_cents / 100).toFixed(2)}/hr
              <span className="ml-auto text-[10px] text-gray-400">
                read-only
              </span>
            </div>
          </div>
        )}

        {/* Buffer time */}
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Buffer Time (minutes)
          </label>
          <input
            type="number"
            min="0"
            max="60"
            step="5"
            value={displayBuffer}
            placeholder={sharedBuffer.mixed ? "Mixed" : "0"}
            onChange={(e) => {
              setLocalBuffer(e.target.value);
              setHasLocalChanges(true);
            }}
            className="mt-1 flex h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white/90 dark:placeholder:text-gray-500"
          />
        </div>

        {/* Slot interval / granularity */}
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Slot Interval
          </label>
          <select
            value={displayGranularity}
            onChange={(e) => {
              setLocalGranularity(e.target.value);
              setHasLocalChanges(true);
            }}
            className="mt-1 flex h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white/90"
          >
            {sharedGranularity.mixed && <option value="">Mixed</option>}
            {GRANULARITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Booking durations */}
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Booking Durations
          </label>
          {displayDurations === null ? (
            <p className="mt-1 text-xs text-gray-400 italic dark:text-gray-500">
              Mixed — click a duration to set for all selected days
            </p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {COMMON_DURATIONS.map((dur) => {
              const isSelected = displayDurations?.includes(dur) ?? false;
              return (
                <button
                  key={dur}
                  type="button"
                  onClick={() => {
                    const current = displayDurations || [];
                    const updated = isSelected
                      ? current.filter((d) => d !== dur)
                      : [...current, dur].sort((a, b) => a - b);
                    if (updated.length === 0) return;
                    setLocalDurations(updated);
                    setHasLocalChanges(true);
                  }}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    isSelected
                      ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/20 dark:text-blue-400"
                      : "border-gray-200 text-gray-500 hover:border-gray-300 dark:border-white/10 dark:text-gray-400"
                  }`}
                >
                  {formatDuration(dur)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Rate tiers */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Rate Tiers
            </label>
            <button
              type="button"
              onClick={addTier}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
            >
              <Plus className="h-3 w-3" />
              Add
            </button>
          </div>

          {displayTiers === null ? (
            <p className="mt-1 text-xs text-gray-400 italic dark:text-gray-500">
              Mixed tiers across selected days
            </p>
          ) : displayTiers.length === 0 ? (
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              Using default rate for all hours
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {displayTiers.map((tier, idx) => (
                <div
                  key={idx}
                  className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50/50 p-2.5 dark:border-white/[0.06] dark:bg-white/[0.02]"
                >
                  <div className="flex items-center gap-1.5">
                    <input
                      type="time"
                      value={tier.start_time}
                      onChange={(e) =>
                        updateTier(idx, { start_time: e.target.value })
                      }
                      className="h-7 w-full rounded border border-gray-300 bg-white px-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white/90"
                    />
                    <span className="shrink-0 text-xs text-gray-400">to</span>
                    <input
                      type="time"
                      value={tier.end_time}
                      onChange={(e) =>
                        updateTier(idx, { end_time: e.target.value })
                      }
                      className="h-7 w-full rounded border border-gray-300 bg-white px-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white/90"
                    />
                    <button
                      type="button"
                      onClick={() => removeTier(idx)}
                      className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                      $
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={(tier.hourly_rate_cents / 100).toFixed(2)}
                      onChange={(e) =>
                        updateTier(idx, {
                          hourly_rate_cents: Math.round(
                            parseFloat(e.target.value || "0") * 100
                          ),
                        })
                      }
                      className="h-7 w-full rounded border border-gray-300 bg-white pl-5 pr-8 text-xs text-gray-800 focus:border-blue-500 focus:outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white/90"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                      /hr
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Apply button */}
      <div className="border-t border-gray-100 p-4 dark:border-white/[0.06]">
        <Button
          onClick={applyChanges}
          disabled={!hasLocalChanges}
          className="w-full gap-1.5"
          size="sm"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Apply Changes
        </Button>
        {hasLocalChanges && (
          <p className="mt-1.5 text-center text-[10px] text-gray-400 dark:text-gray-500">
            Then click &ldquo;Save Changes&rdquo; in toolbar to persist
          </p>
        )}
      </div>
    </div>
  );
}
