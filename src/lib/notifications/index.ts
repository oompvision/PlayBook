import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/service";
import { renderNotificationEmail, guestBookingConfirmedEmail } from "@/lib/emails/templates/notification-emails";
import type { OrgBranding } from "@/lib/emails/types";
import type {
  CreateNotificationParams,
  NotificationRecord,
  NotificationType,
  RecipientType,
} from "./types";

export type { CreateNotificationParams, NotificationRecord, NotificationType, RecipientType };
export { NOTIFICATION_TYPES, NOTIFICATION_TYPE_LABELS } from "./types";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = "noreply@updates.ezbooker.app";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://ezbooker.app";

/**
 * Single entry point for creating notifications.
 * 1. Inserts a row into the notifications table (via service role)
 * 2. Checks org_email_settings to decide whether to send email
 * 3. If email is enabled + recipientEmail provided, renders HTML template and sends via Resend
 * 4. Updates the notification row with email_sent status
 */
export async function createNotification(
  params: CreateNotificationParams
): Promise<{ success: boolean; notificationId: string | null }> {
  const supabase = createServiceClient();

  // 1. Insert notification row
  const { data: notification, error: insertError } = await supabase
    .from("notifications")
    .insert({
      org_id: params.orgId,
      recipient_id: params.recipientId,
      recipient_type: params.recipientType,
      type: params.type,
      title: params.title,
      message: params.message,
      link: params.link ?? null,
      metadata: params.metadata ?? null,
    })
    .select("id")
    .single();

  if (insertError || !notification) {
    console.error("[notifications] Failed to insert notification:", insertError);
    return { success: false, notificationId: null };
  }

  // 2. Check org_email_settings
  if (params.recipientEmail) {
    const emailEnabled = await isEmailEnabled(
      supabase,
      params.orgId,
      params.type,
      params.recipientType
    );

    if (emailEnabled) {
      // 3. Resolve org branding for templated email
      const orgBranding = await getOrgBranding(supabase, params.orgId);

      // Try HTML template first, fall back to plain text
      const rendered = renderNotificationEmail(params.type, orgBranding, {
        message: params.message,
        metadata: params.metadata,
        recipientName: params.recipientName,
        siteUrl: SITE_URL,
      });

      let emailSent: boolean;
      if (rendered) {
        // Send templated HTML email
        emailSent = await sendHtmlEmail({
          to: params.recipientEmail,
          fromName: orgBranding?.emailFromName || orgBranding?.name || params.orgName,
          subject: rendered.subject,
          html: rendered.html,
        });
      } else {
        // Fallback: plain text for types without templates
        emailSent = await sendPlainEmail({
          to: params.recipientEmail,
          toName: params.recipientName,
          subject: params.title,
          body: params.message,
          link: params.link,
          orgName: params.orgName,
        });
      }

      // 4. Update notification with email status
      if (emailSent) {
        await supabase
          .from("notifications")
          .update({ email_sent: true, email_sent_at: new Date().toISOString() })
          .eq("id", notification.id);
      }
    }
  }

  return { success: true, notificationId: notification.id };
}

/**
 * Send notifications to all org admins for a given org.
 * Looks up admin profiles and calls createNotification for each.
 */
