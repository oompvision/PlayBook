"use client";

import { useState, useEffect, useMemo } from "react";
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
  Check,
  Undo2,
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

function cloneSchedules(
  map: Map<string, BayScheduleData>
): Map<string, BayScheduleData> {
  return new Map(
    Array.from(map.entries()).map(([k, v]) => [
      k,
      { ...v, slots: v.slots.map((s) => ({ ...s })) },
    ])
  );
}

let tempCounter = 0;
function tempId(): string {
  return `temp-${++tempCounter}-${Date.now()}`;
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

  // Working copy (local edits go here)
  const [schedules, setSchedules] = useState<Map<string, BayScheduleData>>(
    new Map()
  );
  // Snapshot of last saved/fetched DB state
  const [savedSchedules, setSavedSchedules] = useState<
    Map<string, BayScheduleData>
  >(new Map());
  // Slot IDs marked for deletion on save
  const [deletedSlotIds, setDeletedSlotIds] = useState<Set<string>>(new Set());

  const [activeBayId, setActiveBayId] = useState(bays[0]?.id || "");

  // Add slot
  const [addStartTime, setAddStartTime] = useState("");
  const [addEndTime, setAddEndTime] = useState("");

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

  // Template slot data for duplicate detection
  const [templateSlotMap, setTemplateSlotMap] = useState<
    Map<string, Array<{ start_time: string; end_time: string }>>
  >(new Map());

  // Inline price edit
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [editPriceValue, setEditPriceValue] = useState("");

  // Save / discard
  const [saving, setSaving] = useState(false);

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
    fetchSchedules();
  }, [date, orgId]);

  async function fetchSchedules() {
    setLoading(true);
    const supabase = createClient();

    const [schedResult, tplResult] = await Promise.all([
      supabase
        .from("bay_schedules")
        .select("id, bay_id, template_id, bay_schedule_slots(*)")
        .eq("org_id", orgId)
        .eq("date", date),
      supabase
        .from("schedule_templates")
        .select("id, template_slots(start_time, end_time)")
        .eq("org_id", orgId),
    ]);

    const map = new Map<string, BayScheduleData>();
    for (const s of schedResult.data || []) {
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

    const tplMap = new Map<
      string,
      Array<{ start_time: string; end_time: string }>
    >();
    for (const t of tplResult.data || []) {
      tplMap.set(
        t.id,
        [...(t.template_slots || [])].sort(
          (
            a: { start_time: string; end_time: string },
            b: { start_time: string; end_time: string }
          ) => a.start_time.localeCompare(b.start_time)
        )
      );
    }

    setSchedules(map);
    setSavedSchedules(cloneSchedules(map));
    setDeletedSlotIds(new Set());
    setTemplateSlotMap(tplMap);
    setLoading(false);
  }

  // ─── Unsaved changes detection ────────────────────────────────

  const hasChanges = useMemo(() => {
    if (deletedSlotIds.size > 0) return true;
    for (const [bayId, data] of schedules) {
      if (data.slots.some((s) => s.id.startsWith("temp-"))) return true;
      const orig = savedSchedules.get(bayId);
      if (!orig) {
        if (data.slots.length > 0) return true;
        continue;
      }
      for (const slot of data.slots) {
        if (slot.id.startsWith("temp-")) continue;
        const origSlot = orig.slots.find((s) => s.id === slot.id);
        if (!origSlot) continue;
        if (
          slot.price_cents !== origSlot.price_cents ||
          slot.status !== origSlot.status
        )
          return true;
      }
    }
    return false;
  }, [schedules, savedSchedules, deletedSlotIds]);

  // ─── Animated close ──────────────────────────────────────────

  function handleClose() {
    if (hasChanges) {
      const confirmed = window.confirm(
        "You have unsaved changes. Discard and close?"
      );
      if (!confirmed) return;
    }
    setVisible(false);
    setTimeout(onClose, 300);
  }

  // ─── Local-only slot edits ───────────────────────────────────

  function handleAddSlot() {
    if (!addStartTime || !addEndTime) return;
    setMessage(null);

    const bay = bays.find((b) => b.id === activeBayId);
    const hourlyRate = bay?.hourly_rate_cents || 0;
    const [sH, sM] = addStartTime.split(":").map(Number);
    const [eH, eM] = addEndTime.split(":").map(Number);
    const duration = eH * 60 + eM - (sH * 60 + sM);
    const priceCents = Math.round(hourlyRate * (duration / 60));

    const existing = schedules.get(activeBayId);
    const scheduleId = existing?.id || `temp-sched-${activeBayId}`;

    const newSlot: ScheduleSlot = {
      id: tempId(),
      bay_schedule_id: scheduleId,
      org_id: orgId,
      start_time: toTimestamp(date, addStartTime, timezone),
      end_time: toTimestamp(date, addEndTime, timezone),
      price_cents: priceCents,
      status: "available",
    };

    setSchedules((prev) => {
      const next = new Map(prev);
      if (existing) {
        next.set(activeBayId, {
          ...existing,
          slots: [...existing.slots, newSlot].sort((a, b) =>
            a.start_time.localeCompare(b.start_time)
          ),
        });
      } else {
        next.set(activeBayId, {
          id: scheduleId,
          bay_id: activeBayId,
          template_id: null,
          slots: [newSlot],
        });
      }
      return next;
    });
    setAddStartTime("");
    setAddEndTime("");
  }

  function handleDeleteSlot(slotId: string) {
    if (!slotId.startsWith("temp-")) {
      setDeletedSlotIds((prev) => new Set(prev).add(slotId));
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
  }

  function handlePriceSave(slotId: string) {
    const parsed = parseFloat(editPriceValue);
    if (isNaN(parsed) || parsed < 0) {
      setEditingSlotId(null);
      return;
    }
    const newPrice = Math.round(parsed * 100);
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
    setEditingSlotId(null);
  }

  function handleToggleStatus(slotId: string, currentStatus: string) {
    const newStatus = currentStatus === "available" ? "blocked" : "available";
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

  // ─── Save Changes → persist all local edits to DB ────────────

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    const supabase = createClient();

    try {
      // 1. Delete removed slots
      if (deletedSlotIds.size > 0) {
        const { error } = await supabase
          .from("bay_schedule_slots")
          .delete()
          .in("id", Array.from(deletedSlotIds));
        if (error) throw error;
      }

      // 2. Insert new slots (temp IDs) — ensure bay_schedules exist first
      for (const [bayId, data] of schedules) {
        const tempSlots = data.slots.filter((s) => s.id.startsWith("temp-"));
        if (tempSlots.length === 0) continue;

        let scheduleId = data.id;
        if (scheduleId.startsWith("temp-")) {
          const { data: created, error } = await supabase
            .from("bay_schedules")
            .upsert(
              { bay_id: bayId, org_id: orgId, date },
              { onConflict: "bay_id,date" }
            )
            .select("id")
            .single();
          if (error || !created)
            throw error || new Error("Failed to create schedule");
          scheduleId = created.id;
        }

        const inserts = tempSlots.map((s) => ({
          bay_schedule_id: scheduleId,
          org_id: orgId,
          start_time: s.start_time,
          end_time: s.end_time,
          price_cents: s.price_cents,
          status: s.status,
        }));
        const { error } = await supabase
          .from("bay_schedule_slots")
          .insert(inserts);
        if (error) throw error;
      }

      // 3. Update modified slots (price/status changes)
      const updatePromises: PromiseLike<unknown>[] = [];
      for (const [bayId, data] of schedules) {
        const orig = savedSchedules.get(bayId);
        if (!orig) continue;
        for (const slot of data.slots) {
          if (slot.id.startsWith("temp-")) continue;
          const origSlot = orig.slots.find((s) => s.id === slot.id);
          if (!origSlot) continue;
          if (
            slot.price_cents !== origSlot.price_cents ||
            slot.status !== origSlot.status
          ) {
            updatePromises.push(
              supabase
                .from("bay_schedule_slots")
                .update({
                  price_cents: slot.price_cents,
                  status: slot.status,
                })
                .eq("id", slot.id)
            );
          }
        }
      }
      if (updatePromises.length > 0) {
        await Promise.all(updatePromises);
      }

      // 4. Clear template_id for bays whose slots were modified
      for (const [bayId, data] of schedules) {
        if (data.id.startsWith("temp-") || !data.template_id) continue;
        const orig = savedSchedules.get(bayId);
        if (!orig) continue;
        const bayDeleted = Array.from(deletedSlotIds).some((id) =>
          orig.slots.some((s) => s.id === id)
        );
        const bayAdded = data.slots.some((s) => s.id.startsWith("temp-"));
        const bayUpdated = data.slots.some((slot) => {
          if (slot.id.startsWith("temp-")) return false;
          const o = orig.slots.find((s) => s.id === slot.id);
          return (
            o &&
            (slot.price_cents !== o.price_cents || slot.status !== o.status)
          );
        });
        if (bayDeleted || bayAdded || bayUpdated) {
          await supabase
            .from("bay_schedules")
            .update({ template_id: null })
            .eq("id", data.id);
        }
      }

      // 5. Delete empty bay_schedules (all slots cleared)
      for (const [bayId, data] of schedules) {
        if (data.id.startsWith("temp-")) continue;
        const orig = savedSchedules.get(bayId);
        if (!orig || orig.slots.length === 0) continue;
        const allDeleted = orig.slots.every((s) => deletedSlotIds.has(s.id));
        const noNewSlots = !data.slots.some((s) => s.id.startsWith("temp-"));
        if (allDeleted && noNewSlots) {
          await supabase
            .from("bay_schedules")
            .delete()
            .eq("id", data.id);
        }
      }

      // 6. Re-fetch to get clean state with real IDs
      await fetchSchedules();
      setMessage({ type: "success", text: "Changes saved" });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to save changes";
      setMessage({ type: "error", text: msg });
    }

    setSaving(false);
  }

  // ─── Discard Changes → revert to saved state ─────────────────

  function handleDiscard() {
    setSchedules(cloneSchedules(savedSchedules));
    setDeletedSlotIds(new Set());
    setEditingSlotId(null);
    setMessage({ type: "success", text: "Changes discarded" });
  }

  // ─── Immediate actions (Apply Template / Clear All / Save as Template) ───

  async function handleApplyTemplate() {
    if (!applyTemplateId || applyBayIds.size === 0) return;
    if (hasChanges) {
      const confirmed = window.confirm(
        "You have unsaved changes that will be lost for affected bays. Continue?"
      );
      if (!confirmed) return;
    }
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
      // Update both working and saved state for affected bays
      const updateState = (prev: Map<string, BayScheduleData>) => {
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
      };
      setSchedules(updateState);
      setSavedSchedules((prev) => updateState(cloneSchedules(prev)));
      // Clean up any pending deletes for affected bays
      setDeletedSlotIds((prev) => {
        const next = new Set(prev);
        for (const sched of upsertedSchedules) {
          const orig = savedSchedules.get(sched.bay_id);
          if (orig) {
            for (const slot of orig.slots) next.delete(slot.id);
          }
        }
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
        const defaultPrice = Math.round(bay.hourly_rate_cents * (dur / 60));

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
    if (!baySchedule.id.startsWith("temp-")) {
      await supabase
        .from("bay_schedules")
        .update({ template_id: template.id })
        .eq("id", baySchedule.id);
    }

    // Update both working and saved state
    const updater = (prev: Map<string, BayScheduleData>) => {
      const next = new Map(prev);
      const existing = next.get(activeBayId);
      if (existing) {
        next.set(activeBayId, { ...existing, template_id: template.id });
      }
      return next;
    };
    setSchedules(updater);
    setSavedSchedules((prev) => updater(cloneSchedules(prev)));

    // Add new template to slot map so duplicate detection picks it up
    setTemplateSlotMap((prev) => {
      const next = new Map(prev);
      next.set(
        template.id,
        slotInserts
          .map((s) => ({ start_time: s.start_time, end_time: s.end_time }))
          .sort((a, b) => a.start_time.localeCompare(b.start_time))
      );
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

  function handleClearAll() {
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

    // Mark all real (non-temp) slots for deletion
    setDeletedSlotIds((prev) => {
      const next = new Set(prev);
      for (const slot of baySchedule.slots) {
        if (!slot.id.startsWith("temp-")) {
          next.add(slot.id);
        }
      }
      return next;
    });

    // Clear working state for this bay
    setSchedules((prev) => {
      const next = new Map(prev);
      next.set(activeBayId, {
        ...baySchedule,
        slots: [],
      });
      return next;
    });
  }

  // ─── Derived ─────────────────────────────────────────────────

  const baySchedule = schedules.get(activeBayId);
  const sortedSlots = baySchedule?.slots || [];

  // Check if current bay's slot times match any existing template
  const matchesExistingTemplate = useMemo(() => {
    if (sortedSlots.length === 0 || templateSlotMap.size === 0) return false;
    const currentTimes = sortedSlots
      .map((s) => ({
        start: getLocalTimeStr(s.start_time, timezone),
        end: getLocalTimeStr(s.end_time, timezone),
      }))
      .sort((a, b) => a.start.localeCompare(b.start));

    for (const [, tplSlots] of templateSlotMap) {
      if (tplSlots.length !== currentTimes.length) continue;
      const match = tplSlots.every(
        (ts, i) =>
          ts.start_time === currentTimes[i].start &&
          ts.end_time === currentTimes[i].end
      );
      if (match) return true;
    }
    return false;
  }, [sortedSlots, templateSlotMap, timezone]);

  // Show "Save as Template" only when bay has persisted slots that don't match any template
  const showSaveAsTemplate =
    sortedSlots.length > 0 &&
    !hasChanges &&
    !baySchedule?.template_id &&
    !matchesExistingTemplate;

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
                        const isNew = slot.id.startsWith("temp-");
                        const colors =
                          STATUS_COLORS[slot.status] ||
                          STATUS_COLORS.available;

                        return (
                          <tr
                            key={slot.id}
                            className={cn(
                              "transition-colors hover:bg-gray-50",
                              isNew && "bg-blue-50/40"
                            )}
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
                              {isNew && (
                                <span className="ml-2 text-xs text-blue-500">
                                  new
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {isEditing ? (
                                <div className="flex items-center gap-1">
                                  <span className="text-sm text-gray-400">
                                    $
                                  </span>
                                  <input
                                    type="text"
                                    inputMode="decimal"
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
                    disabled={!addStartTime || !addEndTime}
                    className="h-9 gap-1.5 rounded-lg"
                  >
                    <Plus className="h-3.5 w-3.5" />
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

                {baySchedule &&
                  baySchedule.slots.length > 0 && (
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

        {/* ─── Sticky footer: Save / Discard ─── */}
        {hasChanges && (
          <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 md:px-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">
                You have unsaved changes
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDiscard}
                  disabled={saving}
                  className="gap-1.5 rounded-lg border-gray-200"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  Discard Changes
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving}
                  className="gap-1.5 rounded-lg"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Save Changes
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
