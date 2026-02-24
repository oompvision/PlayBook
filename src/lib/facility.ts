import { headers } from "next/headers";

/**
 * Get the current facility slug.
 * Reads the x-facility-slug header injected by middleware.
 * The middleware is the single source of truth for facility resolution
 * (subdomain, query param, or cookie — with context-appropriate rules).
 */
export async function getFacilitySlug(): Promise<string | null> {
  const headerStore = await headers();
  return headerStore.get("x-facility-slug") || null;
}
