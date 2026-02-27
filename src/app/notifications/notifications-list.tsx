"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Calendar,
  CheckCircle2,
  XCircle,
  Clock,
  Pencil,
  Gift,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  welcome: Gift,
  booking_confirmed: CheckCircle2,
  booking_canceled: XCircle,
  booking_modified: Pencil,
  booking_reminder_48hr: Clock,
  cancellation_window_closed: Clock,
  guest_booking_created: Calendar,
};

const TYPE_COLORS: Record<string, string> = {
  welcome: "bg-purple-100 text-purple-600",
  booking_confirmed: "bg-green-100 text-green-600",
  booking_canceled: "bg-red-100 text-red-600",
  booking_modified: "bg-blue-100 text-blue-600",
  booking_reminder_48hr: "bg-amber-100 text-amber-600",
  cancellation_window_closed: "bg-orange-100 text-orange-600",
  guest_booking_created: "bg-indigo-100 text-indigo-600",
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

export function CustomerNotificationsList({
  notifications,
}: {
  notifications: NotificationRow[];
}) {
  const router = useRouter();

  async function handleClick(n: NotificationRow) {
    if (!n.is_read) {
      const supabase = createClient();
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", n.id);
    }
    if (n.link) {
      router.push(n.link);
    } else {
      router.refresh();
    }
  }

  async function handleMarkAllAsRead() {
    const supabase = createClient();
    const ids = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (ids.length === 0) return;
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .in("id", ids);
    router.refresh();
  }

  const hasUnread = notifications.some((n) => !n.is_read);

  return (
    <div className="space-y-3">
      {hasUnread && (
        <div className="flex justify-end">
          <button
            onClick={handleMarkAllAsRead}
            className="text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            Mark all as read
          </button>
        </div>
      )}

      {notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 py-16">
          <Bell className="mb-3 h-10 w-10 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">
            No notifications yet
          </p>
          <p className="mt-1 text-xs text-gray-400">
            You&apos;ll see booking updates and reminders here.
          </p>
        </div>
      ) : (
        <div className="divide-y rounded-lg border border-gray-200 bg-white">
          {notifications.map((n) => {
            const Icon = TYPE_ICONS[n.type] || Bell;
            const colorClass =
              TYPE_COLORS[n.type] || "bg-gray-100 text-gray-600";
            return (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
                  !n.is_read ? "bg-blue-50/50" : ""
                }`}
              >
                <div
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${colorClass}`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className={`text-sm ${
                        n.is_read
                          ? "text-gray-600"
                          : "font-semibold text-gray-900"
                      }`}
                    >
                      {n.title}
                    </p>
                    <span className="shrink-0 text-xs text-gray-400">
                      {formatDate(n.created_at)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-gray-500">{n.message}</p>
                </div>
                {!n.is_read && (
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