export async function notifyOrgAdmins(
  orgId: string,
  orgName: string,
  params: {
    type: NotificationType;
    title: string;
    message: string;
    link?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const supabase = createServiceClient();

  const { data: admins } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("org_id", orgId)
    .eq("role", "admin");

  if (!admins || admins.length === 0) return;

  for (const admin of admins) {
    await createNotification({
      orgId,
      recipientId: admin.id,
      recipientType: "org_admin",
      type: params.type,
      title: params.title,
      message: params.message,
      link: params.link,
      metadata: params.metadata,
      recipientEmail: admin.email,
      recipientName: admin.full_name ?? undefined,
      orgName,
    });
  }
}

/**
 * Send a templated email to a guest (no in-app notification row).
 * Used for guest booking confirmations.
 */
export async function sendGuestEmail(params: {
  to: string;
  toName?: string;
  subject: string;
  body: string;
  orgName?: string;
  orgId?: string;
  metadata?: Record<string, unknown>;
  claimUrl?: string | null;
}): Promise<boolean> {
  // Try templated HTML email
  if (params.orgId) {
    const supabase = createServiceClient();
    const orgBranding = await getOrgBranding(supabase, params.orgId);

    const rendered = guestBookingConfirmedEmail(
      orgBranding,
      {
        bayName: (params.metadata?.bay ?? params.metadata?.bayName) as string | undefined,
        dateStr: params.metadata?.dateStr as string | undefined,
        timeStr: params.metadata?.timeStr as string | undefined,
        confirmationCode: params.metadata?.confirmation_code as string | undefined,
        totalPrice: params.metadata?.totalPrice as string | undefined,
      },
      params.claimUrl ?? null,
      SITE_URL,
    );

    return sendHtmlEmail({
      to: params.to,
      fromName: orgBranding?.emailFromName || orgBranding?.name || params.orgName,
      subject: rendered.subject,
      html: rendered.html,
    });
  }

  // Fallback: plain text
  return sendPlainEmail({
    to: params.to,
    toName: params.toName,
    subject: params.subject,
    body: params.body,
    orgName: params.orgName,
  });
}

// ── Internal helpers ────────────────────────────────────────

async function getOrgBranding(
  supabase: ReturnType<typeof createServiceClient>,
  orgId: string,
): Promise<OrgBranding | null> {
  const { data: org } = await supabase
    .from("organizations")
    .select("name, slug, logo_url, brand_color, email_from_name")
    .eq("id", orgId)
    .single();

  if (!org) return null;

  return {
    name: org.name,
    slug: org.slug,
    logoUrl: org.logo_url,
    brandColor: org.brand_color || "#18181b",
    emailFromName: org.email_from_name,
  };
}

async function isEmailEnabled(
  supabase: ReturnType<typeof createServiceClient>,
  orgId: string,
  type: NotificationType,
  recipientType: RecipientType
): Promise<boolean> {
  const { data: setting } = await supabase
    .from("org_email_settings")
    .select("email_to_customer, email_to_admin")
    .eq("org_id", orgId)
    .eq("notification_type", type)
    .single();

  if (!setting) return true; // Default to sending if no setting found

  return recipientType === "customer"
    ? setting.email_to_customer
    : setting.email_to_admin;
}

async function sendHtmlEmail(params: {
  to: string;
  fromName?: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  if (!resend) {
    console.warn("[notifications] Resend not configured (RESEND_API_KEY missing), skipping email");
    return false;
  }

  try {
    const fromName = params.fromName
      ? `${params.fromName} via EZBooker`
      : "EZBooker";

    await resend.emails.send({
      from: `${fromName} <${FROM_EMAIL}>`,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });

    return true;
  } catch (err) {
    console.error("[notifications] Failed to send email:", err);
    return false;
  }
}

async function sendPlainEmail(params: {
  to: string;
  toName?: string;
  subject: string;
  body: string;
  link?: string;
  orgName?: string;
}): Promise<boolean> {
  if (!resend) {
    console.warn("[notifications] Resend not configured (RESEND_API_KEY missing), skipping email");
    return false;
  }

  try {
    const fromName = params.orgName
      ? `${params.orgName} via EZBooker`
      : "EZBooker";

    let textBody = params.body;
    if (params.link) {
      textBody += `\n\n${params.link}`;
    }

    await resend.emails.send({
      from: `${fromName} <${FROM_EMAIL}>`,
      to: params.toName ? `${params.toName} <${params.to}>` : params.to,
      subject: params.subject,
      text: textBody,
    });

    return true;
  } catch (err) {
    console.error("[notifications] Failed to send email:", err);
    return false;
  }
}
