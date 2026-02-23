"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Slot = {
  id: string;
  start_time: string;
  end_time: string;
  price_cents: number;
  status: string;
};

type Bay = {
  id: string;
  name: string;
  resource_type: string | null;
};

function formatTime(timestamp: string, timezone: string) {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function SlotPicker({
  date,
  bays,
  slotsByBay,
  isAuthenticated,
  timezone,
}: {
  date: string;
  bays: Bay[];
  slotsByBay: Record<string, Slot[]>;
  isAuthenticated: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<
    Map<string, { slotIds: string[]; bayId: string; bayName: string }>
  >(new Map());

  function toggleSlot(bayId: string, bayName: string, slot: Slot) {
    if (slot.status !== "available" || !isAuthenticated) return;

    setSelected((prev) => {
      const next = new Map(prev);
      const key = `${bayId}`;
      const entry = next.get(key) || {
        slotIds: [],
        bayId,
        bayName,
      };

      if (entry.slotIds.includes(slot.id)) {
        entry.slotIds = entry.slotIds.filter((id) => id !== slot.id);
        if (entry.slotIds.length === 0) {
          next.delete(key);
        } else {
          next.set(key, { ...entry });
        }
      } else {
        entry.slotIds = [...entry.slotIds, slot.id];
        next.set(key, { ...entry });
      }

      return next;
    });
  }

  // Calculate totals
  let totalSlots = 0;
  let totalCents = 0;
  const allSlotIds: string[] = [];

  for (const [, entry] of selected) {
    totalSlots += entry.slotIds.length;
    allSlotIds.push(...entry.slotIds);
    // Sum prices
    const baySlots = slotsByBay[entry.bayId] || [];
    for (const sid of entry.slotIds) {
      const s = baySlots.find((sl) => sl.id === sid);
      if (s) totalCents += s.price_cents;
    }
  }

  function handleContinue() {
    // Encode selected slots into URL params for the confirm page
    const params = new URLSearchParams();
    params.set("date", date);

    for (const [, entry] of selected) {
      // Format: bay_id=slot1,slot2,slot3
      params.append("bay", entry.bayId);
      params.append(`slots_${entry.bayId}`, entry.slotIds.join(","));
    }

    router.push(`/book/confirm?${params.toString()}`);
  }

  return (
    <div className="mt-8 space-y-6">
      {bays.map((bay) => {
        const slots = slotsByBay[bay.id] || [];
        if (slots.length === 0) return null;

        const baySelection = selected.get(bay.id);

        return (
          <div key={bay.id} className="rounded-lg border p-4">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-lg font-semibold">{bay.name}</h2>
              {bay.resource_type && (
                <Badge variant="outline">{bay.resource_type}</Badge>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {slots.map((slot) => {
                const timeStr = `${formatTime(slot.start_time, timezone)} – ${formatTime(slot.end_time, timezone)}`;
                const price = `$${(slot.price_cents / 100).toFixed(2)}`;
                const isSelected = baySelection?.slotIds.includes(slot.id);
                const isAvailable = slot.status === "available";

                return (
                  <button
                    key={slot.id}
                    type="button"
                    disabled={!isAvailable || !isAuthenticated}
                    onClick={() => toggleSlot(bay.id, bay.name, slot)}
                    className={`rounded-md border p-3 text-left text-sm transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/10 ring-1 ring-primary"
                        : isAvailable
                          ? "hover:bg-accent"
                          : "cursor-not-allowed opacity-40"
                    }`}
                  >
                    <p className="font-medium">{timeStr}</p>
                    <p className="text-xs text-muted-foreground">
                      {isAvailable ? price : "Unavailable"}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {bays.every((bay) => (slotsByBay[bay.id] || []).length === 0) && (
        <p className="py-12 text-center text-muted-foreground">
          No time slots available for this date.
        </p>
      )}

      {/* Spacer so content isn't hidden behind the fixed bar */}
      {totalSlots > 0 && <div className="h-24" />}

      {/* Fixed booking bar overlay */}
      {totalSlots > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.1)]">
          <div className="mx-auto flex max-w-3xl items-center justify-between">
            <div>
              <p className="font-medium">
                {totalSlots} slot{totalSlots !== 1 ? "s" : ""} selected
              </p>
              <p className="text-sm text-muted-foreground">
                Total: ${(totalCents / 100).toFixed(2)}
              </p>
            </div>
            <Button onClick={handleContinue}>Continue to Book</Button>
          </div>
        </div>
      )}
    </div>
  );
}
