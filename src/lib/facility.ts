import { headers } from "next/headers";

/**
 * Get the current facility slug from the request headers.
 * Set by middleware from subdomain or ?facility= query param.
 */
export async function getFacilitySlug(): Promise<string | null> {
  const headerStore = await headers();
  return headerStore.get("x-facility-slug");
}
