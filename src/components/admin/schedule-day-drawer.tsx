"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { cn, formatTimeInZone, toTimestamp } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  X,
  Clock,
  Plus,
  Trash2,
  Loader2,
  Save,
  LayoutTemplate,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────

type BayInfo = {
  id: string;
  name: string;
  hourly_rate_cents: number;
};

type TemplateInfo = {
  id: string;
  name: string;
  slotCount: number;
};

type ScheduleSlot = {
  id: string;
  bay_schedule_id: string;
  org_id: string;
  start_time: string;
  end_time: string;
  price_cents: number;
  status: string;
};

type BayScheduleData = {
  id: string;
  bay_id: string;
  template_id: string | null;
  slots: ScheduleSlot[];
};

type Props = {
  date: string;
  orgId: string;
  timezone: string;
  bays: BayInfo[];
  templates: TemplateInfo[];
  onClose: () => void;
};

// ─── Helpers ─────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { dot: string; bg: string; text: string }> =
  {
    available: {
      dot: "bg-green-400",
      bg: "bg-green-50 border-green-200",
      text: "text-green-700",
    },
    booked: {
      dot: "bg-blue-400",
      bg: "bg-blue-50 border-blue-200",
      text: "text-blue-700",
    },
    blocked: {
      dot: "bg-gray-400",
      bg: "bg-gray-100 border-gray-200",
      text: "text-gray-600",
    },
  };

function getLocalTimeStr(timestamp: string, tz: string): string {
  const d = new Date(timestamp);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value || "00";
  let h = get("hour");
  if (h === "24") h = "00";
  return `${h}:${get("minute")}:${get("second")}`;
}

