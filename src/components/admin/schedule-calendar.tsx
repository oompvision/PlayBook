"use client";

import { useState, useRef, useCallback, useMemo, useEffect, Fragment } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  startOfMonth,
  endOfMonth,
  addMonths,
  eachDayOfInterval,
  getDay,
  format,
} from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  X,
  CalendarDays,
  Check,
  ChevronUp,
  LayoutTemplate,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Pencil,
} from "lucide-react";
import { ScheduleDayDrawer } from "@/components/admin/schedule-day-drawer";

// ─── Types ───────────────────────────────────────────────────────

type MonthData = {
  key: string; // "2026-03"
  label: string; // "March 2026"
  shortLabel: string; // "Mar" or "Mar '27"
  days: string[]; // ["2026-03-01", ...]
  weeks: string[][]; // grouped into week rows, padded with ""
  selectableDates: string[];
  weekdayDates: string[];
  weekendDates: string[];
  dayOfWeekDates: Record<number, string[]>; // 0-6 → dates
};

type TemplateInfo = {
  id: string;
  name: string;
  slotCount: number;
};

type BayInfo = {
  id: string;
  name: string;
  hourly_rate_cents: number;
};

type ApplyResult = {
  success: boolean;
  count: number;
  error?: string;
};

type ScheduleCalendarProps = {
  today: string;
  totalBays: number;
  coverageMap: Record<string, number>;
  templates: TemplateInfo[];
  bays: BayInfo[];
  orgId: string;
  timezone: string;
  onApplyTemplate: (
    templateId: string,
    bayIds: string[],
    dates: string[]
  ) => Promise<ApplyResult>;
};

// ─── Constants ───────────────────────────────────────────────────

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ─── Helpers ─────────────────────────────────────────────────────

function isPast(dateStr: string, today: string): boolean {
  return dateStr < today;
}

function generateMonths(today: string): MonthData[] {
  const todayDate = new Date(today + "T12:00:00");
  const baseYear = todayDate.getFullYear();
  const result: MonthData[] = [];

  for (let i = 0; i < 13; i++) {
    const monthStart = startOfMonth(addMonths(todayDate, i));
    const monthEnd = endOfMonth(monthStart);
    const allDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const days = allDays.map((d) => format(d, "yyyy-MM-dd"));
    const startDow = getDay(monthStart);

    // Build week rows
    const weeks: string[][] = [];
    let currentWeek: string[] = Array(startDow).fill("");
    for (const day of days) {
      currentWeek.push(day);
      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) currentWeek.push("");
      weeks.push(currentWeek);
    }

    // Pre-compute selectable sets
    const selectableDates = days.filter((d) => d >= today);
    const weekdayDates = selectableDates.filter((d) => {
      const dow = getDay(new Date(d + "T12:00:00"));
      return dow >= 1 && dow <= 5;
    });
    const weekendDates = selectableDates.filter((d) => {
      const dow = getDay(new Date(d + "T12:00:00"));
      return dow === 0 || dow === 6;
    });
    const dayOfWeekDates: Record<number, string[]> = {};
    for (let dow = 0; dow < 7; dow++) {
      dayOfWeekDates[dow] = selectableDates.filter(
        (d) => getDay(new Date(d + "T12:00:00")) === dow
      );
    }

    const year = monthStart.getFullYear();
    const shortLabel =
      year !== baseYear
        ? format(monthStart, "MMM ''yy")
        : format(monthStart, "MMM");

    result.push({
      key: format(monthStart, "yyyy-MM"),
      label: format(monthStart, "MMMM yyyy"),
      shortLabel,
      days,
      weeks,
      selectableDates,
      weekdayDates,
      weekendDates,
      dayOfWeekDates,
    });
  }

  return result;
}

