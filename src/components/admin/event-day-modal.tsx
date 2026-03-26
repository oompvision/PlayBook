"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { cn, formatTimeInZone, formatPrice } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  X,
  Pencil,
  Trash2,
  Loader2,
  Plus,
  ChevronDown,
  Save,
  ExternalLink,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────

type EventDayModalProps = {
  date: string; // "2026-03-25"
  orgId: string;
  timezone: string;
  eventTemplates: {
    id: string;
    name: string;
    color: string;
    start_time: string | null;
    end_time: string | null;
  }[];
  onClose: () => void;
  onUpdateEvent: (
    eventId: string,
    updates: {
      start_time?: string;
      end_time?: string;
      capacity?: number;
      price_cents?: number;
    }
  ) => Promise<{ success: boolean; error?: string }>;
  onDeleteEvent: (
    eventId: string
  ) => Promise<{ success: boolean; error?: string }>;
  onAddEventFromTemplate: (
    templateId: string,
    date: string
  ) => Promise<{ success: boolean; error?: string }>;
  onSaveDaySchedule: (
    date: string,
    name: string
  ) => Promise<{ success: boolean; error?: string }>;
};

type EventRow = {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  capacity: number;
  price_cents: number;
  status: string;
  template_id: string | null;
  bay_names: string[];
  registration_count: number;
};

// ─── Helpers ─────────────────────────────────────────────────────

function formatDateHeading(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const STATUS_STYLES: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  draft: {
    bg: "bg-yellow-100 border-yellow-300",
    text: "text-yellow-800",
    label: "Draft",
  },
  published: {
    bg: "bg-green-100 border-green-300",
    text: "text-green-800",
    label: "Published",
  },
  cancelled: {
    bg: "bg-red-100 border-red-300",
    text: "text-red-800",
    label: "Cancelled",
  },
  completed: {
    bg: "bg-gray-100 border-gray-300",
    text: "text-gray-700",
    label: "Completed",
  },
};

const DEFAULT_EVENT_COLOR = "#6366f1";

// ─── Component ───────────────────────────────────────────────────

