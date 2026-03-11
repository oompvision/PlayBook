import type { OrgBranding } from "../types";
import { emailLayout } from "../layout";

// ── Shared helpers ───────────────────────────────────────

type BookingData = {
  bayName?: string;
  dateStr?: string;
  timeStr?: string;
  confirmationCode?: string;
  totalPrice?: string;
  notes?: string;
  customerName?: string;
};

function extractBookingData(metadata?: Record<string, unknown>): BookingData {
  return {
    bayName: (metadata?.bay ?? metadata?.bayName) as string | undefined,
    dateStr: metadata?.dateStr as string | undefined,
    timeStr: metadata?.timeStr as string | undefined,
    confirmationCode: metadata?.confirmation_code as string | undefined,
    totalPrice: metadata?.totalPrice as string | undefined,
    notes: metadata?.notes as string | undefined,
    customerName: metadata?.customerName as string | undefined,
  };
}

const BTN_STYLE =
  "display:inline-block;padding:12px 32px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;border-radius:8px;";

function ctaButton(
  label: string,
  href: string,
  color: string,
): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:8px 0 0;">
        <a href="${href}" style="${BTN_STYLE}background-color:${color};">${label}</a>
      </td></tr>
    </table>`;
}

function detailRow(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:130px;">${label}</td>
      <td style="padding:8px 12px;font-size:14px;color:#18181b;border-bottom:1px solid #f4f4f5;font-weight:500;">${value}</td>
    </tr>`;
}