function formatDateRangeSummary(dates: string[]): string {
  if (dates.length === 0) return "";

  const sorted = [...dates].sort();
  const ranges: { start: string; end: string }[] = [];
  let rangeStart = sorted[0];
  let rangeEnd = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const prevDate = new Date(rangeEnd + "T12:00:00");
    prevDate.setDate(prevDate.getDate() + 1);
    const expectedNext = format(prevDate, "yyyy-MM-dd");

    if (sorted[i] === expectedNext) {
      rangeEnd = sorted[i];
    } else {
      ranges.push({ start: rangeStart, end: rangeEnd });
      rangeStart = sorted[i];
      rangeEnd = sorted[i];
    }
  }
  ranges.push({ start: rangeStart, end: rangeEnd });

  const parts = ranges.slice(0, 5).map((r) => {
    const s = new Date(r.start + "T12:00:00");
    const e = new Date(r.end + "T12:00:00");
    const sMonth = format(s, "MMM");
    const sDay = s.getDate();

    if (r.start === r.end) {
      return `${sMonth} ${sDay}`;
    }
    const eMonth = format(e, "MMM");
    const eDay = e.getDate();
    if (sMonth === eMonth) {
      return `${sMonth} ${sDay}–${eDay}`;
    }
    return `${sMonth} ${sDay} – ${eMonth} ${eDay}`;
  });

  if (ranges.length > 5) {
    parts.push(`+${ranges.length - 5} more`);
  }

  return parts.join(", ");
}

// ─── Component ───────────────────────────────────────────────────

