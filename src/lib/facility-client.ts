/**
 * Client-side facility slug resolution.
 * Extracts from subdomain or ?facility= query parameter.
 */

const PLATFORM_HOSTS = ["ezbooker.app", "playbook.com"];
const RESERVED_SUBDOMAINS = ["www", "admin", "api"];

export function getClientFacilitySlug(): string | null {
  if (typeof window === "undefined") return null;

  // 1. Check subdomain (e.g., aceindoor.ezbooker.app)
  const hostname = window.location.hostname;
  for (const platformHost of PLATFORM_HOSTS) {
    if (hostname.endsWith(`.${platformHost}`)) {
      const sub = hostname.slice(0, -(platformHost.length + 1));
      if (sub && !RESERVED_SUBDOMAINS.includes(sub)) {
        return sub;
      }
    }
  }

  // 2. Check ?facility= query parameter
  const params = new URLSearchParams(window.location.search);
  const facilityParam = params.get("facility");
  if (facilityParam) return facilityParam;

  return null;
}
