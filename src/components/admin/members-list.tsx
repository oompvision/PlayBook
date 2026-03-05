"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Crown, UserMinus, UserPlus, Loader2, MapPin, Mail, Phone, Calendar, CreditCard, AlertTriangle } from "lucide-react";
import type { MemberEntry } from "@/app/admin/members/page";

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

function formatBillingInterval(interval: MemberEntry["billingInterval"]): string {
  switch (interval) {
    case "monthly": return "Monthly";
    case "yearly": return "Yearly";
    case "admin_granted": return "Granted";
    default: return "—";
  }
}

function getStatusBadge(status: MemberEntry["status"]) {
  switch (status) {
    case "active":
      return (
        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
          Active
        </span>
      );
    case "admin_granted":
      return (
        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          Granted
        </span>
      );
    case "cancelled":
      return (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          Cancelled
        </span>
      );
    case "guest":
      return (
        <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
          Guest
        </span>
      );
    default:
      return null;
  }
}

type Props = {
  entries: MemberEntry[];
  orgId: string;
  locationsEnabled: boolean;
  tierName: string | null;
};

export function MembersList({ entries, orgId, locationsEnabled, tierName }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<MemberEntry | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);

  function openModal(entry: MemberEntry) {
    setSelected(entry);
    setModalOpen(true);
    setActionError(null);
    setShowRevokeConfirm(false);
  }

  function closeModal() {
    setModalOpen(false);
    setSelected(null);
    setActionError(null);
    setShowRevokeConfirm(false);
  }

  async function handleGrant() {
    if (!selected) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId, user_id: selected.userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Grant failed");
      closeModal();
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Grant failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRevoke() {
    if (!selected || !selected.membershipId) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch("/api/admin/members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          membership_id: selected.membershipId,
          org_id: orgId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Revoke failed");
      closeModal();
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Revoke failed");
    } finally {
      setActionLoading(false);
      setShowRevokeConfirm(false);
    }
  }

  const isMember = selected && (selected.status === "active" || selected.status === "admin_granted");
  const isStripe = selected?.source === "stripe";

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
                {locationsEnabled && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                    Default Location
                  </th>
                )}
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  Billing
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  Status
                </th>
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
                  onClick={() => openModal(entry)}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${getAvatarColor(entry.userId)}`}
                      >
                        {getInitials(entry.name, entry.email)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                            {entry.name || "No name"}
                          </p>
                          {(entry.status === "active" || entry.status === "admin_granted") && (
                            <Crown className="h-3.5 w-3.5 text-amber-500" />
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                          {entry.email || "No email"}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-gray-800 dark:text-white/90">
                      {entry.phone || (
                        <span className="text-gray-400 dark:text-gray-500">—</span>
                      )}
                    </span>
                  </td>
                  {locationsEnabled && (
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {entry.defaultLocation || (
                          <span className="text-gray-400 dark:text-gray-500">—</span>
                        )}
                      </span>
                    </td>
                  )}
                  <td className="px-6 py-4">
                    <span className="text-sm text-gray-800 dark:text-white/90">
                      {formatBillingInterval(entry.billingInterval)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {getStatusBadge(entry.status)}
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {entry.memberSince
                        ? new Date(entry.memberSince).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : (
                          <span className="text-gray-400 dark:text-gray-500">—</span>
                        )}
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
            onClick={() => openModal(entry)}
          >
            <div className="flex items-center gap-3">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${getAvatarColor(entry.userId)}`}
              >
                {getInitials(entry.name, entry.email)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-gray-800 dark:text-white/90">
                    {entry.name || "No name"}
                  </p>
                  {getStatusBadge(entry.status)}
                </div>
                <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                  {entry.email || "No email"}
                  {entry.phone ? ` · ${entry.phone}` : ""}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {formatBillingInterval(entry.billingInterval)}
                  {locationsEnabled && entry.defaultLocation
                    ? ` · ${entry.defaultLocation}`
                    : ""}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Member Detail Modal */}
      {modalOpen && selected && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900">
            {/* Header */}
            <div className="flex items-center gap-3">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-full text-sm font-semibold ${getAvatarColor(selected.userId)}`}
              >
                {getInitials(selected.name, selected.email)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-lg font-semibold text-gray-800 dark:text-white/90">
                    {selected.name || "No name"}
                  </h3>
                  {(selected.status === "active" || selected.status === "admin_granted") && (
                    <Crown className="h-4 w-4 shrink-0 text-amber-500" />
                  )}
                </div>
                {getStatusBadge(selected.status)}
              </div>
            </div>

            {/* Details */}
            <div className="mt-5 space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <Mail className="h-4 w-4 shrink-0 text-gray-400" />
                <span className="text-gray-700 dark:text-gray-300">
                  {selected.email || "No email"}
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Phone className="h-4 w-4 shrink-0 text-gray-400" />
                <span className="text-gray-700 dark:text-gray-300">
                  {selected.phone || "No phone"}
                </span>
              </div>
              {locationsEnabled && (
                <div className="flex items-center gap-3 text-sm">
                  <MapPin className="h-4 w-4 shrink-0 text-gray-400" />
                  <span className="text-gray-700 dark:text-gray-300">
                    {selected.defaultLocation || "No location set"}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-3 text-sm">
                <CreditCard className="h-4 w-4 shrink-0 text-gray-400" />
                <span className="text-gray-700 dark:text-gray-300">
                  {isMember
                    ? `${tierName || "Membership"} · ${formatBillingInterval(selected.billingInterval)}`
                    : "No membership"
                  }
                </span>
              </div>
              {selected.memberSince && (
                <div className="flex items-center gap-3 text-sm">
                  <Calendar className="h-4 w-4 shrink-0 text-gray-400" />
                  <span className="text-gray-700 dark:text-gray-300">
                    Member since{" "}
                    {new Date(selected.memberSince).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
              )}
            </div>

            {/* Error */}
            {actionError && (
              <p className="mt-4 text-sm text-red-600 dark:text-red-400">
                {actionError}
              </p>
            )}

            {/* Actions */}
            <div className="mt-6 space-y-3">
              {isMember ? (
                <>
                  {/* Revoke flow */}
                  {!showRevokeConfirm ? (
                    <button
                      onClick={() => setShowRevokeConfirm(true)}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      <UserMinus className="h-4 w-4" />
                      Revoke Membership
                    </button>
                  ) : (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
                      {isStripe && (
                        <div className="mb-3 flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                          <p className="text-xs text-gray-700 dark:text-gray-300">
                            This will cancel the customer&apos;s Stripe subscription and revoke their membership immediately.
                          </p>
                        </div>
                      )}
                      <p className="text-sm font-medium text-red-700 dark:text-red-400">
                        Are you sure you want to revoke this membership?
                      </p>
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={handleRevoke}
                          disabled={actionLoading}
                          className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                        >
                          {actionLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <UserMinus className="h-4 w-4" />
                          )}
                          Confirm Revoke
                        </button>
                        <button
                          onClick={() => setShowRevokeConfirm(false)}
                          disabled={actionLoading}
                          className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <button
                  onClick={handleGrant}
                  disabled={actionLoading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {actionLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                  Grant Membership
                </button>
              )}

              <button
                onClick={closeModal}
                className="flex w-full items-center justify-center rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
