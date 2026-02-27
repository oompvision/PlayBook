import { type EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createNotification } from "@/lib/notifications";
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

  // Welcome notification for new customer signups
  if (profile?.role === "customer" && profile?.org_id) {
    // Fire-and-forget — don't block the redirect
    triggerWelcomeNotification(profile.id, profile.org_id, profile.email, profile.full_name).catch(() => {});
    // Auto-claim guest bookings matching this email
    claimGuestBookingsByEmail(profile.id, profile.email).catch(() => {});
  }

  return response;
}

/** Send welcome notification + stage pending signup for admin digest */
async function triggerWelcomeNotification(
  userId: string,
  orgId: string,
  email: string,
  fullName: string | null
) {
  const service = createServiceClient();

  // Check if a welcome notification was already sent (prevent duplicates on re-auth)
  const { count } = await service
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", userId)
    .eq("org_id", orgId)
    .eq("type", "welcome");

  if (count && count > 0) return;

  // Get org name for notification
  const { data: org } = await service
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .single();

  const orgName = org?.name ?? "EZBooker";

  // Send welcome notification to customer
  await createNotification({
    orgId,
    recipientId: userId,
    recipientType: "customer",
    type: "welcome",
    title: `Welcome to ${orgName}!`,
    message: `Thanks for signing up! You can browse available time slots on the home page, select your preferred times, and book instantly. View and manage your bookings from the "My Bookings" page anytime.`,
    link: "/",
    recipientEmail: email,
    recipientName: fullName ?? undefined,
    orgName,
  });

  // Stage pending signup notification for batched admin digest
  await service.from("pending_signup_notifications").insert({
    org_id: orgId,
    customer_id: userId,
    customer_email: email,
    customer_name: fullName,
  });
}

/** Auto-claim guest bookings when a user signs up with matching email */
async function claimGuestBookingsByEmail(userId: string, email: string) {
  const service = createServiceClient();

  // Find unclaimed guest bookings with matching email
  const { data: guestBookings } = await service
    .from("bookings")
    .select("id, confirmation_code")
    .eq("is_guest", true)
    .eq("guest_email", email)
    .is("customer_id", null)
    .eq("status", "confirmed");

  if (!guestBookings || guestBookings.length === 0) return;

  // Claim each booking
  for (const booking of guestBookings) {
    await service
      .from("bookings")
      .update({
        customer_id: userId,
        is_guest: false,
        claim_token: null,
      })
      .eq("id", booking.id);
  }
}
