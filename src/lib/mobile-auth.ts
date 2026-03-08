import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export type MobileAuthResult = {
  user: { id: string; email: string };
  profile: {
    id: string;
    org_id: string | null;
    email: string;
    full_name: string | null;
    role: "super_admin" | "admin" | "customer";
  };
};

/**
 * Authenticate a mobile request using the Supabase JWT from
 * the Authorization: Bearer <token> header.
 * Returns user + profile, or null if invalid.
 */
export async function getMobileAuth(
  request: NextRequest
): Promise<MobileAuthResult | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);

  // Create a Supabase client authenticated with the user's JWT
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) return null;

  // Fetch profile via RPC (bypasses RLS)
  const { data: profile } = await supabase.rpc("get_my_profile");
  if (!profile) return null;

  return {
    user: { id: user.id, email: user.email! },
    profile: profile as MobileAuthResult["profile"],
  };
}
