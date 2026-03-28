"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EventCalendar } from "@/components/admin/event-calendar";
import { EventDayModal } from "@/components/admin/event-day-modal";

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

type EventCalendarWrapperProps = {
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
    status: "draft" | "published",
    startTime: string,
    endTime: string
  ) => Promise<ApplyResult>;
  onApplyDaySchedule: (
    dayScheduleId: string,
    dates: string[],
    status: "draft" | "published"
  ) => Promise<ApplyResult>;
  onUpdateEvent: (
    eventId: string,
    updates: { date?: string; start_time?: string; end_time?: string; capacity?: number; price_cents?: number }
  ) => Promise<{ success: boolean; error?: string }>;
  onDeleteEvent: (eventId: string) => Promise<{ success: boolean; error?: string }>;
  onAddEventFromTemplate: (
    templateId: string,
    date: string,
    startTime: string,
    endTime: string
  ) => Promise<{ success: boolean; error?: string }>;
  onSaveDaySchedule: (
    date: string,
    name: string
  ) => Promise<{ success: boolean; error?: string }>;
  onPublishEvent: (
    eventId: string
  ) => Promise<{ success: boolean; error?: string }>;
  onUnpublishEvent: (
    eventId: string
  ) => Promise<{ success: boolean; cancelledRegistrations?: number; error?: string }>;
  onDeleteEventsForDates: (
    dates: string[],
    confirm: boolean
  ) => Promise<{ success: boolean; eventCount: number; registrationCount: number; deletedCount?: number; error?: string }>;
};

export function EventCalendarWrapper({
  today,
  timezone,
  orgId,
  eventMap,
  eventTemplates,
  daySchedules,
  bays,
  onApplyEventTemplate,
  onApplyDaySchedule,
  onUpdateEvent,
  onDeleteEvent,
  onAddEventFromTemplate,
  onSaveDaySchedule,
  onPublishEvent,
  onUnpublishEvent,
  onDeleteEventsForDates,
}: EventCalendarWrapperProps) {
  const [viewingDate, setViewingDate] = useState<string | null>(null);
  const router = useRouter();

  return (
    <>
      <EventCalendar
        today={today}
        timezone={timezone}
        orgId={orgId}
        eventMap={eventMap}
        eventTemplates={eventTemplates}
        daySchedules={daySchedules}
        bays={bays}
        onApplyEventTemplate={onApplyEventTemplate}
        onApplyDaySchedule={onApplyDaySchedule}
        onOpenDay={setViewingDate}
        onDeleteEventsForDates={onDeleteEventsForDates}
      />

      {viewingDate && (
        <EventDayModal
          date={viewingDate}
          orgId={orgId}
          timezone={timezone}
          eventTemplates={eventTemplates.map((t) => ({
            id: t.id,
            name: t.name,
            color: t.color,
          }))}
          onClose={() => {
            setViewingDate(null);
            router.refresh();
          }}
          onUpdateEvent={onUpdateEvent}
          onDeleteEvent={onDeleteEvent}
          onAddEventFromTemplate={onAddEventFromTemplate}
          onSaveDaySchedule={onSaveDaySchedule}
          onPublishEvent={onPublishEvent}
          onUnpublishEvent={onUnpublishEvent}
        />
      )}
    </>
  );
}
