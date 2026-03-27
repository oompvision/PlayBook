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
  ListChecks,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────

type MonthData = {
  key: string;
  label: string;
  shortLabel: string;
  days: string[];
  weeks: string[][];
  selectableDates: string[];
  weekdayDates: string[];
  weekendDates: string[];
  dayOfWeekDates: Record<number, string[]>;
};

type EventDaySummary = {
  id: string;
  name: string;
  templateId: string | null;
  color: string;
  status: string;
};

type EventTemplateSummary = {
  id: string;
  name: string;
  color: string;
  start_time: string | null;
  end_time: string | null;
  bay_ids: string[];
};

type DayScheduleInfo = {
  id: string;
  name: string;
  entryCount: number;
};

type BayInfo = {
  id: string;
  name: string;
};

type ApplyResult = {
  success: boolean;
  count: number;
  error?: string;
};

type EventCalendarProps = {
  today: string;
  timezone: string;
  orgId: string;
  eventMap: Record<string, EventDaySummary[]>;
  eventTemplates: EventTemplateSummary[];
  daySchedules: DayScheduleInfo[];
  bays: BayInfo[];
  onApplyEventTemplate: (
    templateId: string,
    bayIds: string[],
    dates: string[],
    status: "draft" | "published"
  ) => Promise<ApplyResult>;
  onApplyDaySchedule: (
    dayScheduleId: string,
    dates: string[],
    status: "draft" | "published"
  ) => Promise<ApplyResult>;
  onOpenDay: (dateStr: string | null) => void;
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
    if (r.start === r.end) return `${sMonth} ${sDay}`;
    const eMonth = format(e, "MMM");
    const eDay = e.getDate();
    if (sMonth === eMonth) return `${sMonth} ${sDay}–${eDay}`;
    return `${sMonth} ${sDay} – ${eMonth} ${eDay}`;
  });

  if (ranges.length > 5) parts.push(`+${ranges.length - 5} more`);
  return parts.join(", ");
}

// ─── Component ───────────────────────────────────────────────────

