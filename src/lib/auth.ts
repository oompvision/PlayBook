import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export type Profile = {
  id: string;
  org_id: string | null;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: "super_admin" | "admin" | "customer";
};

/**
 * Get the current authenticated user and their profile.
 * Returns null if not authenticated.
 */
export async function getAuthUser(): Promise<{
  user: { id: string; email: string };
  profile: Profile;
} | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Use RPC to bypass RLS — server already verified auth via getUser()
  const { data: profile } = await supabase.rpc("get_my_profile");

  if (!profile) return null;

  return {
    user: { id: user.id, email: user.email! },
    profile: profile as Profile,
  };
}

/**
 * Require authentication. Redirects to login if not authenticated.
 */
export async function requireAuth(redirectPath?: string) {
  const auth = await getAuthUser();
  if (!auth) {
    redirect(redirectPath || "/auth/login");
  }
  return auth;
}

/**
 * Require super_admin role. Redirects if not authorized.
 */
export async function requireSuperAdmin() {
  const auth = await getAuthUser();
  if (!auth) {
    redirect("/super-admin/auth/login");
  }
  if (auth.profile?.role !== "super_admin") {
    redirect("/super-admin/setup");
  }
  return auth as { user: { id: string; email: string }; profile: NonNullable<typeof auth.profile> };
}

/**
 * Require admin role for a specific org.
 */
export async function requireAdmin(orgId?: string) {
  const auth = await getAuthUser();
  if (!auth) {
    redirect("/auth/login");
  }
  if (
    auth.profile.role !== "admin" &&
    auth.profile.role !== "super_admin"
  ) {
    redirect("/");
  }
  if (orgId && auth.profile.role === "admin" && auth.profile.org_id !== orgId) {
    redirect("/");
  }
  return auth;
}

/**
 * Ensure a customer profile is associated with the given org.
 * Called on facility-scoped pages so customers get linked on first visit.
 */
export async function ensureCustomerOrg(orgId: string) {
  const auth = await getAuthUser();
  if (!auth) return null;

  // Only update customer profiles that don't yet have an org
  if (auth.profile.role === "customer" && !auth.profile.org_id) {
    const supabase = await createClient();
    await supabase
      .from("profiles")
      .update({ org_id: orgId })
      .eq("id", auth.profile.id);
    auth.profile.org_id = orgId;
  }

  return auth;
}
