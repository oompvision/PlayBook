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
  Ban,
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
import { SchedulePreview } from "./schedule-preview";

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

type DbRule = Rule & {
  id: string;
  org_id: string;
  created_at: string;
  updated_at: string;
};

type TierSelection = {
  startTime: string;
  endTime: string;
} | null;

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
  // Rate tier drag-to-create
  const [tierSelection, setTierSelection] = useState<TierSelection>(null);
  const [editingTierIndex, setEditingTierIndex] = useState<number | null>(null);
  const [tierToast, setTierToast] = useState<string | null>(null);
  const [tierCreateMode, setTierCreateMode] = useState<"rate" | "blockout">("rate");
  const [blockoutConfirm, setBlockoutConfirm] = useState<{
    blockout: { start_time: string; end_time: string };
    consumed: RateTier[];
  } | null>(null);
  const tierSectionRef = useRef<HTMLDivElement>(null);
  const [showPreview, setShowPreview] = useState(false);

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
    setRules((prev) => {
      const existing = prev.get(key);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(key, { ...existing, ...updates });
      return next;
    });
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

  // ── Checkbox toggle (independent multi-select) ─────────────────────
  function handleCheckboxToggle(dayOfWeek: number) {
    const rule = bayRulesMap.get(dayOfWeek);
    if (!rule) {
      enableDay(dayOfWeek);
      setSelectedDays((prev) => {
        const next = new Set(prev);
        next.add(dayOfWeek);
        return next;
      });
      return;
    }
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayOfWeek)) {
        next.delete(dayOfWeek);
      } else {
        next.add(dayOfWeek);
      }
      return next;
    });
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

  // ── Rate tier handlers ──────────────────────────────────────────────
  function handleTierDragComplete(dayOfWeek: number, startMins: number, endMins: number) {
    // Day selection logic
    if (!selectedDays.has(dayOfWeek)) {
      // Dragging on unselected day → switch to that day
      setSelectedDays(new Set([dayOfWeek]));
    } else if (selectedDays.size > 1 && !selectedTiersIdentical) {
      // Multi-select with non-identical configs → switch to just this day
      setSelectedDays(new Set([dayOfWeek]));
    }
    // else: single day or identical multi-select → keep selection

    const startTime = minutesToTime(Math.min(startMins, endMins));
    const endTime = minutesToTime(Math.max(startMins, endMins));
    setTierSelection({ startTime, endTime });
    setEditingTierIndex(null);
    // Scroll to tier section
    setTimeout(() => {
      tierSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
  }

  function handleTierClick(tierIndex: number) {
    setEditingTierIndex(tierIndex);
    setTierSelection(null);
    setTimeout(() => {
      tierSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
  }

  function handleApplyTier(tier: RateTier) {
    const isBlockout = tier.type === "blockout";
    const newStart = timeToMinutes(tier.start_time);
    const newEnd = timeToMinutes(tier.end_time);

    // Rate tier validation
    if (!isBlockout) {
      if (tier.hourly_rate_cents === (selectedBay?.hourly_rate_cents || 0)) {
        setTierToast("Rate tier must be a different rate from the default rate");
        setTimeout(() => setTierToast(null), 4000);
        return;
      }
    }

    // Check overlaps and handle trim/consume logic
    for (const dayOfWeek of selectedDays) {
      const rule = bayRulesMap.get(dayOfWeek);
      if (!rule) continue;
      const existingTiers = rule.rate_tiers || [];

      for (const existing of existingTiers) {
        const exStart = timeToMinutes(existing.start_time);
        const exEnd = timeToMinutes(existing.end_time);
        if (newStart >= exEnd || newEnd <= exStart) continue; // no overlap

        const existingIsBlockout = existing.type === "blockout";

        if (isBlockout && !existingIsBlockout) {
          // Block-out overlapping rate tier
          if (newStart <= exStart && newEnd >= exEnd) {
            // Full consume — ask confirmation
            const consumed = existingTiers.filter((t) => {
              if (t.type === "blockout") return false;
              const s = timeToMinutes(t.start_time);
              const e = timeToMinutes(t.end_time);
              return newStart <= s && newEnd >= e;
            });
            if (consumed.length > 0) {
              setBlockoutConfirm({ blockout: { start_time: tier.start_time, end_time: tier.end_time }, consumed });
              return;
            }
          }
          // Partial overlap — will be auto-trimmed in applyTierToRules
        } else if (!isBlockout && existingIsBlockout) {
          // Rate tier overlapping block-out — auto-trim rate tier to block-out edge
          if (newStart < exEnd && newEnd > exStart) {
            // Trim the new tier to avoid the blockout
            if (newStart < exStart) {
              tier = { ...tier, end_time: existing.start_time };
            } else {
              tier = { ...tier, start_time: existing.end_time };
            }
            const trimmedStart = timeToMinutes(tier.start_time);
            const trimmedEnd = timeToMinutes(tier.end_time);
            if (trimmedEnd <= trimmedStart) {
              setTierToast("Rate tier cannot overlap a block-out");
              setTimeout(() => setTierToast(null), 3000);
              return;
            }
          }
        } else if (!isBlockout && !existingIsBlockout) {
          // Rate tier on rate tier — reject
          setTierToast("Rate tiers cannot overlap");
          setTimeout(() => setTierToast(null), 3000);
          return;
        } else {
          // Block-out on block-out — merge
          tier = {
            ...tier,
            start_time: minutesToTime(Math.min(newStart, exStart)),
            end_time: minutesToTime(Math.max(newEnd, exEnd)),
          };
        }
      }
    }

    applyTierToRules(tier);
  }

  function applyTierToRules(tier: RateTier) {
    const isBlockout = tier.type === "blockout";
    const newStart = timeToMinutes(tier.start_time);
    const newEnd = timeToMinutes(tier.end_time);
    const dayLabels: string[] = [];

    for (const dayOfWeek of selectedDays) {
      const rule = bayRulesMap.get(dayOfWeek);
      if (!rule) continue;
      const existingTiers = rule.rate_tiers || [];

      // Process existing tiers: trim, remove consumed, merge blockouts
      let processed: RateTier[] = [];
      for (const existing of existingTiers) {
        const exStart = timeToMinutes(existing.start_time);
        const exEnd = timeToMinutes(existing.end_time);
        const existingIsBlockout = existing.type === "blockout";

        if (newStart >= exEnd || newEnd <= exStart) {
          // No overlap — keep as is
          processed.push(existing);
        } else if (isBlockout && existingIsBlockout) {
          // Merge overlapping blockouts — skip existing, the new merged one will be added
        } else if (isBlockout && !existingIsBlockout) {
          // Block-out trims rate tier
          if (newStart <= exStart && newEnd >= exEnd) {
            // Fully consumed — remove
          } else if (newStart <= exStart) {
            // Trim left side
            processed.push({ ...existing, start_time: tier.end_time });
          } else if (newEnd >= exEnd) {
            // Trim right side
            processed.push({ ...existing, end_time: tier.start_time });
          } else {
            // Split rate tier around blockout
            processed.push({ ...existing, end_time: tier.start_time });
            processed.push({ ...existing, start_time: tier.end_time });
          }
        } else {
          // Rate on blockout — should have been handled by trim in handleApplyTier
          processed.push(existing);
        }
      }

      processed.push({ ...tier });
      processed.sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));

      updateRule(dayOfWeek, { rate_tiers: processed.length > 0 ? processed : null });
      dayLabels.push(DAYS_OF_WEEK.find((d) => d.value === dayOfWeek)?.short || "");
    }

    setTierSelection(null);
    setTierCreateMode("rate");
    const label = isBlockout ? "Block-out" : "Rate tier";
    if (selectedDays.size > 1) {
      setTierToast(`${label} applied to ${dayLabels.join(", ")}`);
      setTimeout(() => setTierToast(null), 4000);
    }
  }

  function confirmBlockoutApply() {
    if (!blockoutConfirm) return;
    applyTierToRules({
      type: "blockout",
      start_time: blockoutConfirm.blockout.start_time,
      end_time: blockoutConfirm.blockout.end_time,
      hourly_rate_cents: 0,
    });
    setBlockoutConfirm(null);
  }

  function handleUpdateTier(tierIndex: number, updates: Partial<RateTier>) {
    // Only works on single day or identical days
    for (const dayOfWeek of selectedDays) {
      const rule = bayRulesMap.get(dayOfWeek);
      if (!rule || !rule.rate_tiers) continue;
      const tiers = rule.rate_tiers.map((t, i) =>
        i === tierIndex ? { ...t, ...updates } : t
      );
      // Check overlaps
      const updated = tiers[tierIndex];
      const updatedStart = timeToMinutes(updated.start_time);
      const updatedEnd = timeToMinutes(updated.end_time);
      let overlap = false;
      for (let i = 0; i < tiers.length; i++) {
        if (i === tierIndex) continue;
        const s = timeToMinutes(tiers[i].start_time);
        const e = timeToMinutes(tiers[i].end_time);
        if (updatedStart < e && updatedEnd > s) {
          overlap = true;
          break;
        }
      }
      if (overlap) {
        setTierToast("Rate tiers cannot overlap");
        setTimeout(() => setTierToast(null), 3000);
        return;
      }
      updateRule(dayOfWeek, { rate_tiers: tiers });
    }
  }

  function handleDeleteTier(tierIndex: number) {
    const dayLabels: string[] = [];
    for (const dayOfWeek of selectedDays) {
      const rule = bayRulesMap.get(dayOfWeek);
      if (!rule || !rule.rate_tiers) continue;
      const tiers = rule.rate_tiers.filter((_, i) => i !== tierIndex);
      updateRule(dayOfWeek, { rate_tiers: tiers.length > 0 ? tiers : null });
      dayLabels.push(DAYS_OF_WEEK.find((d) => d.value === dayOfWeek)?.short || "");
    }
    setEditingTierIndex(null);
    if (selectedDays.size > 1) {
      setTierToast(`Rate tier removed from ${dayLabels.join(", ")}`);
      setTimeout(() => setTierToast(null), 4000);
    }
  }

  // Check if selected days have identical tier configs (for edit/delete to work)
  const selectedTiersIdentical = useMemo(() => {
    const selected = Array.from(selectedDays)
      .map((d) => bayRulesMap.get(d))
      .filter(Boolean) as Rule[];
    if (selected.length <= 1) return true;
    const first = selected[0].rate_tiers || [];
    return selected.every((r) => {
      const tiers = r.rate_tiers || [];
      if (tiers.length !== first.length) return false;
      return tiers.every(
        (t, i) =>
          t.start_time === first[i].start_time &&
          t.end_time === first[i].end_time &&
          t.hourly_rate_cents === first[i].hourly_rate_cents &&
          (t.type || "rate") === (first[i].type || "rate")
      );
    });
  }, [selectedDays, bayRulesMap]);

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

        {/* Preview Customer Booking */}
        <button
          type="button"
          disabled={bayRulesMap.size === 0}
          onClick={() => setShowPreview(true)}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium shadow-sm transition-colors ${
            bayRulesMap.size > 0
              ? "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-gray-300 dark:hover:bg-white/[0.08]"
              : "border-gray-200 bg-white text-gray-400 dark:border-white/10 dark:bg-white/[0.05] dark:text-gray-500"
          }`}
          title={bayRulesMap.size === 0 ? "Configure at least one day to preview" : "Preview customer view"}
        >
          <Eye className="h-3.5 w-3.5" />
          Preview Customer Booking
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
            defaultRate={selectedBay?.hourly_rate_cents || 0}
            onDayClick={handleDayClick}
            onCheckboxToggle={handleCheckboxToggle}
            onDisableDay={disableDay}
            onUpdateRule={updateRule}
            onTierDragComplete={handleTierDragComplete}
            onTierClick={handleTierClick}
            editingTierIndex={editingTierIndex}
            tierSelection={tierSelection}
            onSetTierSelection={setTierSelection}
          />

          {/* ─── Rate Tier Editor (below schedule) ──────────────── */}
          {selectedDays.size > 0 && (
            <div ref={tierSectionRef}>
              <RateTierEditor
                bayRulesMap={bayRulesMap}
                selectedDays={selectedDays}
                defaultRate={selectedBay?.hourly_rate_cents || 0}
                tierSelection={tierSelection}
                editingTierIndex={editingTierIndex}
                tierToast={tierToast}
                tiersIdentical={selectedTiersIdentical}
                tierCreateMode={tierCreateMode}
                onSetTierSelection={setTierSelection}
                onSetEditingTierIndex={setEditingTierIndex}
                onSetTierCreateMode={setTierCreateMode}
                onApplyTier={handleApplyTier}
                onUpdateTier={handleUpdateTier}
                onDeleteTier={handleDeleteTier}
              />
            </div>
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

      {/* ─── Block-out Confirmation Dialog ──────────────────────────── */}
      <Dialog open={!!blockoutConfirm} onOpenChange={(open) => !open && setBlockoutConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Remove Rate Tiers?
            </DialogTitle>
            <DialogDescription>
              This block-out will remove the following rate tier{blockoutConfirm && blockoutConfirm.consumed.length > 1 ? "s" : ""}:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            {blockoutConfirm?.consumed.map((t, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/[0.04]">
                <span className="text-gray-500">
                  {formatTimeShort(t.start_time)} – {formatTimeShort(t.end_time)}
                </span>
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  ${(t.hourly_rate_cents / 100).toFixed(2)}/hr
                </span>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setBlockoutConfirm(null)}>
              Cancel
            </Button>
            <Button
              className="bg-gray-600 hover:bg-gray-700"
              onClick={confirmBlockoutApply}
            >
              <Ban className="mr-1.5 h-3.5 w-3.5" />
              Apply Block-out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              variant="outline"
              className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
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

      {/* ─── Schedule Preview Modal ──────────────────────────────── */}
      {showPreview && (() => {
        // Use first selected day, or fall back to first day with a rule
        const previewDay = selectedDays.size > 0
          ? Array.from(selectedDays)[0]
          : Array.from(bayRulesMap.keys())[0];
        if (previewDay === undefined) return null;
        const previewRule = bayRulesMap.get(previewDay);
        const dayInfo = DAYS_OF_WEEK.find((d) => d.value === previewDay);
        if (!previewRule || !selectedBay) return null;
        return (
          <SchedulePreview
            rule={previewRule}
            bayName={selectedBay.name}
            defaultRateCents={selectedBay.hourly_rate_cents}
            dayLabel={dayInfo?.label || ""}
            hasUnsavedChanges={isDirty}
            onClose={() => setShowPreview(false)}
          />
        );
      })()}
    </div>
  );
}

// ─── Weekly Timeline Component ──────────────────────────────────────────────

function WeeklyTimeline({
  bayRulesMap,
  selectedDays,
  timelineRange,
  defaultRate,
  onDayClick,
  onCheckboxToggle,
  onDisableDay,
  onUpdateRule,
  onTierDragComplete,
  onTierClick,
  editingTierIndex,
  tierSelection,
  onSetTierSelection,
}: {
  bayRulesMap: Map<number, Rule>;
  selectedDays: Set<number>;
  timelineRange: { start: number; end: number; hasRules: boolean };
  defaultRate: number;
  onDayClick: (day: number, shiftKey: boolean) => void;
  onCheckboxToggle: (day: number) => void;
  onDisableDay: (day: number) => void;
  onUpdateRule: (day: number, updates: Partial<Rule>) => void;
  onTierDragComplete: (dayOfWeek: number, startMins: number, endMins: number) => void;
  onTierClick: (tierIndex: number) => void;
  editingTierIndex: number | null;
  tierSelection: TierSelection;
  onSetTierSelection: (s: TierSelection) => void;
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
              onCheckboxToggle={() => onCheckboxToggle(day.value)}
              onDisable={() => onDisableDay(day.value)}
              defaultRate={defaultRate}
              onTierDragComplete={(start, end) => onTierDragComplete(day.value, start, end)}
              onTierClick={onTierClick}
              editingTierIndex={editingTierIndex}
              tierSelection={tierSelection}
              onSetTierSelection={onSetTierSelection}
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
  onCheckboxToggle,
  onDisable,
  onUpdateTimes,
  defaultRate,
  onTierDragComplete,
  onTierClick,
  editingTierIndex,
  tierSelection,
  onSetTierSelection,
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
  onCheckboxToggle: () => void;
  onDisable: () => void;
  onUpdateTimes: (openMins: number, closeMins: number) => void;
  defaultRate: number;
  onTierDragComplete: (startMins: number, endMins: number) => void;
  onTierClick: (tierIndex: number) => void;
  editingTierIndex: number | null;
  tierSelection: TierSelection;
  onSetTierSelection: (s: TierSelection) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"left" | "right" | null>(null);
  const [dragOpen, setDragOpen] = useState(0);
  const [dragClose, setDragClose] = useState(0);
  // Interior drag for tier selection
  const [tierDrag, setTierDrag] = useState<{
    startMins: number;
    endMins: number;
  } | null>(null);
  // Edge click popover
  const [edgePopover, setEdgePopover] = useState<{
    edge: "left" | "right";
  } | null>(null);

  const openMins = rule ? timeToMinutes(rule.open_time) : 0;
  const closeMins = rule ? timeToMinutes(rule.close_time) : 0;
  const rateTiers = rule?.rate_tiers || [];

  const displayOpen = dragging ? dragOpen : openMins;
  const displayClose = dragging ? dragClose : closeMins;

  // Convert mouse position to snapped minutes within the bar
  function mouseToMinutes(clientX: number): number {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(
      0,
      Math.min(100, ((clientX - rect.left) / rect.width) * 100)
    );
    const rawMins = percentToMinutes(pct);
    return snapToGrid(Math.max(openMins, Math.min(closeMins, rawMins)));
  }

  // Percent within the bar (not the track) for tier visualization
  function minsToBarPercent(mins: number): number {
    const barRange = displayClose - displayOpen;
    if (barRange <= 0) return 0;
    return ((mins - displayOpen) / barRange) * 100;
  }

  // ── Edge drag handlers ────────────────────────────────────────────
  function startEdgeDrag(edge: "left" | "right", e: ReactMouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setEdgePopover(null);

    const startX = e.clientX;
    let moved = false;
    let dragStarted = false;

    const track = trackRef.current;
    if (!track) return;

    function handleMouseMove(ev: globalThis.MouseEvent) {
      const dist = Math.abs(ev.clientX - startX);
      if (dist > 5) moved = true;

      if (!moved || !track) return;

      if (!dragStarted) {
        dragStarted = true;
        setDragging(edge);
        setDragOpen(openMins);
        setDragClose(closeMins);
      }

      const rect = track.getBoundingClientRect();
      const pct = Math.max(
        0,
        Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100)
      );
      const rawMins = percentToMinutes(pct);
      const snapped = snapToGrid(rawMins);

      if (edge === "left") {
        setDragOpen((prev) =>
          snapped < closeMins - SNAP_MINUTES ? snapped : prev
        );
      } else {
        setDragClose((prev) =>
          snapped > openMins + SNAP_MINUTES ? snapped : prev
        );
      }
    }

    function handleMouseUp() {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);

      if (!moved) {
        // Click without drag — show popover
        setEdgePopover({ edge });
        return;
      }

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

  // ── Interior drag for tier selection ──────────────────────────────
  function startTierDrag(e: ReactMouseEvent) {
    // Don't interfere with edge handles or tier clicks
    e.stopPropagation();
    setEdgePopover(null);

    const startMins = mouseToMinutes(e.clientX);
    let moved = false;

    function handleMouseMove(ev: globalThis.MouseEvent) {
      moved = true;
      const currentMins = mouseToMinutes(ev.clientX);
      setTierDrag({
        startMins: Math.min(startMins, currentMins),
        endMins: Math.max(startMins, currentMins),
      });
    }

    function handleMouseUp(ev: globalThis.MouseEvent) {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);

      if (!moved) {
        setTierDrag(null);
        return;
      }

      const endMins = mouseToMinutes(ev.clientX);
      const finalStart = Math.min(startMins, endMins);
      const finalEnd = Math.max(startMins, endMins);

      setTierDrag(null);

      if (finalEnd - finalStart >= SNAP_MINUTES) {
        onTierDragComplete(finalStart, finalEnd);
      }
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  // Close popover on outside click (use 'click' not 'mousedown' so
  // buttons inside the popover can fire their onClick before it closes)
  useEffect(() => {
    if (!edgePopover) return;
    function handleClick(ev: globalThis.MouseEvent) {
      // Let clicks inside the popover through
      const target = ev.target as HTMLElement;
      if (target.closest("[data-edge-popover]")) return;
      setEdgePopover(null);
    }
    // Delay listener to avoid the same click that opened the popover
    const id = requestAnimationFrame(() => {
      document.addEventListener("click", handleClick);
    });
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("click", handleClick);
    };
  }, [edgePopover]);

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
          onChange={() => onCheckboxToggle()}
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
          <>
          {/* Active bar */}
          <div
            ref={barRef}
            className={`absolute top-1.5 h-7 rounded-md transition-colors ${
              isSelected
                ? "bg-blue-500 dark:bg-blue-600"
                : "bg-blue-400/70 dark:bg-blue-500/50"
            }`}
            style={{
              left: `${minutesToPercent(displayOpen)}%`,
              width: `${minutesToPercent(displayClose) - minutesToPercent(displayOpen)}%`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Default rate labels in gaps between tiers */}
            {(() => {
              if (rateTiers.length === 0) {
                // No tiers — show default rate centered
                return (
                  <div className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center select-none">
                    <span className="text-[9px] font-medium text-white/70">
                      ${(defaultRate / 100).toFixed(0)}/hr
                    </span>
                  </div>
                );
              }
              // Build gap segments
              const sorted = [...rateTiers]
                .map((t) => ({ start: timeToMinutes(t.start_time), end: timeToMinutes(t.end_time) }))
                .sort((a, b) => a.start - b.start);
              const gaps: { start: number; end: number }[] = [];
              let cursor = displayOpen;
              for (const t of sorted) {
                if (t.start > cursor) gaps.push({ start: cursor, end: t.start });
                cursor = Math.max(cursor, t.end);
              }
              if (cursor < displayClose) gaps.push({ start: cursor, end: displayClose });
              return gaps.map((gap, i) => {
                const leftPct = minsToBarPercent(gap.start);
                const widthPct = minsToBarPercent(gap.end) - leftPct;
                if (widthPct < 6) return null;
                return (
                  <div
                    key={`gap-${i}`}
                    className="pointer-events-none absolute top-0 z-[3] flex h-full items-center justify-center select-none"
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  >
                    <span className="text-[9px] font-medium text-white/70">
                      ${(defaultRate / 100).toFixed(0)}/hr
                    </span>
                  </div>
                );
              });
            })()}

            {/* Rate tier & block-out segments */}
            {rateTiers.map((tier, idx) => {
              const tierStart = timeToMinutes(tier.start_time);
              const tierEnd = timeToMinutes(tier.end_time);
              const leftPct = minsToBarPercent(tierStart);
              const widthPct = minsToBarPercent(tierEnd) - leftPct;
              const isEditing = editingTierIndex === idx;
              const isBlockout = tier.type === "blockout";

              if (isBlockout) {
                // Block-out: grey with diagonal stripes + circle-cross icon
                return (
                  <div
                    key={idx}
                    className={`absolute top-0 h-full cursor-pointer overflow-hidden rounded-sm transition-colors ${
                      isEditing ? "ring-2 ring-amber-400" : ""
                    }`}
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      backgroundColor: "#9ca3af",
                      backgroundImage:
                        "repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(255,255,255,0.2) 3px, rgba(255,255,255,0.2) 5px)",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTierClick(idx);
                    }}
                    title="Block-out"
                  >
                    <div className="flex h-full items-center justify-center select-none">
                      <Ban className="h-3 w-3 text-white/80 drop-shadow-sm" />
                    </div>
                    <div className="absolute left-0 top-1 bottom-1 w-px bg-white/30" />
                    <div className="absolute right-0 top-1 bottom-1 w-px bg-white/30" />
                  </div>
                );
              }

              // Rate tier: shade by price level
              const ratio = defaultRate > 0 ? tier.hourly_rate_cents / defaultRate : 1;
              const lightness = isEditing
                ? undefined
                : Math.max(25, Math.min(70, 65 - (ratio - 0.5) * 25));

              return (
                <div
                  key={idx}
                  className={`absolute top-0 h-full cursor-pointer transition-colors ${
                    isEditing
                      ? "bg-amber-400/80 dark:bg-amber-500/70"
                      : ""
                  }`}
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    ...(!isEditing ? { backgroundColor: `hsl(220, 70%, ${lightness}%)` } : {}),
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTierClick(idx);
                  }}
                  title={`$${(tier.hourly_rate_cents / 100).toFixed(2)}/hr`}
                >
                  {/* Rate label */}
                  {widthPct > 6 && (
                    <div className="flex h-full items-center justify-center select-none">
                      <span className="text-[9px] font-bold text-white drop-shadow-sm">
                        ${(tier.hourly_rate_cents / 100).toFixed(0)}/hr
                      </span>
                    </div>
                  )}
                  {widthPct <= 6 && (
                    <div className="flex h-full items-center justify-center select-none">
                      <span className="text-[8px] font-bold text-white drop-shadow-sm">
                        ${(tier.hourly_rate_cents / 100).toFixed(0)}
                      </span>
                    </div>
                  )}
                  {/* Left/right borders for tier segment */}
                  <div className="absolute left-0 top-1 bottom-1 w-px bg-white/50" />
                  <div className="absolute right-0 top-1 bottom-1 w-px bg-white/50" />
                </div>
              );
            })}

            {/* Interior drag area (for tier creation) */}
            <div
              className="absolute inset-0 z-10 cursor-crosshair"
              onMouseDown={startTierDrag}
            />

            {/* Tier drag-in-progress overlay */}
            {tierDrag && (
              <div
                className="pointer-events-none absolute top-0 z-20 h-full rounded bg-amber-400/50 dark:bg-amber-300/40"
                style={{
                  left: `${minsToBarPercent(tierDrag.startMins)}%`,
                  width: `${minsToBarPercent(tierDrag.endMins) - minsToBarPercent(tierDrag.startMins)}%`,
                }}
              >
                <div className="flex h-full items-center justify-center">
                  <span className="text-[9px] font-medium text-white drop-shadow">
                    {formatTimeShort(minutesToTime(tierDrag.startMins))} –{" "}
                    {formatTimeShort(minutesToTime(tierDrag.endMins))}
                  </span>
                </div>
              </div>
            )}

            {/* Persistent yellow tier selection overlay (when form is open) */}
            {tierSelection && isSelected && !tierDrag && (() => {
              const selStartMins = timeToMinutes(tierSelection.startTime);
              const selEndMins = timeToMinutes(tierSelection.endTime);
              // Clamp to bar range
              const clampedStart = Math.max(displayOpen, Math.min(displayClose, selStartMins));
              const clampedEnd = Math.max(displayOpen, Math.min(displayClose, selEndMins));
              if (clampedEnd <= clampedStart) return null;
              const leftPct = minsToBarPercent(clampedStart);
              const widthPct = minsToBarPercent(clampedEnd) - leftPct;

              return (
                <div
                  className="absolute top-0 z-20 h-full rounded bg-amber-400/60 dark:bg-amber-300/50"
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                >
                  <div className="pointer-events-none flex h-full items-center justify-center select-none">
                    <span className="text-[9px] font-bold text-white drop-shadow-sm">
                      {formatTimeShort(tierSelection.startTime)} – {formatTimeShort(tierSelection.endTime)}
                    </span>
                  </div>
                  {/* Left drag handle for tier selection */}
                  <div
                    className="absolute -left-1 top-0 z-30 flex h-full w-3 cursor-col-resize items-center justify-center"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      const track = trackRef.current;
                      if (!track) return;
                      function handleMove(ev: globalThis.MouseEvent) {
                        if (!track) return;
                        const rect = track.getBoundingClientRect();
                        const pct = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
                        const snapped = snapToGrid(percentToMinutes(pct));
                        const clamped = Math.max(openMins, Math.min(selEndMins - SNAP_MINUTES, snapped));
                        if (tierSelection) onSetTierSelection({ startTime: minutesToTime(clamped), endTime: tierSelection.endTime });
                      }
                      function handleUp() {
                        document.removeEventListener("mousemove", handleMove);
                        document.removeEventListener("mouseup", handleUp);
                      }
                      document.addEventListener("mousemove", handleMove);
                      document.addEventListener("mouseup", handleUp);
                    }}
                  >
                    <div className="h-4 w-1 rounded-full bg-white/80" />
                  </div>
                  {/* Right drag handle for tier selection */}
                  <div
                    className="absolute -right-1 top-0 z-30 flex h-full w-3 cursor-col-resize items-center justify-center"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      const track = trackRef.current;
                      if (!track) return;
                      function handleMove(ev: globalThis.MouseEvent) {
                        if (!track) return;
                        const rect = track.getBoundingClientRect();
                        const pct = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
                        const snapped = snapToGrid(percentToMinutes(pct));
                        const clamped = Math.min(closeMins, Math.max(selStartMins + SNAP_MINUTES, snapped));
                        if (tierSelection) onSetTierSelection({ startTime: tierSelection.startTime, endTime: minutesToTime(clamped) });
                      }
                      function handleUp() {
                        document.removeEventListener("mousemove", handleMove);
                        document.removeEventListener("mouseup", handleUp);
                      }
                      document.addEventListener("mousemove", handleMove);
                      document.addEventListener("mouseup", handleUp);
                    }}
                  >
                    <div className="h-4 w-1 rounded-full bg-white/80" />
                  </div>
                </div>
              );
            })()}

            {/* Left drag handle */}
            <div
              className="absolute -left-1 top-0 z-30 flex h-full w-3 cursor-col-resize items-center justify-center"
              onMouseDown={(e) => startEdgeDrag("left", e)}
            >
              <div className="h-4 w-1 rounded-full bg-white/60" />
            </div>

            {/* Right drag handle */}
            <div
              className="absolute -right-1 top-0 z-30 flex h-full w-3 cursor-col-resize items-center justify-center"
              onMouseDown={(e) => startEdgeDrag("right", e)}
            >
              <div className="h-4 w-1 rounded-full bg-white/60" />
            </div>

            {/* Edge click popover */}
            {edgePopover && (
              <div
                data-edge-popover
                className={`absolute top-full z-40 mt-1 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-gray-900 ${
                  edgePopover.edge === "left" ? "left-0" : "right-0"
                }`}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.05]"
                  onClick={() => {
                    setEdgePopover(null);
                    // Just dismiss — user drags edge next time
                  }}
                >
                  Drag to adjust hours
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
                  onClick={() => {
                    setEdgePopover(null);
                    // 2hr default tier from edge, capped at available space
                    const tierStart =
                      edgePopover.edge === "left"
                        ? openMins
                        : Math.max(openMins, closeMins - 120);
                    const tierEnd =
                      edgePopover.edge === "left"
                        ? Math.min(closeMins, openMins + 120)
                        : closeMins;
                    onTierDragComplete(tierStart, tierEnd);
                  }}
                >
                  Create Rate Tier
                </button>
              </div>
            )}
          </div>
          {/* Start/end time labels — outside the bar */}
          <div
            className="pointer-events-none absolute top-1.5 z-[1] flex h-7 items-center justify-end select-none"
            style={{ left: 0, width: `${minutesToPercent(displayOpen)}%` }}
          >
            <span className="pr-1 text-[10px] font-medium text-gray-500 dark:text-gray-400">
              {formatTimeShort(minutesToTime(displayOpen))}
            </span>
          </div>
          <div
            className="pointer-events-none absolute top-1.5 z-[1] flex h-7 items-center select-none"
            style={{ left: `${minutesToPercent(displayClose)}%` }}
          >
            <span className="pl-1 text-[10px] font-medium text-gray-500 dark:text-gray-400">
              {formatTimeShort(minutesToTime(displayClose))}
            </span>
          </div>
          </>
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

// ─── Price Input Component ───────────────────────────────────────────────────

function PriceInput({
  value,
  onChange,
  defaultRate,
}: {
  value: number; // cents
  onChange: (cents: number) => void;
  defaultRate: number; // cents
}) {
  const [focused, setFocused] = useState(false);
  const [rawValue, setRawValue] = useState("");

  const displayValue = focused
    ? rawValue
    : (value / 100).toFixed(2);

  return (
    <div className="relative">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">
        $
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={displayValue}
        placeholder={(defaultRate / 100).toFixed(2)}
        onFocus={() => {
          setFocused(true);
          setRawValue("");
        }}
        onBlur={() => {
          setFocused(false);
          if (rawValue !== "") {
            const parsed = parseFloat(rawValue);
            if (!isNaN(parsed) && parsed >= 0) {
              onChange(Math.round(parsed * 100));
            }
          }
        }}
        onChange={(e) => {
          const v = e.target.value.replace(/[^0-9.]/g, "");
          setRawValue(v);
          const parsed = parseFloat(v);
          if (!isNaN(parsed) && parsed >= 0) {
            onChange(Math.round(parsed * 100));
          }
        }}
        className="h-9 w-full rounded-lg border border-gray-300 bg-white pl-6 pr-8 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white/90 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">
        /hr
      </span>
    </div>
  );
}

// ─── Rate Tier Editor Component (below timeline) ────────────────────────────

function RateTierEditor({
  bayRulesMap,
  selectedDays,
  defaultRate,
  tierSelection,
  editingTierIndex,
  tierToast,
  tiersIdentical,
  tierCreateMode,
  onSetTierSelection,
  onSetEditingTierIndex,
  onSetTierCreateMode,
  onApplyTier,
  onUpdateTier,
  onDeleteTier,
}: {
  bayRulesMap: Map<number, Rule>;
  selectedDays: Set<number>;
  defaultRate: number;
  tierSelection: TierSelection;
  editingTierIndex: number | null;
  tierToast: string | null;
  tiersIdentical: boolean;
  tierCreateMode: "rate" | "blockout";
  onSetTierSelection: (s: TierSelection) => void;
  onSetEditingTierIndex: (i: number | null) => void;
  onSetTierCreateMode: (m: "rate" | "blockout") => void;
  onApplyTier: (tier: RateTier) => void;
  onUpdateTier: (index: number, updates: Partial<RateTier>) => void;
  onDeleteTier: (index: number) => void;
}) {
  const selectedRules = Array.from(selectedDays)
    .map((d) => bayRulesMap.get(d))
    .filter(Boolean) as Rule[];

  // New tier form state — start/end read from tierSelection (two-way sync)
  const [newTierRate, setNewTierRate] = useState(defaultRate);

  // Reset rate when a new tierSelection appears
  const prevSelectionRef = useRef(tierSelection);
  useEffect(() => {
    if (tierSelection && !prevSelectionRef.current) {
      setNewTierRate(defaultRate);
    }
    prevSelectionRef.current = tierSelection;
  }, [tierSelection, defaultRate]);

  // Get tiers for display (from first selected day, since we only show when identical)
  const displayTiers =
    tiersIdentical && selectedRules.length > 0
      ? selectedRules[0].rate_tiers || []
      : null;

  const isCreating = tierSelection !== null;
  const canEditTiers = selectedDays.size === 1 || tiersIdentical;

  return (
    <div className="mt-4 space-y-3">
      {/* Inline toast */}
      {tierToast && (
        <div
          className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm ${
            tierToast.includes("cannot")
              ? "border border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400"
              : "border border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400"
          }`}
        >
          {tierToast.includes("cannot") ? (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          )}
          {tierToast}
        </div>
      )}

      {/* Existing tiers & block-outs */}
      {displayTiers !== null && displayTiers.length > 0 && (
        <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4 dark:border-white/[0.04] dark:bg-white/[0.02]">
          <div className="mb-2 flex items-center gap-1.5">
            <DollarSign className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
              Rate Tiers & Block-outs
            </span>
          </div>
          <div className="space-y-2">
            {displayTiers.map((tier, idx) => {
              const isEditing = editingTierIndex === idx;
              const isBlockout = tier.type === "blockout";

              if (isBlockout) {
                return (
                  <div
                    key={idx}
                    className={`rounded-lg border p-3 transition-colors ${
                      isEditing
                        ? "border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-950/20"
                        : "border-gray-300 bg-gray-100 dark:border-white/10 dark:bg-white/[0.06]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Ban className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                      <div className="flex flex-1 items-center gap-2">
                        <input
                          type="time"
                          value={tier.start_time}
                          disabled={!canEditTiers}
                          onChange={(e) =>
                            onUpdateTier(idx, { start_time: e.target.value })
                          }
                          className="h-8 rounded border border-gray-300 bg-white px-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/90"
                        />
                        <span className="text-xs text-gray-400">to</span>
                        <input
                          type="time"
                          value={tier.end_time}
                          disabled={!canEditTiers}
                          onChange={(e) =>
                            onUpdateTier(idx, { end_time: e.target.value })
                          }
                          className="h-8 rounded border border-gray-300 bg-white px-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/90"
                        />
                        <span className="text-xs font-medium text-gray-500">
                          Block-out
                        </span>
                      </div>
                      {canEditTiers && (
                        <button
                          type="button"
                          onClick={() => onDeleteTier(idx)}
                          className="shrink-0 rounded p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={idx}
                  className={`rounded-lg border p-3 transition-colors ${
                    isEditing
                      ? "border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-950/20"
                      : "border-gray-200 bg-white dark:border-white/[0.06] dark:bg-white/[0.04]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex flex-1 items-center gap-2">
                      <input
                        type="time"
                        value={tier.start_time}
                        disabled={!canEditTiers}
                        onChange={(e) =>
                          onUpdateTier(idx, { start_time: e.target.value })
                        }
                        className="h-8 rounded border border-gray-300 bg-white px-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/90"
                      />
                      <span className="text-xs text-gray-400">to</span>
                      <input
                        type="time"
                        value={tier.end_time}
                        disabled={!canEditTiers}
                        onChange={(e) =>
                          onUpdateTier(idx, { end_time: e.target.value })
                        }
                        className="h-8 rounded border border-gray-300 bg-white px-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/90"
                      />
                      <span className="text-xs text-gray-400">@</span>
                      <div className="w-28">
                        {canEditTiers ? (
                          <PriceInput
                            value={tier.hourly_rate_cents}
                            onChange={(cents) =>
                              onUpdateTier(idx, {
                                hourly_rate_cents: cents,
                              })
                            }
                            defaultRate={defaultRate}
                          />
                        ) : (
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            ${(tier.hourly_rate_cents / 100).toFixed(2)}/hr
                          </span>
                        )}
                      </div>
                    </div>
                    {canEditTiers && (
                      <button
                        type="button"
                        onClick={() => onDeleteTier(idx)}
                        className="shrink-0 rounded p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {isEditing && (
                    <p className="mt-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                      Editing — click on bar or change values above
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Non-identical multi-select warning */}
      {!tiersIdentical && selectedDays.size > 1 && (
        <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4 dark:border-white/[0.04] dark:bg-white/[0.02]">
          <p className="text-xs text-gray-400 italic dark:text-gray-500">
            Selected days have different rate tiers. Select a single day to
            edit, or drag on a bar to add a new tier to all selected days.
          </p>
        </div>
      )}

      {/* No tiers yet */}
      {displayTiers !== null && displayTiers.length === 0 && !isCreating && (
        <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4 dark:border-white/[0.04] dark:bg-white/[0.02]">
          <div className="mb-1 flex items-center gap-1.5">
            <DollarSign className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
              Pricing
            </span>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Default rate: ${(defaultRate / 100).toFixed(2)}/hr — drag on a bar
            to create a rate tier
          </p>
        </div>
      )}

      {/* New tier/block-out creation form */}
      {isCreating && (
        <div className="space-y-3">
          {/* Option cards — clickable to switch mode */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onSetTierCreateMode("rate")}
              className={`flex-1 rounded-lg border-2 p-3 text-left transition-colors ${
                tierCreateMode === "rate"
                  ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/20"
                  : "border-gray-200 bg-white hover:border-gray-300 dark:border-white/[0.06] dark:bg-white/[0.02]"
              }`}
            >
              <div className="flex items-center gap-2">
                <DollarSign className={`h-4 w-4 ${tierCreateMode === "rate" ? "text-blue-600 dark:text-blue-400" : "text-gray-400"}`} />
                <span className={`text-sm font-medium ${tierCreateMode === "rate" ? "text-blue-700 dark:text-blue-400" : "text-gray-500"}`}>
                  Rate Tier
                </span>
              </div>
              <p className={`mt-0.5 text-[10px] ${tierCreateMode === "rate" ? "text-blue-600/70 dark:text-blue-400/60" : "text-gray-400"}`}>
                Custom pricing for this time range
              </p>
            </button>
            <button
              type="button"
              onClick={() => onSetTierCreateMode("blockout")}
              className={`flex-1 rounded-lg border-2 p-3 text-left transition-colors ${
                tierCreateMode === "blockout"
                  ? "border-gray-500 bg-gray-50 dark:border-gray-400 dark:bg-gray-900/30"
                  : "border-gray-200 bg-white hover:border-gray-300 dark:border-white/[0.06] dark:bg-white/[0.02]"
              }`}
            >
              <div className="flex items-center gap-2">
                <Ban className={`h-4 w-4 ${tierCreateMode === "blockout" ? "text-gray-600 dark:text-gray-400" : "text-gray-400"}`} />
                <span className={`text-sm font-medium ${tierCreateMode === "blockout" ? "text-gray-700 dark:text-gray-300" : "text-gray-500"}`}>
                  Block-out
                </span>
              </div>
              <p className={`mt-0.5 text-[10px] ${tierCreateMode === "blockout" ? "text-gray-500 dark:text-gray-400" : "text-gray-400"}`}>
                Block this time range from booking
              </p>
            </button>
          </div>

          {/* Creation form */}
          <div className={`rounded-lg border bg-white p-4 dark:bg-white/[0.03] ${
            tierCreateMode === "blockout"
              ? "border-gray-300 dark:border-gray-700"
              : "border-blue-200 dark:border-blue-800/50"
          }`}>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={tierSelection?.startTime || ""}
                    onChange={(e) =>
                      tierSelection && onSetTierSelection({ ...tierSelection, startTime: e.target.value })
                    }
                    className="flex h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white/90"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    End Time
                  </label>
                  <input
                    type="time"
                    value={tierSelection?.endTime || ""}
                    onChange={(e) =>
                      tierSelection && onSetTierSelection({ ...tierSelection, endTime: e.target.value })
                    }
                    className="flex h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none dark:border-white/10 dark:bg-white/[0.05] dark:text-white/90"
                  />
                </div>
              </div>
              {tierCreateMode === "rate" && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    Hourly Rate
                  </label>
                  <PriceInput
                    value={newTierRate}
                    onChange={setNewTierRate}
                    defaultRate={defaultRate}
                  />
                </div>
              )}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className={`gap-1.5 ${
                    tierCreateMode === "blockout"
                      ? "bg-gray-600 hover:bg-gray-700 dark:bg-gray-500 dark:hover:bg-gray-600"
                      : ""
                  }`}
                  onClick={() => {
                    if (!tierSelection?.startTime || !tierSelection?.endTime) return;
                    if (tierCreateMode === "blockout") {
                      onApplyTier({
                        type: "blockout",
                        start_time: tierSelection.startTime,
                        end_time: tierSelection.endTime,
                        hourly_rate_cents: 0,
                      });
                    } else {
                      onApplyTier({
                        type: "rate",
                        start_time: tierSelection.startTime,
                        end_time: tierSelection.endTime,
                        hourly_rate_cents: newTierRate,
                      });
                    }
                  }}
                >
                  {tierCreateMode === "blockout" ? (
                    <>
                      <Ban className="h-3.5 w-3.5" />
                      Apply Block-out
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Apply Rate Tier
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onSetTierSelection(null);
                    onSetTierCreateMode("rate");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
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

  // ── Local form state for pending changes ─────────────────────────
  // Track which fields user has explicitly modified
  const [localBuffer, setLocalBuffer] = useState<string>("");
  const [localGranularity, setLocalGranularity] = useState<string>("");
  const [localDurations, setLocalDurations] = useState<number[] | null>(null);
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
      setHasLocalChanges(false);
    }
  }, [selectionKey]);

  // Display values: local override → shared value → "Mixed"
  const displayBuffer = localBuffer !== "" ? localBuffer : sharedBuffer.mixed ? "" : String(sharedBuffer.value);
  const displayGranularity = localGranularity !== "" ? localGranularity : sharedGranularity.mixed ? "" : String(sharedGranularity.value);
  const displayDurations = localDurations !== null ? localDurations : sharedDurations.mixed ? null : (sharedDurations.value as number[]);

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

      if (Object.keys(updates).length > 0) {
        onUpdateRule(dayOfWeek, updates);
      }
    }

    // Reset local state
    setLocalBuffer("");
    setLocalGranularity("");
    setLocalDurations(null);
    setHasLocalChanges(false);
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
                  setHasLocalChanges(true);
                  // Also update open/close times and rate tiers for all selected days
                  for (const dayOfWeek of selectedDays) {
                    onUpdateRule(dayOfWeek, {
                      open_time: sourceRule.open_time,
                      close_time: sourceRule.close_time,
                      rate_tiers: sourceRule.rate_tiers
                        ? sourceRule.rate_tiers.map((t) => ({ ...t }))
                        : null,
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
              Default Rate
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