export function EventCalendar({
  today,
  timezone,
  orgId,
  eventMap,
  eventTemplates,
  daySchedules,
  bays,
  onApplyEventTemplate,
  onApplyDaySchedule,
  onOpenDay,
}: EventCalendarProps) {
  const months = useMemo(() => generateMonths(today), [today]);
  const allDatesFlat = useMemo(() => months.flatMap((m) => m.days), [months]);
  const router = useRouter();

  // --- State ---
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragEnd, setDragEnd] = useState<string | null>(null);
  const [dragMode, setDragMode] = useState<"add" | "remove">("add");
  const [lastClickedDate, setLastClickedDate] = useState<string | null>(null);
  const [visibleMonths, setVisibleMonths] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);

  // --- Panel state ---
  const [panelMode, setPanelMode] = useState<"template" | "daySchedule" | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedBayIds, setSelectedBayIds] = useState<Set<string>>(new Set());
  const [selectedDayScheduleId, setSelectedDayScheduleId] = useState("");
  const [applyStatus, setApplyStatus] = useState<"draft" | "published">("draft");
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);

  useEffect(() => setMounted(true), []);

  // --- Drag preview ---
  const dragPreviewDates = useMemo(() => {
    if (!isDragging || !dragStart || !dragEnd) return new Set<string>();
    const startIdx = allDatesFlat.indexOf(dragStart);
    const endIdx = allDatesFlat.indexOf(dragEnd);
    if (startIdx === -1 || endIdx === -1) return new Set<string>();
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    const result = new Set<string>();
    for (let i = lo; i <= hi; i++) {
      if (!isPast(allDatesFlat[i], today)) result.add(allDatesFlat[i]);
    }
    return result;
  }, [isDragging, dragStart, dragEnd, allDatesFlat, today]);

  const dragStateRef = useRef({ isDragging, dragPreviewDates, dragMode });
  useEffect(() => {
    dragStateRef.current = { isDragging, dragPreviewDates, dragMode };
  });

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

  useEffect(() => {
    if (isDragging) {
      document.body.style.userSelect = "none";
    } else {
      document.body.style.userSelect = "";
    }
    return () => { document.body.style.userSelect = ""; };
  }, [isDragging]);

  // --- Selection helpers ---
  const toggleDates = useCallback(
    (dates: string[], forceMode?: "add" | "remove") => {
      setSelectedDates((prev) => {
        const next = new Set(prev);
        const mode = forceMode || (dates.length > 0 && dates.every((d) => prev.has(d)) ? "remove" : "add");
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
    setPanelMode(null);
    setApplyResult(null);
  }, []);

  // --- Panel handlers ---
  const openTemplatePanel = useCallback(() => {
    setPanelMode("template");
    setSelectedTemplateId("");
    setSelectedBayIds(new Set(bays.map((b) => b.id)));
    setApplyStatus("draft");
    setApplyResult(null);
  }, [bays]);

  const openDaySchedulePanel = useCallback(() => {
    setPanelMode("daySchedule");
    setSelectedDayScheduleId("");
    setApplyStatus("draft");
    setApplyResult(null);
  }, []);

  const closePanel = useCallback(() => {
    setPanelMode(null);
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

  const handleApplyTemplate = useCallback(async () => {
    if (!selectedTemplateId || selectedBayIds.size === 0 || selectedDates.size === 0) return;
    setApplying(true);
    setApplyResult(null);
    try {
      const result = await onApplyEventTemplate(
        selectedTemplateId,
        Array.from(selectedBayIds),
        Array.from(selectedDates),
        applyStatus
      );
      setApplyResult(result);
      if (result.success) {
        setTimeout(() => {
          setPanelMode(null);
          setSelectedDates(new Set());
          setApplyResult(null);
        }, 1500);
      }
    } catch {
      setApplyResult({ success: false, count: 0, error: "An unexpected error occurred" });
    } finally {
      setApplying(false);
    }
  }, [selectedTemplateId, selectedBayIds, selectedDates, applyStatus, onApplyEventTemplate]);

  const handleApplyDaySchedule = useCallback(async () => {
    if (!selectedDayScheduleId || selectedDates.size === 0) return;
    setApplying(true);
    setApplyResult(null);
    try {
      const result = await onApplyDaySchedule(
        selectedDayScheduleId,
        Array.from(selectedDates),
        applyStatus
      );
      setApplyResult(result);
      if (result.success) {
        setTimeout(() => {
          setPanelMode(null);
          setSelectedDates(new Set());
          setApplyResult(null);
        }, 1500);
      }
    } catch {
      setApplyResult({ success: false, count: 0, error: "An unexpected error occurred" });
    } finally {
      setApplying(false);
    }
  }, [selectedDayScheduleId, selectedDates, applyStatus, onApplyDaySchedule]);

  // --- Mouse handlers ---
  const handleMouseDown = useCallback(
    (dateStr: string, e: React.MouseEvent) => {
      if (isPast(dateStr, today)) return;

      if (e.shiftKey && lastClickedDate) {
        const startIdx = allDatesFlat.indexOf(lastClickedDate);
        const endIdx = allDatesFlat.indexOf(dateStr);
        if (startIdx !== -1 && endIdx !== -1) {
          const lo = Math.min(startIdx, endIdx);
          const hi = Math.max(startIdx, endIdx);
          const rangeDates: string[] = [];
          for (let i = lo; i <= hi; i++) {
            if (!isPast(allDatesFlat[i], today)) rangeDates.push(allDatesFlat[i]);
          }
          toggleDates(rangeDates, "add");
        }
        setLastClickedDate(dateStr);
        return;
      }

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
      if (isDragging) setDragEnd(dateStr);
    },
    [isDragging]
  );

  const handleDayClick = useCallback(
    (dateStr: string) => {
      if (!isPast(dateStr, today)) onOpenDay(dateStr);
    },
    [today, onOpenDay]
  );

  const handleWeekRowSelect = useCallback(
    (weekDates: string[]) => {
      const selectable = weekDates.filter((d) => d !== "" && !isPast(d, today));
      if (selectable.length === 0) return;
      toggleDates(selectable);
    },
    [today, toggleDates]
  );

  const handleDowSelect = useCallback(
    (month: MonthData, dowIndex: number) => {
      const dates = month.dayOfWeekDates[dowIndex];
      if (dates.length === 0) return;
      toggleDates(dates);
    },
    [toggleDates]
  );

  const handleMonthSelectAll = useCallback(
    (month: MonthData) => toggleDates(month.selectableDates),
    [toggleDates]
  );

  const handleMonthWeekdays = useCallback(
    (month: MonthData) => toggleDates(month.weekdayDates),
    [toggleDates]
  );

  const handleMonthWeekends = useCallback(
    (month: MonthData) => toggleDates(month.weekendDates),
    [toggleDates]
  );

  const handleMonthChipClick = useCallback((key: string) => {
    setVisibleMonths((prev) => {
      if (prev.size === 0) return new Set([key]);
      if (prev.size === 1 && prev.has(key)) return new Set();
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const showAllMonths = useCallback(() => setVisibleMonths(new Set()), []);

  // --- Derived ---
  const filteredMonths = useMemo(
    () => visibleMonths.size === 0 ? months : months.filter((m) => visibleMonths.has(m.key)),
    [months, visibleMonths]
  );
  const selectedCount = selectedDates.size;
  const selectedArray = useMemo(() => Array.from(selectedDates).sort(), [selectedDates]);

  const selectedTemplate = eventTemplates.find((t) => t.id === selectedTemplateId);
  const canApplyTemplate = selectedCount > 0 && selectedBayIds.size > 0 && !!selectedTemplateId;
  const canApplyDaySchedule = selectedCount > 0 && !!selectedDayScheduleId;

  function getWillBeSelected(dateStr: string, isSelected: boolean, inPreview: boolean): boolean {
    if (!isDragging) return isSelected;
    if (dragMode === "add") return isSelected || inPreview;
    return isSelected && !inPreview;
  }

  // --- Unique event colors for legend ---
  const legendColors = useMemo(() => {
    const colorSet = new Map<string, string>();
    for (const events of Object.values(eventMap)) {
      for (const ev of events) {
        if (ev.color && !colorSet.has(ev.color)) {
          colorSet.set(ev.color, ev.name);
        }
      }
    }
    return Array.from(colorSet.entries()).slice(0, 6);
  }, [eventMap]);

  return (
    <div className="relative">
      {/* ─── Sticky Header ─── */}
      <div className="sticky top-16 z-30 -mx-4 border-b border-gray-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur-sm md:-mx-6 md:px-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Event Calendar</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Select dates to apply event templates or day schedules. Click a date to view events.
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
        {legendColors.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-gray-400">
            {legendColors.map(([color, name]) => (
              <span key={color} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ─── Month Calendars ─── */}
      <div className={cn("mt-6 space-y-8", selectedCount > 0 ? "pb-28" : "pb-4")}>
        {filteredMonths.map((month) => (
          <div key={month.key} className="rounded-2xl border border-gray-200 bg-white">
            {/* Month header */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
              <h2 className="text-base font-semibold text-gray-800">{month.label}</h2>
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
                    onClick={() => toggleDates(month.selectableDates, "remove")}
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
                <div />
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

                {month.weeks.map((week, wi) => {
                  const weekSelectableDates = week.filter((d) => d !== "" && !isPast(d, today));
                  const weekHasSelectable = weekSelectableDates.length > 0;

                  return (
                    <Fragment key={wi}>
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

                      {week.map((dateStr, di) => {
                        if (dateStr === "") {
                          return <div key={`empty-${wi}-${di}`} className="h-12 md:h-14" />;
                        }

                        const past = isPast(dateStr, today);
                        const isToday = dateStr === today;
                        const isSelected = selectedDates.has(dateStr);
                        const inPreview = dragPreviewDates.has(dateStr);
                        const willBeSelected = getWillBeSelected(dateStr, isSelected, inPreview);
                        const dayNum = parseInt(dateStr.split("-")[2], 10);
                        const dayEvents = eventMap[dateStr] || [];

                        return (
                          <div
                            key={dateStr}
                            onMouseDown={(e) => handleMouseDown(dateStr, e)}
                            onMouseEnter={() => handleMouseEnter(dateStr)}
                            onClick={() => handleDayClick(dateStr)}
                            className={cn(
                              "relative flex h-12 select-none flex-col items-center justify-center rounded-lg text-sm transition-colors md:h-14",
                              past && "pointer-events-none text-gray-300",
                              !past && !willBeSelected && "cursor-pointer text-gray-700 hover:bg-gray-50",
                              willBeSelected && "bg-blue-600 text-white",
                              !past && isDragging && dragMode === "add" && inPreview && !isSelected && "bg-blue-100 text-blue-700",
                              !past && isDragging && dragMode === "remove" && inPreview && isSelected && "bg-red-100 text-red-700",
                              isToday && !willBeSelected && "font-bold ring-2 ring-blue-400 ring-offset-1",
                              isToday && willBeSelected && "font-bold ring-2 ring-blue-300 ring-offset-1"
                            )}
                          >
                            <span className="leading-none">{dayNum}</span>
                            {/* Event dots */}
                            {!past && dayEvents.length > 0 && (
                              <div className="mt-0.5 flex items-center gap-0.5">
                                {dayEvents.slice(0, 3).map((ev) => (
                                  <span
                                    key={ev.id}
                                    className="inline-block h-1.5 w-1.5 rounded-full"
                                    style={{
                                      backgroundColor: willBeSelected
                                        ? `${ev.color}99`
                                        : ev.color,
                                    }}
                                  />
                                ))}
                                {dayEvents.length > 3 && (
                                  <span
                                    className={cn(
                                      "text-[9px] leading-none",
                                      willBeSelected ? "text-blue-200" : "text-gray-400"
                                    )}
                                  >
                                    +{dayEvents.length - 3}
                                  </span>
                                )}
                              </div>
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
            {panelMode === "template" ? (
              /* ── Apply Event Template Panel ── */
              <div>
                <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 md:px-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100">
                      <LayoutTemplate className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        Apply Event Template to {selectedCount}{" "}
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

                <div className="max-h-[50vh] overflow-y-auto px-4 py-4 md:px-6">
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
                        ? `Successfully created ${applyResult.count} event${applyResult.count !== 1 ? "s" : ""}.`
                        : applyResult.error || "Failed to apply template."}
                    </div>
                  )}

                  <div className="space-y-5">
                    {/* Template picker */}
                    <div>
                      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
                        Event Template
                      </label>
                      {eventTemplates.length === 0 ? (
                        <p className="text-sm text-gray-400">
                          No event templates found. Create one in{" "}
                          <a href="/admin/events/templates" className="text-blue-600 underline">
                            Event Templates
                          </a>.
                        </p>
                      ) : (
                        <select
                          value={selectedTemplateId}
                          onChange={(e) => setSelectedTemplateId(e.target.value)}
                          className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10"
                        >
                          <option value="">Select a template...</option>
                          {eventTemplates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                              {t.start_time && t.end_time
                                ? ` (${t.start_time}–${t.end_time})`
                                : ""}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    {/* Bay selector */}
                    <div>
                      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
                        Assign to Bays
                      </label>
                      <div className="rounded-lg border border-gray-200">
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
                            <span className="text-sm text-gray-700">{bay.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Status toggle */}
                    <div>
                      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
                        Status
                      </label>
                      <div className="flex rounded-lg border border-gray-200">
                        <button
                          onClick={() => setApplyStatus("draft")}
                          className={cn(
                            "flex-1 rounded-l-lg px-4 py-2 text-sm font-medium transition-colors",
                            applyStatus === "draft"
                              ? "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200"
                              : "text-gray-500 hover:bg-gray-50"
                          )}
                        >
                          Draft
                        </button>
                        <button
                          onClick={() => setApplyStatus("published")}
                          className={cn(
                            "flex-1 rounded-r-lg px-4 py-2 text-sm font-medium transition-colors",
                            applyStatus === "published"
                              ? "bg-green-50 text-green-700 ring-1 ring-inset ring-green-200"
                              : "text-gray-500 hover:bg-gray-50"
                          )}
                        >
                          Published
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 md:px-6">
                  <div className="text-xs text-gray-500">
                    {canApplyTemplate
                      ? `${selectedCount} event${selectedCount !== 1 ? "s" : ""} will be created as ${applyStatus}`
                      : !selectedTemplateId
                        ? "Select a template"
                        : selectedBayIds.size === 0
                          ? "Select at least one bay"
                          : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={closePanel} disabled={applying} className="rounded-lg border-gray-200">
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleApplyTemplate} disabled={!canApplyTemplate || applying} className="gap-1.5 rounded-lg">
                      {applying ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Applying...
                        </>
                      ) : (
                        <>Apply to {selectedCount} {selectedCount === 1 ? "date" : "dates"}</>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ) : panelMode === "daySchedule" ? (
              /* ── Apply Day Schedule Panel ── */
              <div>
                <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 md:px-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-100">
                      <ListChecks className="h-4 w-4 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        Apply Day Schedule to {selectedCount}{" "}
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

                <div className="max-h-[50vh] overflow-y-auto px-4 py-4 md:px-6">
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
                        ? `Successfully created ${applyResult.count} event${applyResult.count !== 1 ? "s" : ""}.`
                        : applyResult.error || "Failed to apply day schedule."}
                    </div>
                  )}

                  <div className="space-y-5">
                    {/* Day schedule picker */}
                    <div>
                      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
                        Day Schedule
                      </label>
                      {daySchedules.length === 0 ? (
                        <p className="text-sm text-gray-400">
                          No day schedules saved yet. Open a day with events and use &ldquo;Save as Day Schedule&rdquo;.
                        </p>
                      ) : (
                        <select
                          value={selectedDayScheduleId}
                          onChange={(e) => setSelectedDayScheduleId(e.target.value)}
                          className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-3 focus:ring-purple-500/10"
                        >
                          <option value="">Select a day schedule...</option>
                          {daySchedules.map((ds) => (
                            <option key={ds.id} value={ds.id}>
                              {ds.name} ({ds.entryCount} event{ds.entryCount !== 1 ? "s" : ""})
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    {/* Status toggle */}
                    <div>
                      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
                        Status
                      </label>
                      <div className="flex rounded-lg border border-gray-200">
                        <button
                          onClick={() => setApplyStatus("draft")}
                          className={cn(
                            "flex-1 rounded-l-lg px-4 py-2 text-sm font-medium transition-colors",
                            applyStatus === "draft"
                              ? "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200"
                              : "text-gray-500 hover:bg-gray-50"
                          )}
                        >
                          Draft
                        </button>
                        <button
                          onClick={() => setApplyStatus("published")}
                          className={cn(
                            "flex-1 rounded-r-lg px-4 py-2 text-sm font-medium transition-colors",
                            applyStatus === "published"
                              ? "bg-green-50 text-green-700 ring-1 ring-inset ring-green-200"
                              : "text-gray-500 hover:bg-gray-50"
                          )}
                        >
                          Published
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 md:px-6">
                  <div className="text-xs text-gray-500">
                    {canApplyDaySchedule
                      ? `Events will be created on ${selectedCount} ${selectedCount === 1 ? "date" : "dates"} as ${applyStatus}`
                      : "Select a day schedule"}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={closePanel} disabled={applying} className="rounded-lg border-gray-200">
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleApplyDaySchedule} disabled={!canApplyDaySchedule || applying} className="gap-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700">
                      {applying ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Applying...
                        </>
                      ) : (
                        <>Apply to {selectedCount} {selectedCount === 1 ? "date" : "dates"}</>
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
                      {selectedCount} {selectedCount === 1 ? "date" : "dates"} selected
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
                    Clear Selection
                  </Button>
                  {daySchedules.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openDaySchedulePanel}
                      className="gap-1.5 rounded-lg border-purple-200 text-purple-600 hover:bg-purple-50 hover:text-purple-700"
                    >
                      <ListChecks className="h-3.5 w-3.5" />
                      Apply Day Schedule
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={openTemplatePanel}
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
    </div>
  );
}
