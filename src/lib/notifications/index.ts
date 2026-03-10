import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/service";
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

/**
 * Single entry point for creating notifications.
 * 1. Inserts a row into the notifications table (via service role)
 * 2. Checks org_email_settings to decide whether to send email
 * 3. If email is enabled + recipientEmail provided, sends via Resend
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
      // 3. Send email via Resend
      const emailSent = await sendEmail({
        to: params.recipientEmail,
        toName: params.recipientName,
        subject: params.title,
        body: params.message,
        link: params.link,
        orgName: params.orgName,
      });

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

  // Include both org admins and super_admins (who manage all orgs)
  const { data: orgAdmins } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("org_id", orgId)
    .eq("role", "admin");

  const { data: superAdmins } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("role", "super_admin");

  // Merge and deduplicate by id
  const adminMap = new Map<string, { id: string; email: string; full_name: string | null }>();
  for (const a of orgAdmins ?? []) adminMap.set(a.id, a);
  for (const a of superAdmins ?? []) adminMap.set(a.id, a);
  const admins = Array.from(adminMap.values());

  if (admins.length === 0) return;

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
 * Send an email to a specific address (for guest bookings).
 * Does NOT create a notification row — use this only for guests without accounts.
 */
export async function sendGuestEmail(params: {
  to: string;
  toName?: string;
  subject: string;
  body: string;
  link?: string;
  orgName?: string;
}): Promise<boolean> {
  return sendEmail(params);
}

// ── Internal helpers ────────────────────────────────────────

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

async function sendEmail(params: {
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
