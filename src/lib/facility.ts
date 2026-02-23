import { cookies, headers } from "next/headers";

/**
 * Get the current facility slug.
 * Checks (in order): middleware header (subdomain), then cookie (Enter as Admin).
 */
export async function getFacilitySlug(): Promise<string | null> {
  const headerStore = await headers();
  const fromHeader = headerStore.get("x-facility-slug");
  if (fromHeader) return fromHeader;

  // Fallback: read playbook-facility cookie (set by ?facility= param for dev/preview)
  // Note: playbook-admin-org is handled by middleware (only for /admin routes)
  const cookieStore = await cookies();
  return cookieStore.get("playbook-facility")?.value || null;
}