export function EventDayModal({
  date,
  orgId,
  timezone,
  eventTemplates,
  onClose,
  onUpdateEvent,
  onDeleteEvent,
  onAddEventFromTemplate,
  onSaveDaySchedule,
}: EventDayModalProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<EventRow[]>([]);

  // Inline edit state
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    start_time: "",
    end_time: "",
    capacity: 0,
    price_cents: 0,
  });
  const [editSaving, setEditSaving] = useState(false);

  // Add from template state
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [addingFromTemplate, setAddingFromTemplate] = useState(false);

  // Save as day schedule state
  const [showSaveSchedule, setShowSaveSchedule] = useState(false);
  const [scheduleName, setScheduleName] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);

  // Feedback
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Deleting state
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);

  // Mount + animate in
  useEffect(() => {
    setMounted(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true));
    });
  }, []);

  // Fetch events for the date
  useEffect(() => {
    fetchEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, orgId]);

  async function fetchEvents() {
    setLoading(true);
    const supabase = createClient();

    // Build timezone-aware day boundaries for the query
    // We filter events whose start_time falls on this calendar date in the facility timezone
    const dayStartUTC = new Date(
      new Date(`${date}T00:00:00`).toLocaleString("en-US", {
        timeZone: timezone,
      })
    );
    const dayEndUTC = new Date(dayStartUTC);
    dayEndUTC.setDate(dayEndUTC.getDate() + 1);

    // Query events that start on the given date
    const { data: eventsData, error: eventsError } = await supabase
      .from("events")
      .select(
        `
        id,
        name,
        start_time,
        end_time,
        capacity,
        price_cents,
        status,
        template_id,
        event_bays (
          bay_id,
          bays:bay_id ( name )
        )
      `
      )
      .eq("org_id", orgId)
      .gte("start_time", `${date}T00:00:00`)
      .lt("start_time", `${date}T23:59:59.999`)
      .order("start_time", { ascending: true });

    if (eventsError) {
      console.error("Failed to fetch events:", eventsError);
      setLoading(false);
      return;
    }

    // Get registration counts for all events
    const eventIds = (eventsData || []).map((e: { id: string }) => e.id);
    const regCounts: Record<string, number> = {};

    if (eventIds.length > 0) {
      const { data: regData } = await supabase
        .from("event_registrations")
        .select("event_id")
        .in("event_id", eventIds)
        .in("status", ["confirmed", "pending_payment"]);

      for (const r of regData || []) {
        regCounts[r.event_id] = (regCounts[r.event_id] || 0) + 1;
      }
    }

    const eventRows: EventRow[] = [];
    for (const ev of eventsData || []) {
      const bayNames = (ev.event_bays || []).map(
        (eb: { bay_id: string; bays: { name: string } | null }) =>
          eb.bays?.name || "Unknown"
      );

      eventRows.push({
        id: ev.id,
        name: ev.name,
        start_time: ev.start_time,
        end_time: ev.end_time,
        capacity: ev.capacity,
        price_cents: ev.price_cents,
        status: ev.status,
        template_id: ev.template_id,
        bay_names: bayNames,
        registration_count: regCounts[ev.id] || 0,
      });
    }

    setEvents(eventRows);
    setLoading(false);
  }

  // ─── Animated close ──────────────────────────────────────────

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 300);
  }

  // ─── Inline edit handlers ────────────────────────────────────

  function startEditing(event: EventRow) {
    const formatTime = (ts: string) => {
      const d = new Date(ts);
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(d);
      const get = (type: string) =>
        parts.find((p) => p.type === type)?.value || "00";
      let h = get("hour");
      if (h === "24") h = "00";
      return `${h}:${get("minute")}`;
    };

    setEditingEventId(event.id);
    setEditForm({
      start_time: formatTime(event.start_time),
      end_time: formatTime(event.end_time),
      capacity: event.capacity,
      price_cents: event.price_cents,
    });
  }

  async function handleSaveEdit() {
    if (!editingEventId) return;
    setEditSaving(true);
    setMessage(null);

    const updates: {
      start_time?: string;
      end_time?: string;
      capacity?: number;
      price_cents?: number;
    } = {
      start_time: `${date}T${editForm.start_time}:00`,
      end_time: `${date}T${editForm.end_time}:00`,
      capacity: editForm.capacity,
      price_cents: editForm.price_cents,
    };

    const result = await onUpdateEvent(editingEventId, updates);

    if (result.success) {
      setMessage({ type: "success", text: "Event updated" });
      setEditingEventId(null);
      await fetchEvents();
    } else {
      setMessage({
        type: "error",
        text: result.error || "Failed to update event",
      });
    }

    setEditSaving(false);
  }

  // ─── Delete handler ──────────────────────────────────────────

  async function handleDelete(eventId: string) {
    const confirmed = window.confirm(
      "Are you sure you want to delete this draft event?"
    );
    if (!confirmed) return;

    setDeletingEventId(eventId);
    setMessage(null);

    const result = await onDeleteEvent(eventId);

    if (result.success) {
      setMessage({ type: "success", text: "Event deleted" });
      await fetchEvents();
    } else {
      setMessage({
        type: "error",
        text: result.error || "Failed to delete event",
      });
    }

    setDeletingEventId(null);
  }

  // ─── Add from template handler ───────────────────────────────

  async function handleAddFromTemplate(templateId: string) {
    setAddingFromTemplate(true);
    setMessage(null);

    const result = await onAddEventFromTemplate(templateId, date);

    if (result.success) {
      setMessage({ type: "success", text: "Event created from template" });
      setShowTemplateDropdown(false);
      await fetchEvents();
    } else {
      setMessage({
        type: "error",
        text: result.error || "Failed to create event",
      });
    }

    setAddingFromTemplate(false);
  }

  // ─── Save as day schedule handler ────────────────────────────

  async function handleSaveDaySchedule() {
    if (!scheduleName.trim()) return;
    setSavingSchedule(true);
    setMessage(null);

    const result = await onSaveDaySchedule(date, scheduleName.trim());

    if (result.success) {
      setMessage({ type: "success", text: "Day schedule saved" });
      setShowSaveSchedule(false);
      setScheduleName("");
    } else {
      setMessage({
        type: "error",
        text: result.error || "Failed to save day schedule",
      });
    }

    setSavingSchedule(false);
  }

  // ─── Render ──────────────────────────────────────────────────

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-black/40 transition-opacity duration-300",
          visible ? "opacity-100" : "opacity-0"
        )}
        onClick={handleClose}
      />

      {/* Drawer */}
      <div
        className={cn(
          "relative flex max-h-[85vh] flex-col rounded-t-2xl bg-white shadow-2xl transition-transform duration-300 lg:ml-[280px]",
          visible ? "translate-y-0" : "translate-y-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4 md:px-6">
          <div>
            <h2 className="text-lg font-bold text-gray-800">Events</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              {formatDateHeading(date)}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Feedback message */}
        {message && (
          <div
            className={cn(
              "mx-4 mt-3 rounded-lg border px-3 py-2 text-sm md:mx-6",
              message.type === "success"
                ? "border-green-200 bg-green-50 text-green-700"
                : "border-red-200 bg-red-50 text-red-700"
            )}
          >
            {message.text}
          </div>
        )}

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              <span className="ml-2 text-sm text-gray-500">
                Loading events...
              </span>
            </div>
          ) : events.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-gray-500">
                No events scheduled for this day.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {events.map((event) => {
                const templateConfig = event.template_id
                  ? eventTemplates.find((t) => t.id === event.template_id)
                  : null;
                const dotColor = templateConfig?.color || DEFAULT_EVENT_COLOR;
                const statusStyle =
                  STATUS_STYLES[event.status] || STATUS_STYLES.draft;

                return (
                  <div
                    key={event.id}
                    className="rounded-lg border border-gray-200 bg-white"
                  >
                    {/* Event row */}
                    <div className="flex items-start gap-3 p-3">
                      {/* Color dot */}
                      <div
                        className="mt-1.5 h-3 w-3 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: dotColor }}
                      />

                      {/* Event info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="font-semibold text-gray-900">
                              {event.name}
                            </h3>
                            <p className="mt-0.5 text-sm text-gray-600">
                              {formatTimeInZone(event.start_time, timezone)} -{" "}
                              {formatTimeInZone(event.end_time, timezone)}
                            </p>
                          </div>

                          {/* Status badge */}
                          <span
                            className={cn(
                              "inline-flex flex-shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-semibold",
                              statusStyle.bg,
                              statusStyle.text
                            )}
                          >
                            {statusStyle.label}
                          </span>
                        </div>

                        {/* Meta row */}
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                          <span>
                            {event.registration_count}/{event.capacity}{" "}
                            registered
                          </span>
                          {event.price_cents > 0 && (
                            <span>{formatPrice(event.price_cents)}</span>
                          )}
                          {event.bay_names.length > 0 && (
                            <span>{event.bay_names.join(", ")}</span>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex flex-shrink-0 items-center gap-1">
                        <button
                          onClick={() =>
                            editingEventId === event.id
                              ? setEditingEventId(null)
                              : startEditing(event)
                          }
                          className={cn(
                            "rounded-md p-1.5 transition-colors",
                            editingEventId === event.id
                              ? "bg-blue-100 text-blue-600"
                              : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                          )}
                          title="Edit event"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>

                        <a
                          href={`/admin/events/${event.id}/edit`}
                          className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                          title="Full edit page"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>

                        {event.status === "draft" && (
                          <button
                            onClick={() => handleDelete(event.id)}
                            disabled={deletingEventId === event.id}
                            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                            title="Delete draft event"
                          >
                            {deletingEventId === event.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Inline edit form */}
                    {editingEventId === event.id && (
                      <div className="border-t border-gray-100 bg-gray-50 p-3">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                          <div>
                            <label className="mb-1 block text-xs font-medium text-gray-600">
                              Start Time
                            </label>
                            <input
                              type="time"
                              value={editForm.start_time}
                              onChange={(e) =>
                                setEditForm((f) => ({
                                  ...f,
                                  start_time: e.target.value,
                                }))
                              }
                              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-gray-600">
                              End Time
                            </label>
                            <input
                              type="time"
                              value={editForm.end_time}
                              onChange={(e) =>
                                setEditForm((f) => ({
                                  ...f,
                                  end_time: e.target.value,
                                }))
                              }
                              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-gray-600">
                              Capacity
                            </label>
                            <input
                              type="number"
                              min={1}
                              value={editForm.capacity}
                              onChange={(e) =>
                                setEditForm((f) => ({
                                  ...f,
                                  capacity: parseInt(e.target.value) || 1,
                                }))
                              }
                              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-gray-600">
                              Price ($)
                            </label>
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              value={(editForm.price_cents / 100).toFixed(2)}
                              onChange={(e) =>
                                setEditForm((f) => ({
                                  ...f,
                                  price_cents: Math.round(
                                    parseFloat(e.target.value || "0") * 100
                                  ),
                                }))
                              }
                              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={handleSaveEdit}
                            disabled={editSaving}
                          >
                            {editSaving ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Save className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            Save Changes
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingEventId(null)}
                            disabled={editSaving}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t border-gray-200 px-4 py-3 md:px-6">
          <div className="flex flex-wrap items-center gap-2">
            {/* Add Event from Template */}
            <div className="relative">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowTemplateDropdown(!showTemplateDropdown);
                  setShowSaveSchedule(false);
                }}
                disabled={addingFromTemplate || eventTemplates.length === 0}
              >
                {addingFromTemplate ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                )}
                Add Event
                <ChevronDown className="ml-1 h-3.5 w-3.5" />
              </Button>

              {showTemplateDropdown && (
                <div className="absolute bottom-full left-0 z-10 mb-1 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  <div className="px-3 py-1.5 text-xs font-medium text-gray-500">
                    Select Template
                  </div>
                  {eventTemplates.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => handleAddFromTemplate(template.id)}
                      disabled={addingFromTemplate}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                    >
                      <div
                        className="h-2.5 w-2.5 rounded-full"
                        style={{
                          backgroundColor:
                            template.color || DEFAULT_EVENT_COLOR,
                        }}
                      />
                      {template.name}
                    </button>
                  ))}
                  {eventTemplates.length === 0 && (
                    <p className="px-3 py-2 text-xs text-gray-400">
                      No templates available
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Save as Day Schedule */}
            <div className="relative">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowSaveSchedule(!showSaveSchedule);
                  setShowTemplateDropdown(false);
                }}
                disabled={events.length === 0 || savingSchedule}
              >
                <Save className="mr-1.5 h-3.5 w-3.5" />
                Save as Day Schedule
              </Button>

              {showSaveSchedule && (
                <div className="absolute bottom-full left-0 z-10 mb-1 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
                  <label className="mb-1.5 block text-xs font-medium text-gray-600">
                    Schedule Name
                  </label>
                  <input
                    type="text"
                    value={scheduleName}
                    onChange={(e) => setScheduleName(e.target.value)}
                    placeholder="e.g., Weekend Events"
                    className="mb-2 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveDaySchedule();
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={handleSaveDaySchedule}
                    disabled={!scheduleName.trim() || savingSchedule}
                    className="w-full"
                  >
                    {savingSchedule ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Save
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
