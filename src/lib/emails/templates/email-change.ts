import type { OrgBranding } from "../types";
import { emailLayout } from "../layout";

export function emailChangeEmail(
  org: OrgBranding | null,
  confirmUrl: string,
): { subject: string; html: string } {
  const orgName = org?.name || "EZBooker";
  const brandColor = org?.brandColor || "#18181b";
  const subject = `Confirm your new email for ${orgName}`;

  const bodyHtml = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#18181b;">Confirm your new email</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#3f3f46;line-height:1.6;">
      You requested to change the email address on your <strong>${orgName}</strong> account. Click the button below to confirm.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding:8px 0 24px;">
          <a href="${confirmUrl}" style="display:inline-block;padding:12px 32px;background-color:${brandColor};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;border-radius:8px;">
            Confirm New Email
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#71717a;line-height:1.5;">
      If you didn't request this change, please contact support immediately.
    </p>
  `;

  return { subject, html: emailLayout(org, subject, bodyHtml) };
}
