import { type EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  const supabase = await createClient();
  let authError: { message: string } | null = null;

  // Path 1: PKCE code exchange (standard sign-in/sign-up, magic link via Supabase verify)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return await buildSuccessRedirect(supabase, origin, next);
    }
    authError = error;
  }

  // Path 2: Token hash verification (invite, magic link, email confirm — direct to app)
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error) {
      return await buildSuccessRedirect(supabase, origin, next);
    }
    authError = error;
  }

  // Auth failed — include error message for debugging
  const msg = authError?.message || "no_auth_params";
  return NextResponse.redirect(
    `${origin}/auth/login?error=${encodeURIComponent(msg)}`
  );
}

/** Build redirect response, setting admin org cookie if applicable */
async function buildSuccessRedirect(
  supabase: SupabaseClient,
  origin: string,
  next: string
) {
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
