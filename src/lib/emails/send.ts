import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = "noreply@updates.ezbooker.app";

/**
 * Send an email via Resend.
 * @param fromName - Display name for the "From" field (e.g., "Pickle & Par via EZBooker")
 */
export async function sendEmail(params: {
  to: string;
  fromName: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  if (!resend) {
    console.warn("[emails] Resend not configured (RESEND_API_KEY missing), skipping email");
    return false;
  }

  try {
    await resend.emails.send({
      from: `${params.fromName} <${FROM_EMAIL}>`,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });
    return true;
  } catch (err) {
    console.error("[emails] Failed to send email:", err);
    return false;
  }
}
