"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Crown, Plus, UserMinus, Search, Loader2 } from "lucide-react";
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
    case "monthly":
      return "Monthly";
    case "yearly":
      return "Yearly";
    case "admin_granted":
      return "Granted";
    default:
      return "—";
  }
}

function getStatusBadge(status: string) {
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
    default:
      return (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          {status}
        </span>
      );
  }
}

type CustomerResult = {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
};

type Props = {
  entries: MemberEntry[];
  orgId: string;
  locationsEnabled: boolean;
};

export function MembersList({ entries, orgId, locationsEnabled }: Props) {
  const router = useRouter();
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [grantSearch, setGrantSearch] = useState("");
  const [searchResults, setSearchResults] = useState<CustomerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [grantError, setGrantError] = useState<string | null>(null);

  async function handleSearchCustomers() {
    if (!grantSearch.trim()) return;
    setSearching(true);
    setGrantError(null);
    try {
      const res = await fetch(
        `/api/admin/members?action=search&org_id=${orgId}&q=${encodeURIComponent(grantSearch.trim())}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setSearchResults(data.customers || []);
    } catch (err) {
      setGrantError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function handleGrant(userId: string) {
    setGranting(true);
    setGrantError(null);
    try {
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId, user_id: userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Grant failed");
      setShowGrantModal(false);
      setGrantSearch("");
      setSearchResults([]);
      router.refresh();
    } catch (err) {
      setGrantError(err instanceof Error ? err.message : "Grant failed");
    } finally {
      setGranting(false);
    }
  }

  async function handleRevoke(membershipId: string) {
    if (!confirm("Revoke this admin-granted membership?")) return;
    setRevoking(membershipId);
    try {
      const res = await fetch("/api/admin/members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membership_id: membershipId, org_id: orgId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Revoke failed");
      router.refresh();
    } catch {
      alert("Failed to revoke membership");
    } finally {
      setRevoking(null);
    }
  }

  // Filter out existing member user IDs from search results
  const existingUserIds = new Set(entries.map((e) => e.userId));

  return (
    <>
      {/* Grant Button */}
      <div className="flex justify-end border-b border-gray-100 px-6 py-3 dark:border-white/[0.05]">
        <button
          onClick={() => setShowGrantModal(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Grant Membership
        </button>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/[0.05]">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  Member
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
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="transition-colors hover:bg-gray-50/50 dark:hover:bg-white/[0.02]"
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
                          <Crown className="h-3.5 w-3.5 text-amber-500" />
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
                      {new Date(entry.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {entry.source === "admin" && (
                      <button
                        onClick={() => handleRevoke(entry.id)}
                        disabled={revoking === entry.id}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20"
                      >
                        {revoking === entry.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <UserMinus className="h-3 w-3" />
                        )}
                        Revoke
                      </button>
                    )}
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
          <div key={entry.id} className="px-5 py-4">
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
              {entry.source === "admin" && (
                <button
                  onClick={() => handleRevoke(entry.id)}
                  disabled={revoking === entry.id}
                  className="shrink-0 rounded-lg p-2 text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  {revoking === entry.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserMinus className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Grant Membership Modal */}
      {showGrantModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              Grant Membership
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Search for a customer to grant membership to.
            </p>

            <div className="mt-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    value={grantSearch}
                    onChange={(e) => setGrantSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleSearchCustomers())}
                    placeholder="Name, email, or phone..."
                    className="h-10 w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-800 dark:text-white/90 dark:placeholder:text-white/30"
                  />
                </div>
                <button
                  onClick={handleSearchCustomers}
                  disabled={searching}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {searching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Search"
                  )}
                </button>
              </div>

              {grantError && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                  {grantError}
                </p>
              )}

              {searchResults.length > 0 && (
                <div className="mt-3 max-h-60 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
                  {searchResults.map((customer) => {
                    const isExisting = existingUserIds.has(customer.id);
                    return (
                      <div
                        key={customer.id}
                        className="flex items-center justify-between border-b border-gray-100 px-4 py-3 last:border-b-0 dark:border-gray-700"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-gray-800 dark:text-white/90">
                            {customer.full_name || "No name"}
                          </p>
                          <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                            {customer.email}
                          </p>
                        </div>
                        {isExisting ? (
                          <span className="shrink-0 text-xs text-gray-400">
                            Already a member
                          </span>
                        ) : (
                          <button
                            onClick={() => handleGrant(customer.id)}
                            disabled={granting}
                            className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                          >
                            {granting ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              "Grant"
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {searchResults.length === 0 && grantSearch && !searching && !grantError && (
                <p className="mt-3 text-center text-sm text-gray-400">
                  No customers found. Try a different search.
                </p>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => {
                  setShowGrantModal(false);
                  setGrantSearch("");
                  setSearchResults([]);
                  setGrantError(null);
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
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
