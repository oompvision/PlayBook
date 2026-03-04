"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";

/**
 * Ensures ?location= param is always present in admin URLs when locations are enabled.
 * If the URL is missing the param, replaces it with the resolved default location ID.
 * Uses router.replace to avoid adding a history entry.
 */
export function LocationUrlSync({
  activeLocationId,
}: {
  activeLocationId: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (!searchParams.get("location") && activeLocationId) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("location", activeLocationId);
      router.replace(`${pathname}?${params.toString()}`);
    }
  }, [pathname, searchParams, activeLocationId, router]);

  return null;
}
