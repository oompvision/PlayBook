"use client";

import { useState } from "react";
import {
  CalendarDays,
  Clock,
  MapPin,
  Users,
} from "lucide-react";
import { EventRegistrationPanel, type EventForPanel } from "./event-registration-panel";

type EventCardEvent = {
  id: string;
  name: string;
  description: string | null;
  startTime: string;
  endTime: string;
  capacity: number;
  registeredCount: number;
  priceCents: number;
  membersOnly: boolean;
  memberEnrollmentDaysBefore: number | null;
  guestEnrollmentDaysBefore: number;
  bayNames: string;
};

type EventCardProps = {
  event: EventCardEvent;
  timezone: string;
  isAuthenticated: boolean;
  isMember: boolean;
  userRegistrationStatus: string | null;
  paymentMode: string;
};

export function EventCard({
  event,
  timezone,
  isAuthenticated,
  isMember,
  userRegistrationStatus,
  paymentMode,
}: EventCardProps) {
  const [status, setStatus] = useState(userRegistrationStatus);
  const [regCount, setRegCount] = useState(event.registeredCount);
  const [showPanel, setShowPanel] = useState(false);

  const spotsLeft = event.capacity - regCount;
  const isFull = spotsLeft <= 0;

  // Check enrollment window
  const now = new Date();
  const eventDate = new Date(event.startTime);
  const daysUntilEvent = Math.ceil(
    (eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  const enrollmentDays = isMember
    ? (event.memberEnrollmentDaysBefore ?? event.guestEnrollmentDaysBefore)
    : event.guestEnrollmentDaysBefore;
  const enrollmentOpen = daysUntilEvent <= enrollmentDays;

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));

  const formatTime = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));

  function handleRegisterClick() {
    setShowPanel(true);
  }

  function handleRegistered(newStatus: string) {
    setStatus(newStatus);
    if (newStatus === "confirmed" || newStatus === "pending_payment") {
      setRegCount((c) => c + 1);
    }
  }

  const panelEvent: EventForPanel = {
    id: event.id,
    name: event.name,
    description: event.description,
    startTime: event.startTime,
    endTime: event.endTime,
    capacity: event.capacity,
    registeredCount: regCount,
    priceCents: event.priceCents,
    membersOnly: event.membersOnly,
    bayNames: event.bayNames,
  };

  const getButtonContent = () => {
    if (status === "confirmed") {
      return (
        <span className="inline-flex items-center gap-1.5 text-green-700 dark:text-green-400">
          <Users className="h-4 w-4" />
          Registered
        </span>
      );
    }
    if (status === "waitlisted") {
      return (
        <span className="inline-flex items-center gap-1.5 text-blue-700 dark:text-blue-400">
          <Users className="h-4 w-4" />
          On Waitlist
        </span>
      );
    }
    if (status === "pending_payment") {
      return (
        <span className="inline-flex items-center gap-1.5 text-yellow-700 dark:text-yellow-400">
          <Clock className="h-4 w-4" />
          Payment Pending
        </span>
      );
    }
    if (!enrollmentOpen) {
      const openDate = new Date(eventDate);
      openDate.setDate(openDate.getDate() - enrollmentDays);
      return (
        <span className="text-xs text-gray-500">
          Opens {formatDate(openDate.toISOString())}
        </span>
      );
    }
    if (isFull) {
      return "Join Waitlist";
    }
    return "Register";
  };

  const canRegister =
    !status && enrollmentOpen && isAuthenticated;
  const canJoinWaitlist = !status && enrollmentOpen && isFull && isAuthenticated;

  return (
    <>
      <div className="flex flex-col surface-1 rounded-xl bg-card p-5 hover-lift press-feedback dark:bg-white/[0.03]">
        {/* Event badge */}
        <div className="mb-3 flex items-center justify-between">
          <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
            Event
          </span>
          {event.membersOnly && (
            <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
              Members Only
            </span>
          )}
        </div>

        {/* Event name */}
        <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
          {event.name}
        </h3>

        {/* Details */}
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <CalendarDays className="h-4 w-4 shrink-0" />
            <span>{formatDate(event.startTime)}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Clock className="h-4 w-4 shrink-0" />
            <span>
              {formatTime(event.startTime)} – {formatTime(event.endTime)}
            </span>
          </div>
          {event.bayNames && (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <MapPin className="h-4 w-4 shrink-0" />
              <span>{event.bayNames}</span>
            </div>
          )}
        </div>

        {/* Spots & Price */}
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Users className="h-4 w-4 text-gray-400" />
            {isFull ? (
              <span className="text-sm font-medium text-red-600 dark:text-red-400">
                Full
              </span>
            ) : (
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {spotsLeft} spot{spotsLeft !== 1 ? "s" : ""} left
              </span>
            )}
          </div>
          <span className="text-sm font-semibold text-gray-800 dark:text-white/90">
            {event.priceCents === 0
              ? "Free"
              : `$${(event.priceCents / 100).toFixed(2)}`}
          </span>
        </div>

        {/* Register button */}
        <div className="mt-4">
          {status ? (
            <div className="flex h-10 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
              {getButtonContent()}
            </div>
          ) : enrollmentOpen ? (
            <button
              onClick={handleRegisterClick}
              disabled={!canRegister && !canJoinWaitlist && isAuthenticated}
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {getButtonContent()}
            </button>
          ) : (
            <div className="flex h-10 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800">
              {getButtonContent()}
            </div>
          )}
        </div>
      </div>

      {/* Registration panel */}
      {showPanel && (
        <EventRegistrationPanel
          event={panelEvent}
          timezone={timezone}
          isAuthenticated={isAuthenticated}
          isMember={isMember}
          paymentMode={paymentMode}
          onClose={() => setShowPanel(false)}
          onRegistered={handleRegistered}
        />
      )}
    </>
  );
}
