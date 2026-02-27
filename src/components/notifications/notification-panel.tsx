"use client";

import React from "react";
import Link from "next/link";
import {
  Bell,
  Calendar,
  CheckCircle2,
  XCircle,
  Clock,
  UserPlus,
  Pencil,
  Gift,
  BarChart3,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  new_customer_signup: UserPlus,
  guest_booking_created: Calendar,
  admin_daily_digest: BarChart3,
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function NotificationPanel({
  notifications,
  onMarkAsRead,
  onMarkAllAsRead,
  viewAllHref,
  onClose,
}: {
  notifications: NotificationRow[];
  onMarkAsRead: (id: string, link: string | null) => void;
  onMarkAllAsRead: () => void;
  viewAllHref: string;
  onClose: () => void;
}) {
  const hasUnread = notifications.some((n) => !n.is_read);

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-800">Notifications</h3>
        {hasUnread && (
          <button
            onClick={onMarkAllAsRead}
            className="text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            Mark all as read
          </button>
        )}
      </div>

      {/* List */}
      <ScrollArea className="max-h-80">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Bell className="mb-2 h-8 w-8 text-gray-300" />
            <p className="text-sm text-gray-500">No notifications yet</p>
          </div>
        ) : (
          <div className="divide-y">
            {notifications.map((n) => {
              const Icon = TYPE_ICONS[n.type] || Bell;
              return (
                <button
                  key={n.id}
                  onClick={() => onMarkAsRead(n.id, n.link)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
                >
                  {/* Unread dot */}
                  <div className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center">
                    {!n.is_read ? (
                      <span className="h-2 w-2 rounded-full bg-blue-500" />
                    ) : (
                      <Icon className="h-4 w-4 text-gray-400" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-sm ${
                        n.is_read
                          ? "text-gray-600"
                          : "font-medium text-gray-900"
                      }`}
                    >
                      {n.title}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">
                      {n.message}
                    </p>
                    <p className="mt-1 text-[11px] text-gray-400">
                      {timeAgo(n.created_at)}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="border-t px-4 py-2">
        <Link
          href={viewAllHref}
          onClick={onClose}
          className="block text-center text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          View all notifications
        </Link>
      </div>
    </div>
  );
}
