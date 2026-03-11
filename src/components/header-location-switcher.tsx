"use client";

import { useSearchParams } from "next/navigation";
import { LocationSwitcher } from "@/components/location-switcher";

type Location = {
  id: string;
  name: string;
  is_default: boolean;
};

export function HeaderLocationSwitcher({
  locations,
}: {
  locations: Location[];
}) {
  const searchParams = useSearchParams();
  const urlLocationId = searchParams.get("location");
  const defaultLocation = locations.find((l) => l.is_default) || locations[0];
  const activeLocationId = urlLocationId || defaultLocation?.id || "";

  if (!activeLocationId) return null;

  return (
    <LocationSwitcher
      locations={locations}
      activeLocationId={activeLocationId}
    />
  );
}