export function ScheduleCalendar({
  today,
  totalBays,
  coverageMap,
  templates,
  bays,
  orgId,
  timezone,
  onApplyTemplate,
}: ScheduleCalendarProps) {
  // --- Data ---
  const months = useMemo(() => generateMonths(today), [today]);
  const allDatesFlat = useMemo(() => months.flatMap((m) => m.days), [months]);
  const router = useRouter();

  // --- State ---
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragEnd, setDragEnd] = useState<string | null>(null);
  const [dragMode, setDragMode] = useState<"add" | "remove">("add");
  const [lastClickedDate, setLastClickedDate] = useState<string | null>(null);
  const [visibleMonths, setVisibleMonths] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);

  // --- Apply Template Panel State ---
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedBayIds, setSelectedBayIds] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);

  useEffect(() => setMounted(true), []);

  // --- Drag preview computation ---
  const dragPreviewDates = useMemo(() => {
    if (!isDragging || !dragStart || !dragEnd) return new Set<string>();
    const startIdx = allDatesFlat.indexOf(dragStart);
    const endIdx = allDatesFlat.indexOf(dragEnd);
    if (startIdx === -1 || endIdx === -1) return new Set<string>();
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    const result = new Set<string>();
    for (let i = lo; i <= hi; i++) {
      if (!isPast(allDatesFlat[i], today)) {
        result.add(allDatesFlat[i]);
      }
    }
    return result;
  }, [isDragging, dragStart, dragEnd, allDatesFlat, today]);

  // --- Ref for stable global mouseup handler ---
  const dragStateRef = useRef({
    isDragging,
    dragPreviewDates,
    dragMode,
  });
  useEffect(() => {
    dragStateRef.current = { isDragging, dragPreviewDates, dragMode };
  });

  // --- Global mouseup listener ---
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      const { isDragging: dragging, dragPreviewDates: preview, dragMode: mode } =
        dragStateRef.current;
      if (!dragging) return;

      setSelectedDates((prev) => {
        const next = new Set(prev);
        for (const d of preview) {
          if (mode === "add") next.add(d);
          else next.delete(d);
        }
        return next;
      });
      setIsDragging(false);
      setDragStart(null);
      setDragEnd(null);
    };

    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, []);

  // --- Prevent text selection during drag ---
  useEffect(() => {
    if (isDragging) {
      document.body.style.userSelect = "none";
    } else {
      document.body.style.userSelect = "";
    }
    return () => {
      document.body.style.userSelect = "";
    };
  }, [isDragging]);

  // --- Selection helpers ---
  const toggleDates = useCallback(
    (dates: string[], forceMode?: "add" | "remove") => {
      setSelectedDates((prev) => {
        const next = new Set(prev);
        const mode =
          forceMode ||
          (dates.length > 0 && dates.every((d) => prev.has(d))
            ? "remove"
            : "add");
        for (const d of dates) {
          if (mode === "add") next.add(d);
          else next.delete(d);
        }
        return next;
      });
    },
    []
  );

  const clearSelection = useCallback(() => {
    setSelectedDates(new Set());
    setPanelOpen(false);
    setApplyResult(null);
  }, []);

  // --- Apply Template Panel Handlers ---
  const openPanel = useCallback(() => {
    setPanelOpen(true);
    setSelectedTemplateId("");
    setSelectedBayIds(new Set(bays.map((b) => b.id)));
    setApplyResult(null);
  }, [bays]);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setApplyResult(null);
  }, []);

  const toggleBay = useCallback((bayId: string) => {
    setSelectedBayIds((prev) => {
      const next = new Set(prev);
      if (next.has(bayId)) next.delete(bayId);
      else next.add(bayId);
      return next;
    });
  }, []);

  const toggleAllBays = useCallback(() => {
    setSelectedBayIds((prev) => {
      if (prev.size === bays.length) return new Set();
      return new Set(bays.map((b) => b.id));
    });
  }, [bays]);

  const handleApply = useCallback(async () => {
    if (!selectedTemplateId || selectedBayIds.size === 0 || selectedDates.size === 0) return;
    setApplying(true);
    setApplyResult(null);
    try {
      const result = await onApplyTemplate(
        selectedTemplateId,
        Array.from(selectedBayIds),
        Array.from(selectedDates)
      );
      setApplyResult(result);
      if (result.success) {
        // Brief delay to show success, then close panel and clear selection
        setTimeout(() => {
          setPanelOpen(false);
          setSelectedDates(new Set());
          setApplyResult(null);
        }, 1500);
      }
    } catch {
      setApplyResult({ success: false, count: 0, error: "An unexpected error occurred" });
    } finally {
      setApplying(false);
    }
  }, [selectedTemplateId, selectedBayIds, selectedDates, onApplyTemplate]);

  // --- Mouse handlers for day cells ---
  const handleMouseDown = useCallback(
    (dateStr: string, e: React.MouseEvent) => {
      if (isPast(dateStr, today)) return;

      // Shift+click: range select
      if (e.shiftKey && lastClickedDate) {
        const startIdx = allDatesFlat.indexOf(lastClickedDate);
        const endIdx = allDatesFlat.indexOf(dateStr);
        if (startIdx !== -1 && endIdx !== -1) {
          const lo = Math.min(startIdx, endIdx);
          const hi = Math.max(startIdx, endIdx);
          const rangeDates: string[] = [];
          for (let i = lo; i <= hi; i++) {
            if (!isPast(allDatesFlat[i], today)) {
              rangeDates.push(allDatesFlat[i]);
            }
          }
          toggleDates(rangeDates, "add");
        }
        setLastClickedDate(dateStr);
        return;
      }

      // Start drag
      e.preventDefault();
      setIsDragging(true);
      setDragStart(dateStr);
      setDragEnd(dateStr);
      setDragMode(selectedDates.has(dateStr) ? "remove" : "add");
      setLastClickedDate(dateStr);
    },
    [today, lastClickedDate, allDatesFlat, toggleDates, selectedDates]
  );

  const handleMouseEnter = useCallback(
    (dateStr: string) => {
      if (isDragging) {
        setDragEnd(dateStr);
      }
    },
    [isDragging]
  );

  // --- Week row select ---
  const handleWeekRowSelect = useCallback(
    (weekDates: string[]) => {
      const selectable = weekDates.filter(
        (d) => d !== "" && !isPast(d, today)
      );
      if (selectable.length === 0) return;
      toggleDates(selectable);
    },
    [today, toggleDates]
  );

  // --- Day-of-week column select ---
  const handleDowSelect = useCallback(
    (month: MonthData, dowIndex: number) => {
      const dates = month.dayOfWeekDates[dowIndex];
      if (dates.length === 0) return;
      toggleDates(dates);
    },
    [toggleDates]
  );

  // --- Month quick actions ---
  const handleMonthSelectAll = useCallback(
    (month: MonthData) => {
      toggleDates(month.selectableDates);
    },
    [toggleDates]
  );

  const handleMonthWeekdays = useCallback(
    (month: MonthData) => {
      toggleDates(month.weekdayDates);
    },
    [toggleDates]
  );

  const handleMonthWeekends = useCallback(
    (month: MonthData) => {
      toggleDates(month.weekendDates);
    },
    [toggleDates]
  );

  // --- Month filter ---
  const handleMonthChipClick = useCallback(
    (key: string) => {
      setVisibleMonths((prev) => {
        // All visible → filter to just this month
        if (prev.size === 0) {
          return new Set([key]);
        }
        // Only this month visible → reset to all
        if (prev.size === 1 && prev.has(key)) {
          return new Set();
        }
        // Toggle this month
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });
    },
    []
  );

  const showAllMonths = useCallback(() => {
    setVisibleMonths(new Set());
  }, []);

  // --- Derived ---
  const filteredMonths = useMemo(
    () =>
      visibleMonths.size === 0
        ? months
        : months.filter((m) => visibleMonths.has(m.key)),
    [months, visibleMonths]
  );

  const selectedCount = selectedDates.size;
  const selectedArray = useMemo(
    () => Array.from(selectedDates).sort(),
    [selectedDates]
  );

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
  const scheduleCount = selectedCount * selectedBayIds.size;
  const canApply =
    selectedCount > 0 &&
    selectedBayIds.size > 0 &&
    !!selectedTemplateId &&
    selectedTemplate &&
    selectedTemplate.slotCount > 0;

  // --- Render helpers ---
  function getDateStatus(
    dateStr: string
  ): "full" | "partial" | "none" {
    const count = coverageMap[dateStr] ?? 0;
    if (count === 0) return "none";
    if (count >= totalBays && totalBays > 0) return "full";
    return "partial";
  }

  function getWillBeSelected(
    dateStr: string,
    isSelected: boolean,
    inPreview: boolean
  ): boolean {
    if (!isDragging) return isSelected;
    if (dragMode === "add") return isSelected || inPreview;
    return isSelected && !inPreview;
  }

  return (
    <div className="relative">
      {/* ─── Sticky Header ─── */}
      <div className="sticky top-16 z-30 -mx-4 border-b border-gray-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur-sm md:-mx-6 md:px-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Schedule</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Select dates to apply schedule templates.
            </p>
          </div>
          {selectedCount > 0 && (
            <button
              onClick={clearSelection}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-50"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>

        {/* Month chips */}
        <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            onClick={showAllMonths}
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              visibleMonths.size === 0
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            All
          </button>
          {months.map((m) => (
            <button
              key={m.key}
              onClick={() => handleMonthChipClick(m.key)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                visibleMonths.size > 0 && visibleMonths.has(m.key)
                  ? "bg-blue-600 text-white"
                  : visibleMonths.size === 0
                    ? "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    : "bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
              )}
            >
              {m.shortLabel}
            </button>
          ))}
        </div>

        {/* Legend */}
        {totalBays > 0 && (
          <div className="mt-2 flex items-center gap-4 text-[11px] text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              All scheduled
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
              Partial
            </span>
          </div>
        )}
      </div>

      {/* ─── Month Calendars ─── */}
      <div
        className={cn(
          "mt-6 space-y-8",
          selectedCount > 0 ? "pb-28" : "pb-4"
        )}
      >
        {filteredMonths.map((month) => (
          <div
            key={month.key}
            className="rounded-2xl border border-gray-200 bg-white"
          >
            {/* Month header */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
              <h2 className="text-base font-semibold text-gray-800">
                {month.label}
              </h2>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  onClick={() => handleMonthWeekdays(month)}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                >
                  Weekdays
                </button>
                <button
                  onClick={() => handleMonthWeekends(month)}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                >
                  Weekends
                </button>
                <button
                  onClick={() => handleMonthSelectAll(month)}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50"
                >
                  Select All
                </button>
                {month.selectableDates.some((d) => selectedDates.has(d)) && (
                  <button
                    onClick={() =>
                      toggleDates(month.selectableDates, "remove")
                    }
                    className="rounded-md px-2.5 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Calendar grid */}
            <div className="p-2 md:p-4">
              <div className="grid grid-cols-[2rem_repeat(7,1fr)]">
                {/* Day-of-week headers */}
                <div /> {/* row-select spacer */}
                {DOW_LABELS.map((label, dow) => (
                  <button
                    key={dow}
                    onClick={() => handleDowSelect(month, dow)}
                    className="py-2 text-center text-xs font-medium uppercase tracking-wide text-gray-400 transition-colors hover:text-blue-600"
                    title={`Select all ${label}s in ${month.label}`}
                  >
                    {label}
                  </button>
                ))}

                {/* Week rows */}
                {month.weeks.map((week, wi) => {
                  const weekSelectableDates = week.filter(
                    (d) => d !== "" && !isPast(d, today)
                  );
                  const weekHasSelectable = weekSelectableDates.length > 0;

                  return (
                    <Fragment key={wi}>
                      {/* Row select button */}
                      <button
                        onClick={() => handleWeekRowSelect(week)}
                        disabled={!weekHasSelectable}
                        className={cn(
                          "flex items-center justify-center rounded-l-md transition-colors",
                          weekHasSelectable
                            ? "text-gray-300 hover:bg-gray-100 hover:text-gray-500"
                            : "cursor-default text-gray-100"
                        )}
                        title={weekHasSelectable ? "Select this week" : undefined}
                      >
                        <Check className="h-3 w-3" />
                      </button>

                      {/* Day cells */}
                      {week.map((dateStr, di) => {
                        if (dateStr === "") {
                          return <div key={`empty-${wi}-${di}`} className="h-10 md:h-12" />;
                        }

                        const past = isPast(dateStr, today);
                        const isToday = dateStr === today;
                        const isSelected = selectedDates.has(dateStr);
                        const inPreview = dragPreviewDates.has(dateStr);
                        const willBeSelected = getWillBeSelected(
                          dateStr,
                          isSelected,
                          inPreview
                        );
                        const status = getDateStatus(dateStr);
                        const dayNum = parseInt(dateStr.split("-")[2], 10);

                        return (
                          <div
                            key={dateStr}
                            onMouseDown={(e) => handleMouseDown(dateStr, e)}
                            onMouseEnter={() => handleMouseEnter(dateStr)}
                            className={cn(
                              "relative flex h-10 select-none items-center justify-center rounded-lg text-sm transition-colors md:h-12",
                              // Past
                              past && "pointer-events-none text-gray-300",
                              // Default (not past, not selected)
                              !past &&
                                !willBeSelected &&
                                "cursor-pointer text-gray-700 hover:bg-gray-50",
                              // Selected
                              willBeSelected && "bg-blue-600 text-white",
                              // Drag preview — adding
                              !past &&
                                isDragging &&
                                dragMode === "add" &&
                                inPreview &&
                                !isSelected &&
                                "bg-blue-100 text-blue-700",
                              // Drag preview — removing
                              !past &&
                                isDragging &&
                                dragMode === "remove" &&
                                inPreview &&
                                isSelected &&
                                "bg-red-100 text-red-700",
                              // Today ring
                              isToday &&
                                !willBeSelected &&
                                "font-bold ring-2 ring-blue-400 ring-offset-1",
                              isToday &&
                                willBeSelected &&
                                "font-bold ring-2 ring-blue-300 ring-offset-1"
                            )}
                          >
                            {dayNum}
                            {/* Status dot */}
                            {!past && status !== "none" && (
                              <span
                                className={cn(
                                  "absolute bottom-0.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full md:bottom-1",
                                  status === "full" &&
                                    (willBeSelected
                                      ? "bg-green-300"
                                      : "bg-green-500"),
                                  status === "partial" &&
                                    (willBeSelected
                                      ? "bg-amber-300"
                                      : "bg-amber-500")
                                )}
                              />
                            )}
                          </div>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ─── Sticky Bottom Panel ─── */}
      {selectedCount > 0 &&
        mounted &&
        createPortal(
          <div className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.08)] lg:left-[280px]">
            {panelOpen ? (
              /* ── Expanded Apply Panel ── */
              <div>
                {/* Panel header */}
                <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 md:px-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100">
                      <LayoutTemplate className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        Apply Template to {selectedCount}{" "}
                        {selectedCount === 1 ? "date" : "dates"}
                      </p>
                      <p className="truncate text-xs text-gray-500">
                        {formatDateRangeSummary(selectedArray)}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={closePanel}
                    className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Panel body */}
                <div className="max-h-[50vh] overflow-y-auto px-4 py-4 md:px-6">
                  {/* Result message */}
                  {applyResult && (
                    <div
                      className={cn(
                        "mb-4 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm",
                        applyResult.success
                          ? "border-green-200 bg-green-50 text-green-700"
                          : "border-red-200 bg-red-50 text-red-700"
                      )}
                    >
                      {applyResult.success ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                      ) : (
                        <AlertCircle className="h-4 w-4 shrink-0" />
                      )}
                      {applyResult.success
                        ? `Successfully applied to ${applyResult.count} schedule${applyResult.count !== 1 ? "s" : ""}.`
                        : applyResult.error || "Failed to apply template."}
                    </div>
                  )}

                  <div className="space-y-5">
                    {/* Template picker */}
                    <div>
                      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
                        Template
                      </label>
                      {templates.length === 0 ? (
                        <p className="text-sm text-gray-400">
                          No templates found. Create one in{" "}
                          <a
                            href="/admin/templates"
                            className="text-blue-600 underline"
                          >
                            Templates
                          </a>
                          .
                        </p>
                      ) : (
                        <select
                          value={selectedTemplateId}
                          onChange={(e) => setSelectedTemplateId(e.target.value)}
                          className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10"
                        >
                          <option value="">Select a template...</option>
                          {templates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name} ({t.slotCount}{" "}
                              {t.slotCount === 1 ? "slot" : "slots"})
                            </option>
                          ))}
                        </select>
                      )}
                      {selectedTemplate && selectedTemplate.slotCount === 0 && (
                        <p className="mt-1.5 text-xs text-amber-600">
                          This template has no time slots. Add slots before
                          applying.
                        </p>
                      )}
                    </div>

                    {/* Bay selector */}
                    <div>
                      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
                        Apply to
                      </label>
                      <div className="rounded-lg border border-gray-200">
                        {/* All bays toggle */}
                        <label className="flex cursor-pointer items-center gap-3 border-b border-gray-100 px-3 py-2.5 transition-colors hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={selectedBayIds.size === bays.length}
                            onChange={toggleAllBays}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm font-medium text-gray-800">
                            All bays ({bays.length})
                          </span>
                        </label>

                        {/* Individual bays */}
                        {bays.map((bay) => (
                          <label
                            key={bay.id}
                            className="flex cursor-pointer items-center gap-3 px-3 py-2 pl-7 transition-colors hover:bg-gray-50"
                          >
                            <input
                              type="checkbox"
                              checked={selectedBayIds.has(bay.id)}
                              onChange={() => toggleBay(bay.id)}
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">
                              {bay.name}
                            </span>
                            <span className="text-xs text-gray-400">
                              ${(bay.hourly_rate_cents / 100).toFixed(0)}/hr
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Panel footer */}
                <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 md:px-6">
                  <div className="text-xs text-gray-500">
                    {canApply ? (
                      <>
                        {scheduleCount} schedule
                        {scheduleCount !== 1 ? "s" : ""} will be{" "}
                        {selectedArray.some((d) => (coverageMap[d] ?? 0) > 0)
                          ? "created or replaced"
                          : "created"}
                      </>
                    ) : selectedTemplateId && selectedTemplate?.slotCount === 0 ? (
                      "Template has no slots"
                    ) : !selectedTemplateId ? (
                      "Select a template"
                    ) : selectedBayIds.size === 0 ? (
                      "Select at least one bay"
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={closePanel}
                      disabled={applying}
                      className="rounded-lg border-gray-200"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleApply}
                      disabled={!canApply || applying}
                      className="gap-1.5 rounded-lg"
                    >
                      {applying ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Applying...
                        </>
                      ) : (
                        <>
                          Apply to {scheduleCount} schedule
                          {scheduleCount !== 1 ? "s" : ""}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              /* ── Collapsed Bar ── */
              <div className="flex items-center justify-between gap-4 px-4 py-3 md:px-6">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100">
                    <CalendarDays className="h-4 w-4 text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800">
                      {selectedCount}{" "}
                      {selectedCount === 1 ? "date" : "dates"} selected
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {formatDateRangeSummary(selectedArray)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearSelection}
                    className="gap-1.5 rounded-lg border-gray-200"
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const editDate =
                        lastClickedDate && selectedDates.has(lastClickedDate)
                          ? lastClickedDate
                          : selectedArray[0];
                      if (editDate) setEditingDate(editDate);
                    }}
                    className="gap-1.5 rounded-lg border-gray-200"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit Schedule
                  </Button>
                  <Button
                    size="sm"
                    onClick={openPanel}
                    className="gap-1.5 rounded-lg"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                    Apply Template
                  </Button>
                </div>
              </div>
            )}
          </div>,
          document.body
        )}

      {/* ─── Day Editor Drawer ─── */}
      {editingDate && (
        <ScheduleDayDrawer
          date={editingDate}
          orgId={orgId}
          timezone={timezone}
          bays={bays}
          templates={templates}
          onClose={() => {
            setEditingDate(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
