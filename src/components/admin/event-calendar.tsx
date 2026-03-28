"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Loader2,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────

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
  onOpenDay: (date: string) => void;
};

// ─── Helpers ─────────────────────────────────────────────────────

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function formatDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ─── Component ──────────────────────────────────────────────────

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
  const todayDate = new Date(today + "T12:00:00");
  const [year, setYear] = useState(todayDate.getFullYear());
  const [month, setMonth] = useState(todayDate.getMonth());
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [applyMode, setApplyMode] = useState<"template" | "schedule" | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>("");
  const [selectedBayIds, setSelectedBayIds] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const daysInMonth = useMemo(() => getDaysInMonth(year, month), [year, month]);
  const firstDayOfWeek = useMemo(() => getFirstDayOfWeek(year, month), [year, month]);

  function prevMonth() {
    if (month === 0) { setYear(year - 1); setMonth(11); }
    else setMonth(month - 1);
    setSelectedDates(new Set());
  }

  function nextMonth() {
    if (month === 11) { setYear(year + 1); setMonth(0); }
    else setMonth(month + 1);
    setSelectedDates(new Set());
  }

  function toggleDate(dateStr: string) {
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr);
      else next.add(dateStr);
      return next;
    });
  }

  async function handleApply(status: "draft" | "published") {
    if (selectedDates.size === 0) return;
    const dates = Array.from(selectedDates).sort();
    setApplying(true);
    setMessage(null);

    try {
      let result: ApplyResult;
      if (applyMode === "template" && selectedTemplateId) {
        result = await onApplyEventTemplate(selectedTemplateId, selectedBayIds, dates, status);
      } else if (applyMode === "schedule" && selectedScheduleId) {
        result = await onApplyDaySchedule(selectedScheduleId, dates, status);
      } else {
        setApplying(false);
        return;
      }

      if (result.success) {
        setMessage({ type: "success", text: `Created ${result.count} event${result.count !== 1 ? "s" : ""} as ${status}` });
        setSelectedDates(new Set());
      } else {
        setMessage({ type: "error", text: result.error || "Failed to apply" });
      }
    } catch {
      setMessage({ type: "error", text: "An error occurred" });
    } finally {
      setApplying(false);
    }
  }

  // Build calendar grid
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-lg font-semibold">
          {MONTH_NAMES[month]} {year}
        </h2>
        <Button variant="outline" size="sm" onClick={nextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Calendar grid */}
      <div className="rounded-lg border bg-card">
        <div className="grid grid-cols-7">
          {DAY_NAMES.map((d) => (
            <div key={d} className="px-2 py-1.5 text-center text-xs font-medium text-muted-foreground border-b">
              {d}
            </div>
          ))}

          {cells.map((day, i) => {
            if (day === null) {
              return <div key={`empty-${i}`} className="min-h-[80px] border-b border-r last:border-r-0 bg-muted/30" />;
            }

            const dateStr = formatDateStr(year, month, day);
            const events = eventMap[dateStr] || [];
            const isToday = dateStr === today;
            const isSelected = selectedDates.has(dateStr);
            const isPast = dateStr < today;

            return (
              <div
                key={dateStr}
                className={cn(
                  "min-h-[80px] border-b border-r last:border-r-0 p-1 cursor-pointer transition-colors",
                  isToday && "bg-blue-50 dark:bg-blue-950/30",
                  isSelected && "bg-blue-100 dark:bg-blue-900/40 ring-2 ring-inset ring-blue-500",
                  isPast && "opacity-50",
                  !isPast && !isSelected && "hover:bg-muted/50"
                )}
                onClick={() => {
                  if (!isPast) toggleDate(dateStr);
                }}
                onDoubleClick={() => onOpenDay(dateStr)}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "text-xs font-medium",
                      isToday && "bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center"
                    )}
                  >
                    {day}
                  </span>
                  {isSelected && (
                    <Check className="h-3 w-3 text-blue-600" />
                  )}
                </div>
                {events.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {events.slice(0, 3).map((e) => (
                      <div
                        key={e.id}
                        className="text-[10px] leading-tight truncate rounded px-1 py-0.5 text-white"
                        style={{ backgroundColor: e.color }}
                        title={`${e.name} (${e.status})`}
                      >
                        {e.name}
                      </div>
                    ))}
                    {events.length > 3 && (
                      <div className="text-[10px] text-muted-foreground px-1">
                        +{events.length - 3} more
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Apply toolbar */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CalendarIcon className="h-4 w-4" />
          Apply to Selected Dates ({selectedDates.size})
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant={applyMode === "template" ? "default" : "outline"}
            size="sm"
            onClick={() => setApplyMode(applyMode === "template" ? null : "template")}
          >
            Event Template
          </Button>
          {daySchedules.length > 0 && (
            <Button
              variant={applyMode === "schedule" ? "default" : "outline"}
              size="sm"
              onClick={() => setApplyMode(applyMode === "schedule" ? null : "schedule")}
            >
              Day Schedule
            </Button>
          )}
        </div>

        {applyMode === "template" && (
          <div className="space-y-2">
            <select
              className="w-full rounded-md border px-3 py-2 text-sm bg-background"
              value={selectedTemplateId}
              onChange={(e) => {
                setSelectedTemplateId(e.target.value);
                const tpl = eventTemplates.find((t) => t.id === e.target.value);
                setSelectedBayIds(tpl?.bay_ids || []);
              }}
            >
              <option value="">Select a template...</option>
              {eventTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.start_time && t.end_time ? `(${t.start_time}–${t.end_time})` : ""}
                </option>
              ))}
            </select>

            {selectedTemplateId && bays.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Assign to bays:</label>
                <div className="flex flex-wrap gap-2">
                  {bays.map((bay) => (
                    <label key={bay.id} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedBayIds.includes(bay.id)}
                        onChange={(e) => {
                          setSelectedBayIds((prev) =>
                            e.target.checked
                              ? [...prev, bay.id]
                              : prev.filter((id) => id !== bay.id)
                          );
                        }}
                      />
                      {bay.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {applyMode === "schedule" && (
          <select
            className="w-full rounded-md border px-3 py-2 text-sm bg-background"
            value={selectedScheduleId}
            onChange={(e) => setSelectedScheduleId(e.target.value)}
          >
            <option value="">Select a day schedule...</option>
            {daySchedules.map((ds) => (
              <option key={ds.id} value={ds.id}>
                {ds.name} ({ds.entryCount} event{ds.entryCount !== 1 ? "s" : ""})
              </option>
            ))}
          </select>
        )}

        {applyMode && selectedDates.size > 0 && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={applying || (!selectedTemplateId && !selectedScheduleId)}
              onClick={() => handleApply("draft")}
            >
              {applying ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Apply as Draft
            </Button>
            <Button
              size="sm"
              disabled={applying || (!selectedTemplateId && !selectedScheduleId)}
              onClick={() => handleApply("published")}
            >
              {applying ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Apply & Publish
            </Button>
          </div>
        )}

        {message && (
          <p className={cn("text-sm", message.type === "success" ? "text-green-600" : "text-red-600")}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
