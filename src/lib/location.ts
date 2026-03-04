import { createClient } from "@/lib/supabase/server";

export type LocationInfo = {
  id: string;
  name: string;
  address: string | null;
  is_active: boolean;
  is_default: boolean;
};

/**
 * Resolve the active location for a given org.
 * Priority: 1) explicit locationId param (from ?location= query)
 *           2) user's saved preference
 *           3) org's default location
 */
export async function resolveLocationId(
  orgId: string,
  locationIdParam?: string | null,
  userId?: string | null
): Promise<string | null> {
  const supabase = await createClient();

  // 1. If explicit location param, validate it belongs to org and is active
  if (locationIdParam) {
    const { data } = await supabase
      .from("locations")
      .select("id")
      .eq("id", locationIdParam)
      .eq("org_id", orgId)
      .eq("is_active", true)
      .single();
    if (data) return data.id;
  }

  // 2. Check user's saved preference for this org
  if (userId) {
    const { data: pref } = await supabase
      .from("user_location_preferences")
      .select("default_location_id")
      .eq("user_id", userId)
      .eq("org_id", orgId)
      .single();

    if (pref?.default_location_id) {
      // Verify the preferred location is still active
      const { data: loc } = await supabase
        .from("locations")
        .select("id")
        .eq("id", pref.default_location_id)
        .eq("is_active", true)
        .single();
      if (loc) return loc.id;
      // Preferred location was deactivated — will fall through to default
    }
  }

  // 3. Fall back to org's default location
  const { data: defaultLoc } = await supabase
    .from("locations")
    .select("id")
    .eq("org_id", orgId)
    .eq("is_default", true)
    .single();

  return defaultLoc?.id || null;
}

/**
 * Get all active locations for an org.
 */
export async function getOrgLocations(orgId: string): Promise<LocationInfo[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("locations")
    .select("id, name, address, is_active, is_default")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .order("is_default", { ascending: false })
    .order("name");

  return (data as LocationInfo[]) || [];
}

/**
 * Check if a user's preferred location was deactivated.
 * Returns true if they have a preference pointing to an inactive location.
 */
export async function isPreferredLocationDeactivated(
  orgId: string,
  userId: string
): Promise<boolean> {
  const supabase = await createClient();
  const { data: pref } = await supabase
    .from("user_location_preferences")
    .select("default_location_id")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .single();

  if (!pref) return false;

  const { data: loc } = await supabase
    .from("locations")
    .select("is_active")
    .eq("id", pref.default_location_id)
    .single();

  return loc ? !loc.is_active : true;
}