function bookingTable(data: BookingData): string {
  const rows: string[] = [];
  if (data.confirmationCode) rows.push(detailRow("Confirmation", data.confirmationCode));
  if (data.bayName) rows.push(detailRow("Facility", data.bayName));
  if (data.dateStr) rows.push(detailRow("Date", data.dateStr));
  if (data.timeStr) rows.push(detailRow("Time", data.timeStr));
  if (data.totalPrice) rows.push(detailRow("Total", data.totalPrice));
  if (data.notes) rows.push(detailRow("Notes", data.notes));

  if (rows.length === 0) return "";

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:16px 0 24px;">
      ${rows.join("")}
    </table>`;
}

// ── Templates ────────────────────────────────────────────

export function bookingConfirmedEmail(
  org: OrgBranding | null,
  data: BookingData,
  siteUrl: string,
): { subject: string; html: string } {
  const orgName = org?.name || "EZBooker";
  const brandColor = org?.brandColor || "#18181b";
  const subject = `Booking Confirmed — ${orgName}`;

  const codeLink = data.confirmationCode
    ? `${siteUrl}/my-bookings?booking=${data.confirmationCode}`
    : `${siteUrl}/my-bookings`;

  const bodyHtml = `
    <h2 style="margin:0 0 8px;font-size:20px;color:#18181b;">Booking Confirmed</h2>
    <p style="margin:0 0 4px;font-size:15px;color:#3f3f46;line-height:1.6;">
      Your booking at <strong>${orgName}</strong> has been confirmed.
    </p>
    ${bookingTable(data)}
    ${ctaButton("View My Bookings", codeLink, brandColor)}
    <p style="margin:24px 0 0;font-size:13px;color:#a1a1aa;line-height:1.5;">
      Need to make changes? You can modify or cancel your booking from the My Bookings page.
    </p>
  `;

  return { subject, html: emailLayout(org, subject, bodyHtml) };
}

export function bookingCanceledEmail(
  org: OrgBranding | null,
  data: BookingData,
  siteUrl: string,
): { subject: string; html: string } {
  const orgName = org?.name || "EZBooker";
  const subject = `Booking Cancelled — ${orgName}`;

  const bodyHtml = `
    <h2 style="margin:0 0 8px;font-size:20px;color:#18181b;">Booking Cancelled</h2>
    <p style="margin:0 0 4px;font-size:15px;color:#3f3f46;line-height:1.6;">
      Your booking at <strong>${orgName}</strong> has been cancelled.
    </p>
    ${bookingTable(data)}
    <p style="margin:0;font-size:14px;color:#3f3f46;line-height:1.6;">
      Want to rebook? Visit the ${orgName} booking page to find available times.
    </p>
    ${ctaButton("Book Again", siteUrl, org?.brandColor || "#18181b")}
  `;

  return { subject, html: emailLayout(org, subject, bodyHtml) };
}

export function bookingModifiedEmail(
  org: OrgBranding | null,
  oldData: BookingData,
  newData: BookingData,
  siteUrl: string,
): { subject: string; html: string } {
  const orgName = org?.name || "EZBooker";
  const brandColor = org?.brandColor || "#18181b";
  const subject = `Booking Modified — ${orgName}`;

  const codeLink = newData.confirmationCode
    ? `${siteUrl}/my-bookings?booking=${newData.confirmationCode}`
    : `${siteUrl}/my-bookings`;

  const bodyHtml = `
    <h2 style="margin:0 0 8px;font-size:20px;color:#18181b;">Booking Modified</h2>
    <p style="margin:0 0 4px;font-size:15px;color:#3f3f46;line-height:1.6;">
      Your booking at <strong>${orgName}</strong> has been updated.
    </p>

    <p style="margin:20px 0 4px;font-size:13px;font-weight:600;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;">Updated Booking</p>
    ${bookingTable(newData)}

    ${oldData.confirmationCode ? `
      <p style="margin:8px 0 4px;font-size:13px;font-weight:600;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;">Previous Booking</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:8px 0 24px;opacity:0.6;">
        ${oldData.confirmationCode ? detailRow("Confirmation", `<s>${oldData.confirmationCode}</s>`) : ""}
        ${oldData.bayName ? detailRow("Facility", oldData.bayName) : ""}
        ${oldData.dateStr ? detailRow("Date", oldData.dateStr) : ""}
        ${oldData.timeStr ? detailRow("Time", oldData.timeStr) : ""}
      </table>
    ` : ""}

    ${ctaButton("View My Bookings", codeLink, brandColor)}
  `;

  return { subject, html: emailLayout(org, subject, bodyHtml) };
}

export function bookingReminderEmail(
  org: OrgBranding | null,
  data: BookingData & { cancelDeadline?: string },
  siteUrl: string,
): { subject: string; html: string } {
  const orgName = org?.name || "EZBooker";
  const brandColor = org?.brandColor || "#18181b";
  const subject = `Upcoming Booking Reminder — ${orgName}`;

  const codeLink = data.confirmationCode
    ? `${siteUrl}/my-bookings?booking=${data.confirmationCode}`
    : `${siteUrl}/my-bookings`;

  const bodyHtml = `
    <h2 style="margin:0 0 8px;font-size:20px;color:#18181b;">Upcoming Booking</h2>
    <p style="margin:0 0 4px;font-size:15px;color:#3f3f46;line-height:1.6;">
      Just a reminder — your booking at <strong>${orgName}</strong> is coming up soon.
    </p>
    ${bookingTable(data)}
    ${data.cancelDeadline ? `
      <p style="margin:0 0 16px;font-size:13px;color:#71717a;line-height:1.5;">
        Free cancellation available until <strong>${data.cancelDeadline}</strong>.
      </p>
    ` : ""}
    ${ctaButton("View Booking", codeLink, brandColor)}
  `;

  return { subject, html: emailLayout(org, subject, bodyHtml) };
}

export function cancellationWindowClosedEmail(
  org: OrgBranding | null,
  data: BookingData,
  siteUrl: string,
): { subject: string; html: string } {
  const orgName = org?.name || "EZBooker";
  const subject = `Cancellation Window Closed — ${orgName}`;

  const codeLink = data.confirmationCode
    ? `${siteUrl}/my-bookings?booking=${data.confirmationCode}`
    : `${siteUrl}/my-bookings`;

  const bodyHtml = `
    <h2 style="margin:0 0 8px;font-size:20px;color:#18181b;">Cancellation Window Closed</h2>
    <p style="margin:0 0 4px;font-size:15px;color:#3f3f46;line-height:1.6;">
      The free cancellation window for your booking at <strong>${orgName}</strong> has closed.
    </p>
    ${bookingTable(data)}
    ${ctaButton("View Booking", codeLink, org?.brandColor || "#18181b")}
  `;

  return { subject, html: emailLayout(org, subject, bodyHtml) };
}

export function welcomeEmail(
  org: OrgBranding | null,
  customerName: string | undefined,
  siteUrl: string,
): { subject: string; html: string } {
  const orgName = org?.name || "EZBooker";
  const brandColor = org?.brandColor || "#18181b";
  const greeting = customerName ? `Hi ${customerName},` : "Hi there,";
  const subject = `Welcome to ${orgName}!`;

  const bodyHtml = `
    <h2 style="margin:0 0 8px;font-size:20px;color:#18181b;">Welcome!</h2>
    <p style="margin:0 0 16px;font-size:15px;color:#3f3f46;line-height:1.6;">
      ${greeting}
    </p>
    <p style="margin:0 0 16px;font-size:15px;color:#3f3f46;line-height:1.6;">
      Thanks for signing up with <strong>${orgName}</strong>! You can browse available time slots,
      select your preferred times, and book instantly.
    </p>
    <p style="margin:0 0 24px;font-size:15px;color:#3f3f46;line-height:1.6;">
      View and manage your bookings from the "My Bookings" page anytime.
    </p>
    ${ctaButton("Book Now", siteUrl, brandColor)}
  `;

  return { subject, html: emailLayout(org, subject, bodyHtml) };
}

export function guestBookingConfirmedEmail(
  org: OrgBranding | null,
  data: BookingData,
  claimUrl: string | null,
  siteUrl: string,
): { subject: string; html: string } {
  const orgName = org?.name || "EZBooker";
  const brandColor = org?.brandColor || "#18181b";
  const subject = `Booking Confirmed — ${orgName}`;

  const bodyHtml = `
    <h2 style="margin:0 0 8px;font-size:20px;color:#18181b;">Booking Confirmed</h2>
    <p style="margin:0 0 4px;font-size:15px;color:#3f3f46;line-height:1.6;">
      Your booking at <strong>${orgName}</strong> has been confirmed.
    </p>
    ${bookingTable(data)}
    ${claimUrl ? `
      <p style="margin:0 0 16px;font-size:14px;color:#3f3f46;line-height:1.6;">
        Sign up to manage your booking online:
      </p>
      ${ctaButton("Create Account", claimUrl, brandColor)}
    ` : `
      <p style="margin:0 0 16px;font-size:14px;color:#3f3f46;line-height:1.6;">
        Create an EZBooker account to manage your bookings online.
      </p>
      ${ctaButton("Sign Up", `${siteUrl}/auth/signup`, brandColor)}
    `}
  `;

  return { subject, html: emailLayout(org, subject, bodyHtml) };
}

// ── Dispatcher ───────────────────────────────────────────

/**
 * Render an HTML email for a notification type.
 * Returns null if the type doesn't have a template (falls back to plain text).
 */
export function renderNotificationEmail(
  type: string,
  org: OrgBranding | null,
  params: {
    message: string;
    metadata?: Record<string, unknown>;
    recipientName?: string;
    siteUrl: string;
  },
): { subject: string; html: string } | null {
  const data = extractBookingData(params.metadata);

  switch (type) {
    case "booking_confirmed":
      return bookingConfirmedEmail(org, data, params.siteUrl);

    case "booking_canceled":
      return bookingCanceledEmail(org, data, params.siteUrl);

    case "booking_modified": {
      const oldData: BookingData = {
        confirmationCode: params.metadata?.old_confirmation_code as string | undefined,
        bayName: params.metadata?.old_bay as string | undefined,
        dateStr: params.metadata?.old_dateStr as string | undefined,
        timeStr: params.metadata?.old_timeStr as string | undefined,
      };
      return bookingModifiedEmail(org, oldData, data, params.siteUrl);
    }

    case "booking_reminder_48hr": {
      const reminderData = {
        ...data,
        cancelDeadline: params.metadata?.cancelDeadline as string | undefined,
      };
      return bookingReminderEmail(org, reminderData, params.siteUrl);
    }

    case "cancellation_window_closed":
      return cancellationWindowClosedEmail(org, data, params.siteUrl);

    case "welcome":
      return welcomeEmail(org, params.recipientName, params.siteUrl);

    default:
      return null; // No template — will fall back to plain text
  }
}