function formatDateHeading(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Component ───────────────────────────────────────────────────

export function ScheduleDayDrawer({
  date,
  orgId,
  timezone,
  bays,
  templates,
  onClose,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState<Map<string, BayScheduleData>>(
    new Map()
  );

  const [activeBayId, setActiveBayId] = useState(bays[0]?.id || "");
  const [modifiedBays, setModifiedBays] = useState<Set<string>>(new Set());

  // Add slot
  const [addStartTime, setAddStartTime] = useState("");
  const [addEndTime, setAddEndTime] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  // Apply template
  const [applyTemplateId, setApplyTemplateId] = useState("");
  const [applyBayIds, setApplyBayIds] = useState<Set<string>>(
    () => new Set(bays.map((b) => b.id))
  );
  const [applyLoading, setApplyLoading] = useState(false);

  // Save as template
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState("");
  const [saveTemplateLoading, setSaveTemplateLoading] = useState(false);

  // Inline price edit
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [editPriceValue, setEditPriceValue] = useState("");

  // Feedback
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Mount + animate in
  useEffect(() => {
    setMounted(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true));
    });
  }, []);

  // Fetch schedule data
  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("bay_schedules")
        .select("id, bay_id, template_id, bay_schedule_slots(*)")
        .eq("org_id", orgId)
        .eq("date", date);

      const map = new Map<string, BayScheduleData>();
      for (const s of data || []) {
        map.set(s.bay_id, {
          id: s.id,
          bay_id: s.bay_id,
          template_id: s.template_id,
          slots: [...(s.bay_schedule_slots || [])].sort(
            (a: ScheduleSlot, b: ScheduleSlot) =>
              a.start_time.localeCompare(b.start_time)
          ),
        });
      }
      setSchedules(map);
      setLoading(false);
    }
    load();
  }, [date, orgId]);

  // ─── Animated close ──────────────────────────────────────────

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 300);
  }

  // ─── Actions ─────────────────────────────────────────────────

  async function handleAddSlot() {
    if (!addStartTime || !addEndTime) return;
    setAddLoading(true);
    setMessage(null);

    const supabase = createClient();
    const baySchedule = schedules.get(activeBayId);
    let scheduleId = baySchedule?.id;

    if (!scheduleId) {
      const { data, error } = await supabase
        .from("bay_schedules")
        .insert({ bay_id: activeBayId, org_id: orgId, date })
        .select("id")
        .single();

      if (error || !data) {
        setMessage({
          type: "error",
          text: error?.message || "Failed to create schedule",
        });
        setAddLoading(false);
        return;
      }
      scheduleId = data.id;
    }

    const bay = bays.find((b) => b.id === activeBayId);
    const hourlyRate = bay?.hourly_rate_cents || 0;
    const [sH, sM] = addStartTime.split(":").map(Number);
    const [eH, eM] = addEndTime.split(":").map(Number);
    const duration = eH * 60 + eM - (sH * 60 + sM);
    const priceCents = Math.round(hourlyRate * (duration / 60));

    const { data: slot, error } = await supabase
      .from("bay_schedule_slots")
      .insert({
        bay_schedule_id: scheduleId,
        org_id: orgId,
        start_time: toTimestamp(date, addStartTime, timezone),
        end_time: toTimestamp(date, addEndTime, timezone),
        price_cents: priceCents,
        status: "available",
      })
      .select()
      .single();

    if (error) {
      setMessage({ type: "error", text: error.message });
    } else if (slot) {
      setSchedules((prev) => {
        const next = new Map(prev);
        const existing = next.get(activeBayId);
        if (existing) {
          next.set(activeBayId, {
            ...existing,
            slots: [...existing.slots, slot].sort((a, b) =>
              a.start_time.localeCompare(b.start_time)
            ),
          });
        } else {
          next.set(activeBayId, {
            id: scheduleId!,
            bay_id: activeBayId,
            template_id: null,
            slots: [slot],
          });
        }
        return next;
      });
      setModifiedBays((prev) => new Set(prev).add(activeBayId));
      setAddStartTime("");
      setAddEndTime("");
    }

    setAddLoading(false);
  }

  async function handleDeleteSlot(slotId: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("bay_schedule_slots")
      .delete()
      .eq("id", slotId);

    if (error) {
      setMessage({ type: "error", text: error.message });
      return;
    }

    setSchedules((prev) => {
      const next = new Map(prev);
      const existing = next.get(activeBayId);
      if (existing) {
        next.set(activeBayId, {
          ...existing,
          slots: existing.slots.filter((s) => s.id !== slotId),
        });
      }
      return next;
    });
    setModifiedBays((prev) => new Set(prev).add(activeBayId));
  }

  async function handlePriceSave(slotId: string) {
    const parsed = parseFloat(editPriceValue);
    if (isNaN(parsed) || parsed < 0) {
      setEditingSlotId(null);
      return;
    }
    const newPrice = Math.round(parsed * 100);

    const supabase = createClient();
    const { error } = await supabase
      .from("bay_schedule_slots")
      .update({ price_cents: newPrice })
      .eq("id", slotId);

    if (!error) {
      setSchedules((prev) => {
        const next = new Map(prev);
        const existing = next.get(activeBayId);
        if (existing) {
          next.set(activeBayId, {
            ...existing,
            slots: existing.slots.map((s) =>
              s.id === slotId ? { ...s, price_cents: newPrice } : s
            ),
          });
        }
        return next;
      });
      setModifiedBays((prev) => new Set(prev).add(activeBayId));
    }
    setEditingSlotId(null);
  }

  async function handleToggleStatus(slotId: string, currentStatus: string) {
    const newStatus = currentStatus === "available" ? "blocked" : "available";
    const supabase = createClient();
    const { error } = await supabase
      .from("bay_schedule_slots")
      .update({ status: newStatus })
      .eq("id", slotId);

    if (!error) {
      setSchedules((prev) => {
        const next = new Map(prev);
        const existing = next.get(activeBayId);
        if (existing) {
          next.set(activeBayId, {
            ...existing,
            slots: existing.slots.map((s) =>
              s.id === slotId ? { ...s, status: newStatus } : s
            ),
          });
        }
        return next;
      });
    }
  }

  async function handleApplyTemplate() {
    if (!applyTemplateId || applyBayIds.size === 0) return;
    setApplyLoading(true);
    setMessage(null);

    const targetBayIds = Array.from(applyBayIds);
    const supabase = createClient();

    // 1. Fetch template slots
    const { data: templateSlots } = await supabase
      .from("template_slots")
      .select("id, start_time, end_time")
      .eq("template_id", applyTemplateId);

    if (!templateSlots?.length) {
      setMessage({ type: "error", text: "Template has no time slots" });
      setApplyLoading(false);
      return;
    }

    // 2. Fetch per-bay overrides for all target bays
    const { data: overrides } = await supabase
      .from("template_bay_overrides")
      .select("template_slot_id, bay_id, price_cents")
      .eq("template_id", applyTemplateId)
      .in("bay_id", targetBayIds);

    const overrideMap = new Map<string, number>();
    for (const o of overrides || []) {
      overrideMap.set(`${o.template_slot_id}:${o.bay_id}`, o.price_cents);
    }

    // 3. Build bay hourly rate lookup
    const bayRateMap = new Map<string, number>();
    for (const b of bays) {
      bayRateMap.set(b.id, b.hourly_rate_cents);
    }

    // 4. Batch upsert bay_schedules for all target bays
    const scheduleRows = targetBayIds.map((bayId) => ({
      bay_id: bayId,
      org_id: orgId,
      date,
      template_id: applyTemplateId,
    }));

    const { data: upsertedSchedules, error: schedError } = await supabase
      .from("bay_schedules")
      .upsert(scheduleRows, { onConflict: "bay_id,date" })
      .select("id, bay_id");

    if (schedError || !upsertedSchedules?.length) {
      setMessage({
        type: "error",
        text: schedError?.message || "Failed to create schedules",
      });
      setApplyLoading(false);
      return;
    }

    // 5. Delete old slots for all affected schedules
    const scheduleIds = upsertedSchedules.map((s) => s.id);
    await supabase
      .from("bay_schedule_slots")
      .delete()
      .in("bay_schedule_id", scheduleIds);

    // 6. Build concrete slots for all bays
    const allNewSlots: Array<{
      bay_schedule_id: string;
      org_id: string;
      start_time: string;
      end_time: string;
      price_cents: number;
      status: "available";
    }> = [];

    for (const sched of upsertedSchedules) {
      const hourlyRate = bayRateMap.get(sched.bay_id) || 0;
      for (const ts of templateSlots) {
        const [sH, sM] = ts.start_time.split(":").map(Number);
        const [eH, eM] = ts.end_time.split(":").map(Number);
        const dur = eH * 60 + eM - (sH * 60 + sM);
        const overridePrice = overrideMap.get(`${ts.id}:${sched.bay_id}`);
        const price =
          overridePrice !== undefined
            ? overridePrice
            : Math.round(hourlyRate * (dur / 60));

        allNewSlots.push({
          bay_schedule_id: sched.id,
          org_id: orgId,
          start_time: toTimestamp(date, ts.start_time, timezone),
          end_time: toTimestamp(date, ts.end_time, timezone),
          price_cents: price,
          status: "available",
        });
      }
    }

    const { data: insertedSlots, error: insertError } = await supabase
      .from("bay_schedule_slots")
      .insert(allNewSlots)
      .select();

    if (insertError) {
      setMessage({ type: "error", text: insertError.message });
    } else {
      // Update local state for all affected bays
      setSchedules((prev) => {
        const next = new Map(prev);
        for (const sched of upsertedSchedules) {
          const baySlots = (insertedSlots || [])
            .filter((s) => s.bay_schedule_id === sched.id)
            .sort((a, b) => a.start_time.localeCompare(b.start_time));
          next.set(sched.bay_id, {
            id: sched.id,
            bay_id: sched.bay_id,
            template_id: applyTemplateId,
            slots: baySlots,
          });
        }
        return next;
      });
      setModifiedBays((prev) => {
        const next = new Set(prev);
        for (const bayId of targetBayIds) next.delete(bayId);
        return next;
      });
      const bayCount = upsertedSchedules.length;
      setMessage({
        type: "success",
        text: `Template applied to ${bayCount} ${bayCount === 1 ? "bay" : "bays"}`,
      });
      setApplyTemplateId("");
    }

    setApplyLoading(false);
  }

  async function handleSaveAsTemplate() {
    if (!saveTemplateName.trim()) return;
    const baySchedule = schedules.get(activeBayId);
    if (!baySchedule || baySchedule.slots.length === 0) {
      setMessage({ type: "error", text: "No slots to save" });
      return;
    }

    setSaveTemplateLoading(true);
    setMessage(null);

    const supabase = createClient();
    const bay = bays.find((b) => b.id === activeBayId);

    // 1. Create template
    const { data: template, error: tError } = await supabase
      .from("schedule_templates")
      .insert({ org_id: orgId, name: saveTemplateName.trim() })
      .select("id")
      .single();

    if (tError || !template) {
      setMessage({
        type: "error",
        text: tError?.message || "Failed to create template",
      });
      setSaveTemplateLoading(false);
      return;
    }

    // 2. Create template slots from current schedule slots
    const slotInserts = baySchedule.slots.map((slot) => ({
      template_id: template.id,
      start_time: getLocalTimeStr(slot.start_time, timezone),
      end_time: getLocalTimeStr(slot.end_time, timezone),
    }));

    const { data: createdSlots, error: sError } = await supabase
      .from("template_slots")
      .insert(slotInserts)
      .select("id, start_time, end_time");

    if (sError || !createdSlots) {
      setMessage({
        type: "error",
        text: sError?.message || "Failed to create template slots",
      });
      setSaveTemplateLoading(false);
      return;
    }

    // 3. Create price overrides for slots with non-default pricing
    if (bay) {
      const overrideInserts: Array<{
        template_id: string;
        bay_id: string;
        template_slot_id: string;
        price_cents: number;
      }> = [];

      for (let i = 0; i < baySchedule.slots.length; i++) {
        const slot = baySchedule.slots[i];
        const templateSlot = createdSlots[i];
        if (!templateSlot) continue;

        const [sH, sM] = templateSlot.start_time.split(":").map(Number);
        const [eH, eM] = templateSlot.end_time.split(":").map(Number);
        const dur = eH * 60 + eM - (sH * 60 + sM);
        const defaultPrice = Math.round(
          bay.hourly_rate_cents * (dur / 60)
        );

        if (slot.price_cents !== defaultPrice) {
          overrideInserts.push({
            template_id: template.id,
            bay_id: activeBayId,
            template_slot_id: templateSlot.id,
            price_cents: slot.price_cents,
          });
        }
      }

      if (overrideInserts.length > 0) {
        await supabase
          .from("template_bay_overrides")
          .insert(overrideInserts);
      }
    }

    // 4. Update bay_schedule to reference new template
    await supabase
      .from("bay_schedules")
      .update({ template_id: template.id })
      .eq("id", baySchedule.id);

    setSchedules((prev) => {
      const next = new Map(prev);
      next.set(activeBayId, { ...baySchedule, template_id: template.id });
      return next;
    });
    setModifiedBays((prev) => {
      const next = new Set(prev);
      next.delete(activeBayId);
      return next;
    });

    setMessage({
      type: "success",
      text: `Template "${saveTemplateName.trim()}" created`,
    });
    setSaveTemplateName("");
    setSaveTemplateOpen(false);
    setSaveTemplateLoading(false);
  }

  async function handleClearAll() {
    const baySchedule = schedules.get(activeBayId);
    if (!baySchedule) return;

    const hasBooked = baySchedule.slots.some((s) => s.status === "booked");
    if (hasBooked) {
      setMessage({
        type: "error",
        text: "Cannot clear: some slots have active bookings",
      });
      return;
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("bay_schedules")
      .delete()
      .eq("id", baySchedule.id);

    if (error) {
      setMessage({ type: "error", text: error.message });
      return;
    }

    setSchedules((prev) => {
      const next = new Map(prev);
      next.delete(activeBayId);
      return next;
    });
    setModifiedBays((prev) => {
      const next = new Set(prev);
      next.delete(activeBayId);
      return next;
    });
  }

  // ─── Derived ─────────────────────────────────────────────────

  const baySchedule = schedules.get(activeBayId);
  const sortedSlots = baySchedule?.slots || [];

  const showSaveAsTemplate =
    sortedSlots.length > 0 &&
    (!baySchedule?.template_id || modifiedBays.has(activeBayId));

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
            <h2 className="text-lg font-bold text-gray-800">Edit Schedule</h2>
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

        {/* Bay tabs */}
        {bays.length > 1 && (
          <div className="border-b border-gray-200 px-4 md:px-6">
            <div className="-mb-px flex gap-1 overflow-x-auto">
              {bays.map((bay) => {
                const bayData = schedules.get(bay.id);
                const slotCount = bayData?.slots.length || 0;
                return (
                  <button
                    key={bay.id}
                    onClick={() => {
                      setActiveBayId(bay.id);
                      setEditingSlotId(null);
                      setMessage(null);
                      setSaveTemplateOpen(false);
                    }}
                    className={cn(
                      "shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition-colors",
                      bay.id === activeBayId
                        ? "border-blue-600 text-blue-600"
                        : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                    )}
                  >
                    {bay.name}
                    {slotCount > 0 && (
                      <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                        {slotCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="p-4 md:p-6">
              {/* Feedback message */}
              {message && (
                <div
                  className={cn(
                    "mb-4 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm",
                    message.type === "success"
                      ? "border-green-200 bg-green-50 text-green-700"
                      : "border-red-200 bg-red-50 text-red-700"
                  )}
                >
                  {message.type === "success" ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0" />
                  )}
                  {message.text}
                </div>
              )}

              {/* Slot list */}
              {sortedSlots.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-gray-200 py-10 text-center">
                  <Clock className="mx-auto h-8 w-8 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">
                    No slots for this bay. Apply a template or add slots
                    manually.
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                          Time
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                          Price
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                          Status
                        </th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-gray-500">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {sortedSlots.map((slot) => {
                        const isEditing = editingSlotId === slot.id;
                        const colors =
                          STATUS_COLORS[slot.status] ||
                          STATUS_COLORS.available;

                        return (
                          <tr
                            key={slot.id}
                            className="transition-colors hover:bg-gray-50"
                          >
                            <td className="px-4 py-3">
                              <span className="font-mono text-sm text-gray-800">
                                {formatTimeInZone(
                                  slot.start_time,
                                  timezone
                                )}{" "}
                                –{" "}
                                {formatTimeInZone(
                                  slot.end_time,
                                  timezone
                                )}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {isEditing ? (
                                <div className="flex items-center gap-1">
                                  <span className="text-sm text-gray-400">
                                    $
                                  </span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={editPriceValue}
                                    onChange={(e) =>
                                      setEditPriceValue(e.target.value)
                                    }
                                    onBlur={() => handlePriceSave(slot.id)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter")
                                        handlePriceSave(slot.id);
                                      if (e.key === "Escape")
                                        setEditingSlotId(null);
                                    }}
                                    autoFocus
                                    className="h-8 w-20 rounded-md border border-blue-400 bg-white px-2 text-right text-sm text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                  />
                                </div>
                              ) : (
                                <button
                                  onClick={() => {
                                    setEditingSlotId(slot.id);
                                    setEditPriceValue(
                                      (slot.price_cents / 100).toFixed(2)
                                    );
                                  }}
                                  className="text-sm font-medium text-gray-700 transition-colors hover:text-blue-600"
                                  title="Click to edit price"
                                >
                                  $
                                  {(slot.price_cents / 100).toFixed(2)}
                                </button>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {slot.status === "booked" ? (
                                <span
                                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${colors.bg} ${colors.text}`}
                                >
                                  <span
                                    className={`h-1.5 w-1.5 rounded-full ${colors.dot}`}
                                  />
                                  {slot.status}
                                </span>
                              ) : (
                                <button
                                  onClick={() =>
                                    handleToggleStatus(
                                      slot.id,
                                      slot.status
                                    )
                                  }
                                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors hover:opacity-80 ${colors.bg} ${colors.text}`}
                                  title={`Click to ${slot.status === "available" ? "block" : "unblock"}`}
                                >
                                  <span
                                    className={`h-1.5 w-1.5 rounded-full ${colors.dot}`}
                                  />
                                  {slot.status}
                                </button>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {slot.status !== "booked" && (
                                <button
                                  onClick={() =>
                                    handleDeleteSlot(slot.id)
                                  }
                                  className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-50 hover:text-red-600"
                                  title="Delete slot"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Add slot form */}
              <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">
                  Add Slot
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">Start</label>
                    <input
                      type="time"
                      value={addStartTime}
                      onChange={(e) => setAddStartTime(e.target.value)}
                      className="h-9 w-32 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">End</label>
                    <input
                      type="time"
                      value={addEndTime}
                      onChange={(e) => setAddEndTime(e.target.value)}
                      className="h-9 w-32 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={handleAddSlot}
                    disabled={addLoading || !addStartTime || !addEndTime}
                    className="h-9 gap-1.5 rounded-lg"
                  >
                    {addLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    Add Slot
                  </Button>
                </div>
              </div>

              {/* Apply template */}
              {templates.length > 0 && (
                <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
                  <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">
                    Apply Template
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <select
                      value={applyTemplateId}
                      onChange={(e) => setApplyTemplateId(e.target.value)}
                      className="h-9 min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10"
                    >
                      <option value="">Select a template...</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.slotCount}{" "}
                          {t.slotCount === 1 ? "slot" : "slots"})
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleApplyTemplate}
                      disabled={
                        applyLoading ||
                        !applyTemplateId ||
                        applyBayIds.size === 0
                      }
                      className="h-9 gap-1.5 rounded-lg"
                    >
                      {applyLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <LayoutTemplate className="h-3.5 w-3.5" />
                      )}
                      Apply
                    </Button>
                  </div>

                  {/* Bay selection */}
                  <div className="mt-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <label className="flex cursor-pointer items-center gap-2 py-1">
                        <input
                          type="checkbox"
                          checked={applyBayIds.size === bays.length}
                          onChange={() => {
                            if (applyBayIds.size === bays.length) {
                              setApplyBayIds(new Set());
                            } else {
                              setApplyBayIds(
                                new Set(bays.map((b) => b.id))
                              );
                            }
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm font-medium text-gray-700">
                          All Bays
                        </span>
                      </label>
                      {bays.map((bay) => (
                        <label
                          key={bay.id}
                          className="flex cursor-pointer items-center gap-2 py-1"
                        >
                          <input
                            type="checkbox"
                            checked={applyBayIds.has(bay.id)}
                            onChange={() => {
                              setApplyBayIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(bay.id)) {
                                  next.delete(bay.id);
                                } else {
                                  next.add(bay.id);
                                }
                                return next;
                              });
                            }}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-600">
                            {bay.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {applyBayIds.size > 0 &&
                    bays.some(
                      (b) =>
                        applyBayIds.has(b.id) &&
                        (schedules.get(b.id)?.slots.length ?? 0) > 0
                    ) && (
                      <p className="mt-2 text-xs text-amber-600">
                        Existing slots will be replaced for selected bays.
                      </p>
                    )}
                </div>
              )}

              {/* Save as Template + Clear All */}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {showSaveAsTemplate && (
                  <div className="flex-1">
                    {saveTemplateOpen ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={saveTemplateName}
                          onChange={(e) =>
                            setSaveTemplateName(e.target.value)
                          }
                          placeholder="Template name..."
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveAsTemplate();
                            if (e.key === "Escape")
                              setSaveTemplateOpen(false);
                          }}
                          autoFocus
                          className="h-9 min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10"
                        />
                        <Button
                          size="sm"
                          onClick={handleSaveAsTemplate}
                          disabled={
                            saveTemplateLoading ||
                            !saveTemplateName.trim()
                          }
                          className="h-9 gap-1.5 rounded-lg"
                        >
                          {saveTemplateLoading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSaveTemplateOpen(false)}
                          className="h-9 rounded-lg"
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSaveTemplateOpen(true)}
                        className="gap-1.5 rounded-lg border-gray-200"
                      >
                        <Save className="h-3.5 w-3.5" />
                        Save as Template
                      </Button>
                    )}
                  </div>
                )}

                {baySchedule && baySchedule.slots.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleClearAll}
                    className="gap-1.5 rounded-lg border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Clear All Slots
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
