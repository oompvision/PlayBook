"use client";

import { useState } from "react";

type Bay = {
  id: string;
  name: string;
  resource_type: string | null;
  is_active: boolean;
};

type EventData = {
  id?: string;
  name: string;
  description: string | null;
  start_time: string;
  end_time: string;
  capacity: number;
  price_cents: number;
  members_only: boolean;
  member_enrollment_days_before: number | null;
  guest_enrollment_days_before: number;
  waitlist_promotion_hours: number;
  status: string;
  event_bays?: { bay_id: string }[];
};

const inputClass =
  "h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";
const labelClass = "text-xs font-medium text-gray-500 dark:text-gray-400";

function toLocalDatetime(isoString: string, timezone: string): { date: string; time: string } {
  const d = new Date(isoString);
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const timeStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return { date: dateStr, time: timeStr };
}

export function EventForm({
  bays,
  timezone,
  event,
  action,
  locationId,
  submitLabel = "Create Event",
  membershipEnabled = false,
}: {
  bays: Bay[];
  timezone: string;
  event?: EventData;
  action: (formData: FormData) => Promise<void>;
  locationId: string | null;
  submitLabel?: string;
  membershipEnabled?: boolean;
}) {
  const existingBayIds = event?.event_bays?.map((eb) => eb.bay_id) ?? [];
  const [selectedBayIds, setSelectedBayIds] = useState<string[]>(existingBayIds);
  const [membersOnly, setMembersOnly] = useState(event?.members_only ?? false);

  // Parse existing event times for default values
  const defaultStart = event?.start_time
    ? toLocalDatetime(event.start_time, timezone)
    : { date: "", time: "" };
  const defaultEnd = event?.end_time
    ? toLocalDatetime(event.end_time, timezone)
    : { date: "", time: "" };

  const toggleBay = (bayId: string) => {
    setSelectedBayIds((prev) =>
      prev.includes(bayId) ? prev.filter((id) => id !== bayId) : [...prev, bayId]
    );
  };

  const activeBays = bays.filter((b) => b.is_active);

  return (
    <form action={action} className="space-y-6">
      {event?.id && <input type="hidden" name="id" value={event.id} />}
      {locationId && <input type="hidden" name="location" value={locationId} />}

      {/* Hidden field for selected bays */}
      <input type="hidden" name="bay_ids" value={JSON.stringify(selectedBayIds)} />
      <input type="hidden" name="members_only" value={membersOnly ? "true" : "false"} />
      <input type="hidden" name="timezone" value={timezone} />

      {/* Event Details */}
      <div>
        <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
          Event Details
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <label className={labelClass}>Event Name *</label>
            <input
              name="name"
              required
              placeholder="e.g. Saturday Open Court, Beginner Clinic"
              defaultValue={event?.name || ""}
              className={inputClass + " placeholder:text-gray-400 dark:placeholder:text-white/30"}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className={labelClass}>Description</label>
            <textarea
              name="description"
              rows={3}
              placeholder="Optional details visible to users"
              defaultValue={event?.description || ""}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
            />
          </div>
        </div>
      </div>

      {/* Date & Time */}
      <div>
        <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
          Date &amp; Time
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label className={labelClass}>Date *</label>
            <input
              name="date"
              type="date"
              required
              defaultValue={defaultStart.date}
              className={inputClass}
            />
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Start Time *</label>
            <input
              name="start_time"
              type="time"
              required
              defaultValue={defaultStart.time}
              className={inputClass}
            />
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>End Time *</label>
            <input
              name="end_time"
              type="time"
              required
              defaultValue={defaultEnd.time}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Capacity & Pricing */}
      <div>
        <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
          Capacity &amp; Pricing
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label className={labelClass}>Spots Available *</label>
            <input
              name="capacity"
              type="number"
              min="1"
              required
              defaultValue={event?.capacity || ""}
              placeholder="e.g. 12"
              className={inputClass + " placeholder:text-gray-400 dark:placeholder:text-white/30"}
            />
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Price ($)</label>
            <input
              name="price"
              type="number"
              step="0.01"
              min="0"
              defaultValue={event ? (event.price_cents / 100).toFixed(2) : "0.00"}
              className={inputClass}
            />
            <p className="text-xs text-gray-400">$0.00 = free event</p>
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Waitlist Promotion Window</label>
            <div className="flex items-center gap-2">
              <input
                name="waitlist_promotion_hours"
                type="number"
                min="1"
                max="168"
                defaultValue={event?.waitlist_promotion_hours ?? 24}
                className={inputClass}
              />
              <span className="shrink-0 text-xs text-gray-500">hours</span>
            </div>
          </div>
        </div>
      </div>

      {/* Facilities */}
      <div>
        <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
          Facilities *
        </h3>
        {activeBays.length === 0 ? (
          <p className="text-sm text-gray-400">
            No active facilities. Add facilities first.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {activeBays.map((bay) => (
              <label
                key={bay.id}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                  selectedBayIds.includes(bay.id)
                    ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/20"
                    : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedBayIds.includes(bay.id)}
                  onChange={() => toggleBay(bay.id)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                    {bay.name}
                  </p>
                  {bay.resource_type && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {bay.resource_type}
                    </p>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Access & Enrollment */}
      <div>
        <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
          Access &amp; Enrollment
        </h3>
        <div className="space-y-4">
          {/* Members Only Toggle */}
          <label className="flex cursor-pointer items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={membersOnly}
              onClick={() => setMembersOnly(!membersOnly)}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                membersOnly ? "bg-blue-600" : "bg-gray-200 dark:bg-gray-700"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                  membersOnly ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Members Only
              </p>
              <p className="text-xs text-gray-400">
                Only members can see and register for this event
              </p>
            </div>
          </label>

          {/* Enrollment Windows */}
          <div className="grid gap-4 sm:grid-cols-2">
            {membershipEnabled && (
              <div className="space-y-1.5">
                <label className={labelClass}>
                  Member Enrollment (days before event)
                </label>
                <input
                  name="member_enrollment_days_before"
                  type="number"
                  min="0"
                  defaultValue={event?.member_enrollment_days_before ?? 14}
                  className={inputClass}
                />
              </div>
            )}
            {!membersOnly && (
              <div className="space-y-1.5">
                <label className={labelClass}>
                  {membershipEnabled ? "Guest" : ""} Enrollment (days before event)
                </label>
                <input
                  name="guest_enrollment_days_before"
                  type="number"
                  min="0"
                  defaultValue={event?.guest_enrollment_days_before ?? 7}
                  className={inputClass}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Submit */}
      <div className="flex gap-2 border-t border-gray-200 pt-6 dark:border-gray-700">
        <button
          type="submit"
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          {submitLabel}
        </button>
        <a href={`/admin/events${locationId ? `?location=${locationId}` : ""}`}>
          <button
            type="button"
            className="inline-flex h-10 items-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
        </a>
      </div>
    </form>
  );
}
