"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { MapPin, ChevronDown, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Location = {
  id: string;
  name: string;
  is_default: boolean;
};

export function LocationSwitcher({
  locations,
  activeLocationId,
}: {
  locations: Location[];
  activeLocationId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Read location from URL first — layout props go stale on client navigations
  const urlLocationId = searchParams.get("location");
  const effectiveLocationId = urlLocationId || activeLocationId;
  const activeLocation = locations.find((l) => l.id === effectiveLocationId);

  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  // Clear loading state once the URL catches up to what we navigated to
  useEffect(() => {
    if (switchingTo && effectiveLocationId === switchingTo) {
      setSwitchingTo(null);
    }
  }, [effectiveLocationId, switchingTo]);

  const isSwitching = switchingTo !== null && switchingTo !== effectiveLocationId;
  const pendingLocation = isSwitching
    ? locations.find((l) => l.id === switchingTo)
    : null;

  function handleSwitch(locationId: string) {
    if (locationId === effectiveLocationId) return;
    setSwitchingTo(locationId);
    const params = new URLSearchParams(searchParams.toString());
    params.set("location", locationId);
    router.push(`${pathname}?${params.toString()}`);
  }

  if (locations.length <= 1) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-1 disabled:opacity-70"
          disabled={isSwitching}
        >
          {isSwitching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-500" />
          ) : (
            <MapPin className="h-3.5 w-3.5 text-gray-500" />
          )}
          <span className="max-w-[150px] truncate">
            {isSwitching
              ? pendingLocation?.name || "Switching…"
              : activeLocation?.name || "Select location"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {locations.map((loc) => (
          <DropdownMenuItem
            key={loc.id}
            onClick={() => handleSwitch(loc.id)}
            className={
              loc.id === effectiveLocationId
                ? "bg-gray-100 font-medium"
                : "cursor-pointer"
            }
          >
            <MapPin className="mr-2 h-4 w-4" />
            {loc.name}
            {loc.is_default && (
              <span className="ml-auto text-xs text-muted-foreground">
                Default
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
