import { cookies, headers } from "next/headers";

/**
 * Get the current facility slug.
 * Checks (in order): middleware header (subdomain), then cookie (Enter as Admin).
 */
export async function getFacilitySlug(): Promise<string | null> {
  const headerStore = await headers();
  const fromHeader = headerStore.get("x-facility-slug");
  if (fromHeader) return fromHeader;

  // Fallback: read cookie (set by ?facility= param or super admin "Enter as Admin")
  const cookieStore = await cookies();
  return cookieStore.get("playbook-facility")?.value ||
    cookieStore.get("playbook-admin-org")?.value || null;
}
