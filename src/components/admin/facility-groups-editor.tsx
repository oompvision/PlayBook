"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Layers,
  X,
} from "lucide-react";

type Bay = {
  id: string;
  name: string;
  resource_type: string | null;
  hourly_rate_cents: number;
};

type Group = {
  id: string;
  name: string;
  description: string | null;
};

type Member = {
  id: string;
  group_id: string;
  bay_id: string;
};

type Rule = {
  bay_id: string;
  day_of_week: number;
  open_time: string;
  close_time: string;
  buffer_minutes: number;
  start_time_granularity: number;
  available_durations: number[];
};

export function FacilityGroupsEditor({
  orgId,
  locationId,
  bays,
  existingGroups,
  existingMembers,
  existingRules,
}: {
  orgId: string;
  locationId: string | null;
  bays: Bay[];
  existingGroups: Group[];
  existingMembers: Member[];
  existingRules: Rule[];
}) {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>(existingGroups);
  const [memberMap, setMemberMap] = useState<Map<string, string[]>>(() => {
    const map = new Map<string, string[]>();
    for (const m of existingMembers) {
      const list = map.get(m.group_id) || [];
      list.push(m.bay_id);
      map.set(m.group_id, list);
    }
    return map;
  });

  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Build a set of bay IDs already assigned to a group
  const assignedBayIds = new Set<string>();
  for (const [, bayIds] of memberMap) {
    for (const id of bayIds) {
      assignedBayIds.add(id);
    }
  }

  // Standalone bays (not in any group)
  const standaloneBays = bays.filter((b) => !assignedBayIds.has(b.id));

  // Build rules map for validation: bay_id -> rules[]
  const rulesMap = new Map<string, Rule[]>();
  for (const r of existingRules) {
    const list = rulesMap.get(r.bay_id) || [];
    list.push(r);
    rulesMap.set(r.bay_id, list);
  }

  // ─── Validation ─────────────────────────────────────────

  function validateGroupRules(bayIds: string[]): string | null {
    if (bayIds.length < 2) return null; // No validation needed for <2 bays

    const firstBayRules = rulesMap.get(bayIds[0]);
    if (!firstBayRules || firstBayRules.length === 0) {
      return `${bays.find((b) => b.id === bayIds[0])?.name} has no schedule rules configured`;
    }

    for (let i = 1; i < bayIds.length; i++) {
      const otherRules = rulesMap.get(bayIds[i]);
      if (!otherRules || otherRules.length === 0) {
        return `${bays.find((b) => b.id === bayIds[i])?.name} has no schedule rules configured`;
      }

      // Check each day matches
      for (const firstRule of firstBayRules) {
        const otherRule = otherRules.find(
          (r) => r.day_of_week === firstRule.day_of_week
        );
        if (!otherRule) {
          const dayName = [
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
          ][firstRule.day_of_week];
          return `Rules mismatch: ${bays.find((b) => b.id === bayIds[i])?.name} is missing ${dayName}`;
        }

        if (
          otherRule.open_time !== firstRule.open_time ||
          otherRule.close_time !== firstRule.close_time ||
          otherRule.buffer_minutes !== firstRule.buffer_minutes ||
          otherRule.start_time_granularity !== firstRule.start_time_granularity ||
          JSON.stringify(otherRule.available_durations.sort()) !==
            JSON.stringify(firstRule.available_durations.sort())
        ) {
          const dayName = [
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
          ][firstRule.day_of_week];
          return `Rules mismatch on ${dayName}: ${bays.find((b) => b.id === bayIds[0])?.name} and ${bays.find((b) => b.id === bayIds[i])?.name} have different settings`;
        }
      }
    }

    return null;
  }

  // ─── Create Group ───────────────────────────────────────

  async function handleCreateGroup() {
    if (!newGroupName.trim()) return;
    setCreating(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const supabase = createClient();
      const { data, error: insertError } = await supabase
        .from("facility_groups")
        .insert({
          org_id: orgId,
          ...(locationId ? { location_id: locationId } : {}),
          name: newGroupName.trim(),
          description: newGroupDesc.trim() || null,
        })
        .select("id, name, description")
        .single();

      if (insertError) throw insertError;

      setGroups((prev) => [...prev, data]);
      setMemberMap((prev) => new Map(prev).set(data.id, []));
      setNewGroupName("");
      setNewGroupDesc("");
      setSuccessMsg(`Group "${data.name}" created`);
    } catch (err) {
      setError(err instanceof Error ? err.message : err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "Failed to create group");
    } finally {
      setCreating(false);
    }
  }

  // ─── Delete Group ───────────────────────────────────────

  async function handleDeleteGroup(groupId: string) {
    setError(null);
    setSuccessMsg(null);

    try {
      const supabase = createClient();
      const { error: deleteError } = await supabase
        .from("facility_groups")
        .delete()
        .eq("id", groupId);

      if (deleteError) throw deleteError;

      setGroups((prev) => prev.filter((g) => g.id !== groupId));
      setMemberMap((prev) => {
        const next = new Map(prev);
        next.delete(groupId);
        return next;
      });
      setSuccessMsg("Group deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "Failed to delete group");
    }
  }

  // ─── Add Bay to Group ──────────────────────────────────

  async function handleAddBay(groupId: string, bayId: string) {
    setError(null);
    setSuccessMsg(null);

    // Check rule compatibility before adding
    const currentMembers = memberMap.get(groupId) || [];
    const newMembers = [...currentMembers, bayId];
    const validationError = validateGroupRules(newMembers);
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      const supabase = createClient();
      const { error: insertError } = await supabase
        .from("facility_group_members")
        .insert({ group_id: groupId, bay_id: bayId });

      if (insertError) throw insertError;

      setMemberMap((prev) => {
        const next = new Map(prev);
        const list = next.get(groupId) || [];
        next.set(groupId, [...list, bayId]);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "Failed to add facility");
    }
  }

  // ─── Remove Bay from Group ─────────────────────────────

  async function handleRemoveBay(groupId: string, bayId: string) {
    setError(null);
    setSuccessMsg(null);

    try {
      const supabase = createClient();
      const { error: deleteError } = await supabase
        .from("facility_group_members")
        .delete()
        .eq("group_id", groupId)
        .eq("bay_id", bayId);

      if (deleteError) throw deleteError;

      setMemberMap((prev) => {
        const next = new Map(prev);
        const list = next.get(groupId) || [];
        next.set(
          groupId,
          list.filter((id) => id !== bayId)
        );
        return next;
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "Failed to remove facility"
      );
    }
  }

  return (
    <div className="space-y-6">
      {/* Error / Success */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {successMsg}
        </div>
      )}

      {/* Existing Groups */}
      {groups.map((group) => {
        const groupBayIds = memberMap.get(group.id) || [];
        const groupBays = groupBayIds
          .map((id) => bays.find((b) => b.id === id))
          .filter(Boolean) as Bay[];

        // Available bays to add (not already in any group)
        const availableToAdd = bays.filter(
          (b) => !assignedBayIds.has(b.id) || groupBayIds.includes(b.id)
        ).filter((b) => !groupBayIds.includes(b.id));

        return (
          <div
            key={group.id}
            className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]"
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
              <div>
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  <h2 className="font-semibold text-gray-800 dark:text-white/90">
                    {group.name}
                  </h2>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                    {groupBays.length} facilit{groupBays.length !== 1 ? "ies" : "y"}
                  </span>
                </div>
                {group.description && (
                  <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                    {group.description}
                  </p>
                )}
              </div>
              <button
                onClick={() => handleDeleteGroup(group.id)}
                className="rounded-lg border border-gray-300 bg-white p-2 text-red-500 shadow-sm transition-colors hover:bg-red-50 dark:border-gray-700 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-950/30"
                title="Delete group"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Group Members */}
              {groupBays.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  No facilities assigned yet. Add facilities below.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {groupBays.map((bay) => (
                    <div
                      key={bay.id}
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/[0.03]"
                    >
                      <span className="font-medium text-gray-800 dark:text-white/90">
                        {bay.name}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        ${(bay.hourly_rate_cents / 100).toFixed(2)}/hr
                      </span>
                      <button
                        onClick={() => handleRemoveBay(group.id, bay.id)}
                        className="ml-1 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-red-500 dark:hover:bg-gray-700 dark:hover:text-red-400"
                        title="Remove from group"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add Bay Selector */}
              {standaloneBays.length > 0 && (
                <div className="flex items-center gap-2">
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        handleAddBay(group.id, e.target.value);
                        e.target.value = "";
                      }
                    }}
                    className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                  >
                    <option value="" disabled>
                      Add facility...
                    </option>
                    {standaloneBays.map((bay) => (
                      <option key={bay.id} value={bay.id}>
                        {bay.name} — ${(bay.hourly_rate_cents / 100).toFixed(2)}/hr
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Create New Group */}
      <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-white/[0.05]">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            <h2 className="font-semibold text-gray-800 dark:text-white/90">
              Create New Group
            </h2>
          </div>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            Group identical facilities together for pooled availability.
            Facilities in a group must have matching schedule rules.
          </p>
        </div>
        <div className="p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Group Name
              </label>
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder='e.g. "Golf Simulators"'
                className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Description (optional)
              </label>
              <input
                value={newGroupDesc}
                onChange={(e) => setNewGroupDesc(e.target.value)}
                placeholder="Brief description"
                className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
              />
            </div>
          </div>
          <button
            onClick={handleCreateGroup}
            disabled={creating || !newGroupName.trim()}
            className="mt-4 inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Create Group
          </button>
        </div>
      </div>

      {/* Standalone Bays Info */}
      {standaloneBays.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-white/[0.05] dark:bg-white/[0.03]">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Standalone Facilities (not in any group)
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {standaloneBays.map((bay) => (
              <span
                key={bay.id}
                className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-300"
              >
                {bay.name}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
            These appear as individual options in the customer booking flow.
          </p>
        </div>
      )}
    </div>
  );
}
