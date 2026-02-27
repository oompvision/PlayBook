export const NOTIFICATION_TYPES = [
  "new_customer_signup",
  "welcome",
  "booking_confirmed",
  "booking_canceled",
  "booking_modified",
  "booking_reminder_48hr",
  "cancellation_window_closed",
  "guest_booking_created",
  "admin_daily_digest",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type RecipientType = "customer" | "org_admin";

export type CreateNotificationParams = {
  orgId: string;
  recipientId: string;
  recipientType: RecipientType;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, unknown>;
  /** If provided and email is enabled for this type, sends via Resend */
  recipientEmail?: string;
  recipientName?: string;
  orgName?: string;
};

export type NotificationRecord = {
  id: string;
  org_id: string;
  recipient_id: string;
  recipient_type: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  email_sent: boolean;
  email_sent_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/** Human-readable labels for notification types (used in settings UI) */
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  new_customer_signup: "New Customer Sign-up",
  welcome: "Welcome Message",
  booking_confirmed: "Booking Confirmed",
  booking_canceled: "Booking Cancelled",
  booking_modified: "Booking Modified",
  booking_reminder_48hr: "48-Hour Booking Reminder",
  cancellation_window_closed: "Cancellation Window Closed",
  guest_booking_created: "Guest Booking Created",
  admin_daily_digest: "Daily Digest",
};
