import type { OrgBranding } from "../types";
import { emailLayout } from "../layout";

export function confirmSignupEmail(
  org: OrgBranding | null,
  confirmUrl: string,
): { subject: string; html: string } {
  const orgName = org?.name || "EZBooker";
  const brandColor = org?.brandColor || "#18181b";
  const subject = `Confirm your ${orgName} account`;

  const bodyHtml = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#18181b;">Confirm your email</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#3f3f46;line-height:1.6;">
      Thanks for signing up with <strong>${orgName}</strong>! Click the button below to confirm your email address and activate your account.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding:8px 0 24px;">
          <a href="${confirmUrl}" style="display:inline-block;padding:12px 32px;background-color:${brandColor};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;border-radius:8px;">
            Confirm Email Address
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#71717a;line-height:1.5;">
      If you didn't create an account, you can safely ignore this email.
    </p>
  `;

  return { subject, html: emailLayout(org, subject, bodyHtml) };
}
