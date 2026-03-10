import { NextResponse } from "next/server";
import { Webhook } from "standardwebhooks";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/emails/send";
import { confirmSignupEmail } from "@/lib/emails/templates/confirm-signup";
import { magicLinkEmail } from "@/lib/emails/templates/magic-link";
import { resetPasswordEmail } from "@/lib/emails/templates/reset-password";
import { emailChangeEmail } from "@/lib/emails/templates/email-change";
import type { OrgBranding } from "@/lib/emails/types";

type EmailHookPayload = {
  user: {
    id: string;
    email: string;
    user_metadata: Record<string, string | undefined>;
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
};

export async function POST(request: Request) {
  // 1. Verify webhook signature
  const hookSecret = process.env.SUPABASE_AUTH_HOOK_SECRET;
  if (!hookSecret) {
    console.error("[email-hook] SUPABASE_AUTH_HOOK_SECRET not configured");
    return NextResponse.json({ error: "Hook secret not configured" }, { status: 500 });
  }

  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  try {
    // Strip "v1,whsec_" prefix — the Webhook class expects just the base64 secret
    const secret = hookSecret.replace(/^v1,whsec_/, "whsec_");
    const wh = new Webhook(secret);
    wh.verify(rawBody, headers);
  } catch (err) {
    console.error("[email-hook] Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // 2. Parse payload
  const payload: EmailHookPayload = JSON.parse(rawBody);
  const { user, email_data } = payload;
  const { email_action_type, token_hash, redirect_to, site_url } = email_data;

  // 3. Resolve org branding from user metadata, redirect_to URL, or profile
  const orgBranding = await resolveOrgBranding(user, redirect_to);

  // 4. Build the confirmation/action URL
  // Format: {supabase_url}/auth/v1/verify?token={token_hash}&type={email_action_type}&redirect_to={redirect_to}
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const actionUrl = `${supabaseUrl}/auth/v1/verify?token=${token_hash}&type=${email_action_type}&redirect_to=${encodeURIComponent(redirect_to || site_url)}`;

  // 5. Generate and send the org-branded email
  const fromName = orgBranding
    ? `${orgBranding.emailFromName || orgBranding.name} via EZBooker`
    : "EZBooker";

  let emailContent: { subject: string; html: string };

  switch (email_action_type) {
    case "signup":
      emailContent = confirmSignupEmail(orgBranding, actionUrl);
      break;
    case "magiclink":
      emailContent = magicLinkEmail(orgBranding, actionUrl);
      break;
    case "recovery":
      emailContent = resetPasswordEmail(orgBranding, actionUrl);
      break;
    case "email_change":
      emailContent = emailChangeEmail(orgBranding, actionUrl);
      break;
    default:
      console.warn(`[email-hook] Unknown email_action_type: ${email_action_type}`);
      emailContent = confirmSignupEmail(orgBranding, actionUrl);
  }

  const sent = await sendEmail({
    to: user.email,
    fromName,
    subject: emailContent.subject,
    html: emailContent.html,
  });

  if (!sent) {
    return NextResponse.json(
      { error: { http_code: 500, message: "Failed to send email" } },
    );
  }

  return NextResponse.json({});
}

/**
 * Resolve org branding from user metadata (facility_slug), redirect_to URL, or profile org_id.
 *
 * Priority:
 * 1. facility_slug in user_metadata (set during signup)
 * 2. facility_slug in redirect_to URL query params (set during magic link/reset)
 * 3. User's profile org_id (for existing users)
 * 4. null (fallback to generic EZBooker branding)
 */
async function resolveOrgBranding(
  user: EmailHookPayload["user"],
  redirectTo?: string,
): Promise<OrgBranding | null> {
  const supabase = createServiceClient();

  // Try facility_slug from user metadata first (set during signup)
  let facilitySlug = user.user_metadata?.facility_slug;

  // Fallback: try extracting from redirect_to URL (set during magic link/reset)
  if (!facilitySlug && redirectTo) {
    try {
      const url = new URL(redirectTo);
      facilitySlug = url.searchParams.get("facility_slug") || undefined;
    } catch {
      // Invalid URL, ignore
    }
  }
  if (facilitySlug) {
    const { data: org } = await supabase
      .from("organizations")
      .select("name, slug, logo_url, brand_color, email_from_name")
      .eq("slug", facilitySlug)
      .single();

    if (org) {
      return {
        name: org.name,
        slug: org.slug,
        logoUrl: org.logo_url,
        brandColor: org.brand_color || "#18181b",
        emailFromName: org.email_from_name,
      };
    }
  }

  // Fallback: look up user's profile to find their org
  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();

  if (profile?.org_id) {
    const { data: org } = await supabase
      .from("organizations")
      .select("name, slug, logo_url, brand_color, email_from_name")
      .eq("id", profile.org_id)
      .single();

    if (org) {
      return {
        name: org.name,
        slug: org.slug,
        logoUrl: org.logo_url,
        brandColor: org.brand_color || "#18181b",
        emailFromName: org.email_from_name,
      };
    }
  }

  return null;
}
