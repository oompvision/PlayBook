import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const forwardUrl = `${origin}${next}`;
      const response = NextResponse.redirect(forwardUrl);

      // If this user is an admin, set the org cookie so /admin routes work
      const { data: profile } = await supabase.rpc("get_my_profile");
      if (profile?.role === "admin" && profile?.org_id) {
        const { data: org } = await supabase
          .from("organizations")
          .select("slug")
          .eq("id", profile.org_id)
          .single();

        if (org) {
          response.cookies.set("playbook-admin-org", org.slug, {
            path: "/",
            httpOnly: true,
            sameSite: "lax",
            maxAge: 60 * 60 * 8, // 8 hours
          });
        }
      }

      return response;
    }
  }

  // Auth code exchange failed — redirect to login with error
  return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`);
}
