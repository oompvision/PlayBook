import type { OrgBranding } from "./types";

const DEFAULT_BRAND_COLOR = "#18181b";

/**
 * Shared email layout wrapper. Returns a full HTML document with org branding.
 */
export function emailLayout(
  org: OrgBranding | null,
  subject: string,
  bodyHtml: string,
): string {
  const brandColor = org?.brandColor || DEFAULT_BRAND_COLOR;
  const orgName = org?.name || "EZBooker";
  const logoUrl = org?.logoUrl || null;

  const logoBlock = logoUrl
    ? `<img src="${logoUrl}" alt="${orgName}" style="max-height:48px;max-width:200px;" />`
    : `<span style="font-size:22px;font-weight:700;color:#ffffff;">${orgName}</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background-color:${brandColor};padding:28px 32px;text-align:center;">
              ${logoBlock}
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${bodyHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e4e4e7;text-align:center;">
              <p style="margin:0;font-size:12px;color:#a1a1aa;">
                Sent by ${orgName} via EZBooker
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
