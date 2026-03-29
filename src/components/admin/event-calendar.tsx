"use client";

import { useState, useRef, useCallback, useMemo, useEffect, Fragment } from "react";
import { createPortal } from "react-dom";
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
  ChevronDown,
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
  onOpenDay: (date: string | null) => void;
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

// ─── Component ───────────────────────────────────────────────────

export function EventCalendar({
  today,
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
  const [panelMode, setPanelMode] = useState<"template" | "schedule" | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedBayIds, setSelectedBayIds] = useState<Set<string>>(new Set());
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
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
        const mode =
          forceMode ||
          (dates.length > 0 && dates.every((d) => prev.has(d)) ? "remove" : "add");
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

  // --- Month filter ---
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

  // --- Panel handlers ---
  const openTemplatePanel = useCallback(() => {
    setPanelMode("template");
    setSelectedTemplateId("");
    setSelectedBayIds(new Set(bays.map((b) => b.id)));
    setApplyStatus("draft");
    setApplyResult(null);
  }, [bays]);

  const openSchedulePanel = useCallback(() => {
    setPanelMode("schedule");
    setSelectedScheduleId("");
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

  const handleApplySchedule = useCallback(async () => {
    if (!selectedScheduleId || selectedDates.size === 0) return;
    setApplying(true);
    setApplyResult(null);
    try {
      const result = await onApplyDaySchedule(
        selectedScheduleId,
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
  }, [selectedScheduleId, selectedDates, applyStatus, onApplyDaySchedule]);

  // --- Derived ---
  const filteredMonths = useMemo(
    () =>
      visibleMonths.size === 0
        ? months
        : months.filter((m) => visibleMonths.has(m.key)),
    [months, visibleMonths]
  );

  const selectedCount = selectedDates.size;

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
            <h1 className="text-2xl font-bold text-gray-800">Event Calendar</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Select dates to create events from templates, or click a day to view its events.
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
        <div className="mt-2 flex items-center gap-4 text-[11px] text-gray-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
            Published
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
            Draft
          </span>
        </div>
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
                  onClick={() => toggleDates(month.weekdayDates)}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                >
                  Weekdays
                </button>
                <button
                  onClick={() => toggleDates(month.weekendDates)}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                >
                  Weekends
                </button>
                <button
                  onClick={() => toggleDates(month.selectableDates)}
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
                {/* Day-of-week headers */}
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

                {/* Week rows */}
                {month.weeks.map((week, wi) => {
                  const weekSelectableDates = week.filter(
                    (d) => d !== "" && !isPast(d, today)
                  );
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
                        const hasPublished = dayEvents.some((e) => e.status === "published");
                        const hasDraft = dayEvents.some((e) => e.status === "draft");

                        return (
                          <div
                            key={dateStr}
                            onMouseDown={(e) => handleMouseDown(dateStr, e)}
                            onMouseEnter={() => handleMouseEnter(dateStr)}
                            onClick={(e) => {
                              // Single click (not drag) on a date with events opens the day modal
                              if (!isDragging && dayEvents.length > 0 && !e.shiftKey) {
                                onOpenDay(dateStr);
                              }
                            }}
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
                            <span>{dayNum}</span>
                            {/* Event indicators */}
                            {!past && dayEvents.length > 0 && (
                              <div className="flex items-center gap-0.5">
                                {hasPublished && (
                                  <span
                                    className={cn(
                                      "h-1.5 w-1.5 rounded-full",
                                      willBeSelected ? "bg-blue-300" : "bg-blue-500"
                                    )}
                                  />
                                )}
                                {hasDraft && (
                                  <span
                                    className={cn(
                                      "h-1.5 w-1.5 rounded-full",
                                      willBeSelected ? "bg-amber-300" : "bg-amber-500"
                                    )}
                                  />
                                )}
                                {dayEvents.length > 1 && (
                                  <span
                                    className={cn(
                                      "text-[9px] font-medium leading-none",
                                      willBeSelected ? "text-blue-200" : "text-gray-400"
                                    )}
                                  >
                                    {dayEvents.length}
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
              <div>
                <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 md:px-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100">
                      <LayoutTemplate className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        Apply Event Template
                      </p>
                      <p className="text-xs text-gray-500">
                        {selectedCount} {selectedCount === 1 ? "date" : "dates"} selected
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

                <div className="space-y-4 px-4 py-4 md:px-6">
                  {/* Template select */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600">
                      Event Template
                    </label>
                    <select
                      value={selectedTemplateId}
                      onChange={(e) => setSelectedTemplateId(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">Select a template...</option>
                      {eventTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.start_time ? ` (${t.start_time}–${t.end_time})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Bay selection */}
                  {bays.length > 0 && (
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <label className="text-xs font-medium text-gray-600">Bays</label>
                        <button
                          onClick={toggleAllBays}
                          className="text-xs font-medium text-blue-600 hover:text-blue-700"
                        >
                          {selectedBayIds.size === bays.length ? "Deselect all" : "Select all"}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {bays.map((bay) => (
                          <button
                            key={bay.id}
                            onClick={() => toggleBay(bay.id)}
                            className={cn(
                              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                              selectedBayIds.has(bay.id)
                                ? "border-blue-200 bg-blue-50 text-blue-700"
                                : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
                            )}
                          >
                            {bay.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Status */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600">
                      Status
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setApplyStatus("draft")}
                        className={cn(
                          "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                          applyStatus === "draft"
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-gray-200 text-gray-500 hover:border-gray-300"
                        )}
                      >
                        Draft
                      </button>
                      <button
                        onClick={() => setApplyStatus("published")}
                        className={cn(
                          "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                          applyStatus === "published"
                            ? "border-green-200 bg-green-50 text-green-700"
                            : "border-gray-200 text-gray-500 hover:border-gray-300"
                        )}
                      >
                        Published
                      </button>
                    </div>
                  </div>

                  {/* Result feedback */}
                  {applyResult && (
                    <div
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                        applyResult.success
                          ? "border-green-200 bg-green-50 text-green-700"
                          : "border-red-200 bg-red-50 text-red-700"
                      )}
                    >
                      {applyResult.success ? (
                        <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                      ) : (
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                      )}
                      {applyResult.success
                        ? `Created ${applyResult.count} event${applyResult.count !== 1 ? "s" : ""}`
                        : applyResult.error}
                    </div>
                  )}

                  {/* Apply button */}
                  <Button
                    onClick={handleApplyTemplate}
                    disabled={!selectedTemplateId || selectedBayIds.size === 0 || applying}
                    className="w-full"
                  >
                    {applying ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CalendarDays className="mr-2 h-4 w-4" />
                    )}
                    Apply to {selectedCount} {selectedCount === 1 ? "Date" : "Dates"}
                  </Button>
                </div>
              </div>
            ) : panelMode === "schedule" ? (
              <div>
                <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 md:px-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-100">
                      <ListChecks className="h-4 w-4 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        Apply Day Schedule
                      </p>
                      <p className="text-xs text-gray-500">
                        {selectedCount} {selectedCount === 1 ? "date" : "dates"} selected
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

                <div className="space-y-4 px-4 py-4 md:px-6">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600">
                      Day Schedule
                    </label>
                    <select
                      value={selectedScheduleId}
                      onChange={(e) => setSelectedScheduleId(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">Select a day schedule...</option>
                      {daySchedules.map((ds) => (
                        <option key={ds.id} value={ds.id}>
                          {ds.name} ({ds.entryCount} {ds.entryCount === 1 ? "event" : "events"})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Status */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600">
                      Status
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setApplyStatus("draft")}
                        className={cn(
                          "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                          applyStatus === "draft"
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-gray-200 text-gray-500 hover:border-gray-300"
                        )}
                      >
                        Draft
                      </button>
                      <button
                        onClick={() => setApplyStatus("published")}
                        className={cn(
                          "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                          applyStatus === "published"
                            ? "border-green-200 bg-green-50 text-green-700"
                            : "border-gray-200 text-gray-500 hover:border-gray-300"
                        )}
                      >
                        Published
                      </button>
                    </div>
                  </div>

                  {applyResult && (
                    <div
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                        applyResult.success
                          ? "border-green-200 bg-green-50 text-green-700"
                          : "border-red-200 bg-red-50 text-red-700"
                      )}
                    >
                      {applyResult.success ? (
                        <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                      ) : (
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                      )}
                      {applyResult.success
                        ? `Created ${applyResult.count} event${applyResult.count !== 1 ? "s" : ""}`
                        : applyResult.error}
                    </div>
                  )}

                  <Button
                    onClick={handleApplySchedule}
                    disabled={!selectedScheduleId || applying}
                    className="w-full"
                  >
                    {applying ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CalendarDays className="mr-2 h-4 w-4" />
                    )}
                    Apply to {selectedCount} {selectedCount === 1 ? "Date" : "Dates"}
                  </Button>
                </div>
              </div>
            ) : (
              /* ── Collapsed bar ── */
              <div className="flex items-center justify-between px-4 py-3 md:px-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100">
                    <CalendarDays className="h-4 w-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      {selectedCount} {selectedCount === 1 ? "date" : "dates"} selected
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={openTemplatePanel}>
                    <LayoutTemplate className="mr-1.5 h-3.5 w-3.5" />
                    Apply Template
                  </Button>
                  {daySchedules.length > 0 && (
                    <Button size="sm" variant="outline" onClick={openSchedulePanel}>
                      <ListChecks className="mr-1.5 h-3.5 w-3.5" />
                      Day Schedule
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
