"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MapPin, Pencil, Trash2, X, Check } from "lucide-react";

interface Bay {
  id: string;
  name: string;
  is_active: boolean;
}

interface Location {
  id: string;
  name: string;
  address: string | null;
  is_default: boolean;
  is_active: boolean;
}

interface LocationCardProps {
  location: Location;
  bays: Bay[];
  orgId: string;
  toggleAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
  updateAction: (formData: FormData) => Promise<void>;
}

export function LocationCard({
  location: loc,
  bays,
  orgId,
  toggleAction,
  deleteAction,
  updateAction,
}: LocationCardProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(loc.name);
  const [address, setAddress] = useState(loc.address ?? "");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            {editing ? (
              <form
                action={async (formData) => {
                  await updateAction(formData);
                  setEditing(false);
                }}
                className="space-y-2"
              >
                <input type="hidden" name="location_id" value={loc.id} />
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <Input
                    name="location_name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="text-sm h-8"
                    placeholder="Location name"
                    autoFocus
                  />
                </div>
                <div className="flex items-center gap-2 pl-6">
                  <Input
                    name="location_address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="text-sm h-8"
                    placeholder="Address (optional)"
                  />
                </div>
                <div className="flex items-center gap-1.5 pl-6">
                  <Button type="submit" size="sm" className="h-7 text-xs">
                    <Check className="mr-1 h-3 w-3" />
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setName(loc.name);
                      setAddress(loc.address ?? "");
                      setEditing(false);
                    }}
                  >
                    <X className="mr-1 h-3 w-3" />
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{loc.name}</span>
                  {loc.is_default && (
                    <Badge variant="outline" className="shrink-0 text-xs">
                      Default
                    </Badge>
                  )}
                  <Badge
                    variant={loc.is_active ? "default" : "secondary"}
                    className="shrink-0"
                  >
                    {loc.is_active ? "Active" : "Inactive"}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                    title="Edit location"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </CardTitle>
                {loc.address && (
                  <CardDescription className="mt-1 pl-6">
                    {loc.address}
                  </CardDescription>
                )}
              </>
            )}
          </div>
          {/* Location actions (toggle/delete) — only for non-default */}
          {!loc.is_default && !editing && (
            <div className="ml-3 flex items-center gap-2 shrink-0">
              <form action={toggleAction}>
                <input type="hidden" name="location_id" value={loc.id} />
                <input
                  type="hidden"
                  name="new_active"
                  value={String(!loc.is_active)}
                />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="text-xs"
                >
                  {loc.is_active ? "Deactivate" : "Activate"}
                </Button>
              </form>
              <form action={deleteAction}>
                <input type="hidden" name="location_id" value={loc.id} />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="text-xs text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </form>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Facilities ({bays.length})
        </p>
        {bays.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No facilities at this location yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {bays.map((bay) => (
              <li
                key={bay.id}
                className="flex items-center justify-between text-sm"
              >
                <span>{bay.name}</span>
                <Badge
                  variant={bay.is_active ? "default" : "secondary"}
                  className="text-xs"
                >
                  {bay.is_active ? "Active" : "Inactive"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
