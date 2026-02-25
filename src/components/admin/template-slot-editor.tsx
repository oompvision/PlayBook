"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Clock, Trash2, Plus, RotateCcw } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────

type Bay = {
  id: string;
  name: string;
  hourly_rate_cents: number;
};

type Slot = {
  id: string;
  start_time: string;
  end_time: string;
};

type Override = {
  id: string;
  template_slot_id: string;
  bay_id: string;
  price_cents: number;
};

type Props = {
  templateId: string;
  initialSlots: Slot[];
  bays: Bay[];
  initialOverrides: Override[];
};

// ─── Helpers ─────────────────────────────────────────────────────

function computeDefaultPrice(slot: Slot, bay: Bay): number {
  const [startH, startM] = slot.start_time.split(":").map(Number);
  const [endH, endM] = slot.end_time.split(":").map(Number);
  const durationMinutes = endH * 60 + endM - (startH * 60 + startM);
  return Math.round(bay.hourly_rate_cents * (durationMinutes / 60));
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDuration(startTime: string, endTime: string): string {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const dur = eh * 60 + em - (sh * 60 + sm);
  const hours = Math.floor(dur / 60);
  const mins = dur % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

// ─── Component ───────────────────────────────────────────────────

export function TemplateSlotEditor({
  templateId,
  initialSlots,
  bays,
  initialOverrides,
}: Props) {
  // Sync state from server props (detect re-renders from server actions)
  const [slots, setSlots] = useState(initialSlots);
  const prevSlotsRef = useRef(initialSlots);
  if (prevSlotsRef.current !== initialSlots) {
    prevSlotsRef.current = initialSlots;
    setSlots(initialSlots);
  }

  const [overrides, setOverrides] = useState(initialOverrides);
  const prevOverridesRef = useRef(initialOverrides);
  if (prevOverridesRef.current !== initialOverrides) {
    prevOverridesRef.current = initialOverrides;
    setOverrides(initialOverrides);
  }

  const [activeBayId, setActiveBayId] = useState(bays[0]?.id || "");
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  // Add slot form
  const [addStartTime, setAddStartTime] = useState("");
  const [addEndTime, setAddEndTime] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  const activeBay = bays.find((b) => b.id === activeBayId);
  const sortedSlots = [...slots].sort((a, b) =>
    a.start_time.localeCompare(b.start_time)
  );

  // ─── Price helpers ─────────────────────────────────────────────

  function getSlotPrice(slotId: string): {
    price: number;
    isOverride: boolean;
  } {
    const override = overrides.find(
      (o) => o.template_slot_id === slotId && o.bay_id === activeBayId
    );
    if (override) {
      return { price: override.price_cents, isOverride: true };
    }
    const slot = slots.find((s) => s.id === slotId);
    if (slot && activeBay) {
      return { price: computeDefaultPrice(slot, activeBay), isOverride: false };
    }
    return { price: 0, isOverride: false };
  }

  // ─── Actions ───────────────────────────────────────────────────

  async function handlePriceSave(slotId: string) {
    const parsed = parseFloat(editValue);
    if (isNaN(parsed) || parsed < 0) {
      setEditingSlotId(null);
      return;
    }
    const newPrice = Math.round(parsed * 100);

    setSaving(true);
    const supabase = createClient();

    const existing = overrides.find(
      (o) => o.template_slot_id === slotId && o.bay_id === activeBayId
    );

    if (existing) {
      const { error } = await supabase
        .from("template_bay_overrides")
        .update({ price_cents: newPrice })
        .eq("id", existing.id);

      if (!error) {
        setOverrides((prev) =>
          prev.map((o) =>
            o.id === existing.id ? { ...o, price_cents: newPrice } : o
          )
        );
      }
    } else {
      const { data, error } = await supabase
        .from("template_bay_overrides")
        .insert({
          template_id: templateId,
          bay_id: activeBayId,
          template_slot_id: slotId,
          price_cents: newPrice,
        })
        .select()
        .single();

      if (!error && data) {
        setOverrides((prev) => [...prev, data]);
      }
    }

    setEditingSlotId(null);
    setSaving(false);
  }

  async function handlePriceReset(slotId: string) {
    const existing = overrides.find(
      (o) => o.template_slot_id === slotId && o.bay_id === activeBayId
    );
    if (!existing) return;

    const supabase = createClient();
    const { error } = await supabase
      .from("template_bay_overrides")
      .delete()
      .eq("id", existing.id);

    if (!error) {
      setOverrides((prev) => prev.filter((o) => o.id !== existing.id));
    }
  }

  async function handleAddSlot() {
    if (!addStartTime || !addEndTime) return;
    setAddLoading(true);

    const supabase = createClient();
    const { data, error } = await supabase
      .from("template_slots")
      .insert({
        template_id: templateId,
        start_time: addStartTime,
        end_time: addEndTime,
      })
      .select()
      .single();

    if (!error && data) {
      setSlots((prev) => [...prev, data]);
      setAddStartTime("");
      setAddEndTime("");
    }

    setAddLoading(false);
  }

  async function handleRemoveSlot(slotId: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("template_slots")
      .delete()
      .eq("id", slotId);

    if (!error) {
      setSlots((prev) => prev.filter((s) => s.id !== slotId));
      setOverrides((prev) =>
        prev.filter((o) => o.template_slot_id !== slotId)
      );
    }
  }

  // ─── Render ────────────────────────────────────────────────────

  if (bays.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white px-6 py-12 text-center dark:border-gray-700 dark:bg-white/[0.03]">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No active bays found. Create bays first to manage template pricing.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
        <div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            <h2 className="font-semibold text-gray-800 dark:text-white/90">
              Time Slots & Pricing
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
            Prices default to each bay&apos;s hourly rate, pro-rated by slot
            duration. Click a price to override.
          </p>
        </div>
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          {slots.length} slots
        </span>
      </div>

      {/* Bay Tabs */}
      <div className="border-b border-gray-200 px-6 dark:border-white/[0.05]">
        <div className="-mb-px flex gap-1 overflow-x-auto">
          {bays.map((bay) => (
            <button
              key={bay.id}
              onClick={() => {
                setActiveBayId(bay.id);
                setEditingSlotId(null);
              }}
              className={cn(
                "shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition-colors",
                bay.id === activeBayId
                  ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              )}
            >
              {bay.name}
              <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">
                {formatPrice(bay.hourly_rate_cents)}/hr
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Slot List */}
      {slots.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <Clock className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            No slots yet. Use Quick Generate or add manually below.
          </p>
        </div>
      ) : (
        <div>
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_7rem_5rem] items-center gap-2 border-b border-gray-100 px-6 py-2 dark:border-white/[0.05]">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
              Time
            </span>
            <span className="text-right text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
              Price
            </span>
            <span />
          </div>

          <div className="divide-y divide-gray-100 dark:divide-white/[0.05]">
            {sortedSlots.map((slot) => {
              const { price, isOverride } = getSlotPrice(slot.id);
              const isEditing = editingSlotId === slot.id;

              return (
                <div
                  key={slot.id}
                  className="grid grid-cols-[1fr_7rem_5rem] items-center gap-2 px-6 py-3 transition-colors hover:bg-gray-50/50 dark:hover:bg-white/[0.02]"
                >
                  {/* Time */}
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-900/20">
                      <Clock className="h-4 w-4 text-blue-500" />
                    </div>
                    <span className="font-mono text-sm text-gray-800 dark:text-white/90">
                      {slot.start_time.slice(0, 5)} –{" "}
                      {slot.end_time.slice(0, 5)}
                    </span>
                    <span className="text-xs text-gray-400">
                      {formatDuration(slot.start_time, slot.end_time)}
                    </span>
                  </div>

                  {/* Price */}
                  <div className="text-right">
                    {isEditing ? (
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-sm text-gray-400">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => handlePriceSave(slot.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handlePriceSave(slot.id);
                            if (e.key === "Escape") setEditingSlotId(null);
                          }}
                          autoFocus
                          disabled={saving}
                          className="h-8 w-20 rounded-md border border-blue-400 bg-white px-2 text-right text-sm text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-blue-600 dark:bg-gray-900 dark:text-white/90"
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingSlotId(slot.id);
                          setEditValue((price / 100).toFixed(2));
                        }}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-gray-800",
                          isOverride
                            ? "text-blue-600 dark:text-blue-400"
                            : "text-gray-700 dark:text-gray-300"
                        )}
                        title={
                          isOverride
                            ? "Custom price (click to edit)"
                            : "Default from bay rate (click to override)"
                        }
                      >
                        {formatPrice(price)}
                        {isOverride && (
                          <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
                        )}
                      </button>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-0.5">
                    {isOverride && !isEditing && (
                      <button
                        onClick={() => handlePriceReset(slot.id)}
                        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
                        title="Reset to bay rate"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => handleRemoveSlot(slot.id)}
                      className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-950/30"
                      title="Remove slot"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add slot form */}
      <div className="border-t border-gray-200 bg-gray-50/50 p-6 dark:border-white/[0.05] dark:bg-white/[0.02]">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Start
            </label>
            <input
              type="time"
              value={addStartTime}
              onChange={(e) => setAddStartTime(e.target.value)}
              className="h-10 w-32 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
              End
            </label>
            <input
              type="time"
              value={addEndTime}
              onChange={(e) => setAddEndTime(e.target.value)}
              className="h-10 w-32 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            />
          </div>
          <button
            onClick={handleAddSlot}
            disabled={addLoading || !addStartTime || !addEndTime}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <Plus className="h-4 w-4" />
            Add Slot
          </button>
        </div>
      </div>
    </div>
  );
}
