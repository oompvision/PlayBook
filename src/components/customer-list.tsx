"use client";

import { useState } from "react";
import {
  CustomerProfileModal,
  type CustomerEntry,
} from "@/components/customer-profile-modal";

const avatarColors = [
  "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
  "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
  "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
  "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400",
  "bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400",
];

function getAvatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

function getInitials(name: string | null, email: string | null): string {
  if (name) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  if (email) return email[0].toUpperCase();
  return "?";
}

type Props = {
  entries: CustomerEntry[];
  orgId: string;
  locationsEnabled?: boolean;
  locationNameMap?: Record<string, string>;
};

export function CustomerList({ entries, orgId, locationsEnabled, locationNameMap }: Props) {
  const [selectedCustomer, setSelectedCustomer] =
    useState<CustomerEntry | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  function handleCustomerClick(entry: CustomerEntry) {
    setSelectedCustomer(entry);
    setModalOpen(true);
  }

  return (
    <>
      {/* Desktop Table */}
      <div className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/[0.05]">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  Customer
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  Phone
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  Bookings
                </th>
                {locationsEnabled && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                    Default Location
                  </th>
                )}
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  Since
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="cursor-pointer transition-colors hover:bg-gray-50/50 dark:hover:bg-white/[0.02]"
                  onClick={() => handleCustomerClick(entry)}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${getAvatarColor(entry.id)}`}
                      >
                        {getInitials(entry.name, entry.email)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                            {entry.name || "No name"}
                          </p>
                          {entry.isGuest && (
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                              Guest
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                          {entry.email || (
                            <span className="text-gray-400 dark:text-gray-500">
                              No email
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-gray-800 dark:text-white/90">
                      {entry.phone || (
                        <span className="text-gray-400 dark:text-gray-500">
                          —
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {entry.bookingCount > 0 ? (
                      <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                        {entry.bookingCount} booking
                        {entry.bookingCount !== 1 ? "s" : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        No bookings
                      </span>
                    )}
                  </td>
                  {locationsEnabled && (
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {(!entry.isGuest && locationNameMap?.[entry.id]) || (
                          <span className="text-gray-400 dark:text-gray-500">—</span>
                        )}
                      </span>
                    </td>
                  )}
                  <td className="px-6 py-4">
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {new Date(entry.date + "T12:00:00").toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Card View */}
      <div className="divide-y divide-gray-100 md:hidden dark:divide-white/[0.05]">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="cursor-pointer px-5 py-4 transition-colors active:bg-gray-50 dark:active:bg-white/[0.02]"
            onClick={() => handleCustomerClick(entry)}
          >
            <div className="flex items-center gap-3">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${getAvatarColor(entry.id)}`}
              >
                {getInitials(entry.name, entry.email)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-gray-800 dark:text-white/90">
                    {entry.name || "No name"}
                  </p>
                  {entry.isGuest && (
                    <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      Guest
                    </span>
                  )}
                  {entry.bookingCount > 0 && (
                    <span className="inline-flex shrink-0 items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                      {entry.bookingCount}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                  {entry.email || "No email"}
                  {entry.phone ? ` · ${entry.phone}` : ""}
                  {locationsEnabled && !entry.isGuest && locationNameMap?.[entry.id]
                    ? ` · ${locationNameMap[entry.id]}`
                    : ""}
                </p>
              </div>
              <div className="shrink-0 text-right text-xs text-gray-400 dark:text-gray-500">
                {new Date(entry.date + "T12:00:00").toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Profile Modal */}
      <CustomerProfileModal
        customer={selectedCustomer}
        orgId={orgId}
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </>
  );
}
