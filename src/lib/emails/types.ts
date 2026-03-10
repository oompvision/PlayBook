export type OrgBranding = {
  name: string;
  slug: string;
  logoUrl: string | null;
  brandColor: string;
  emailFromName: string | null;
};

export type AuthEmailType = "signup" | "magiclink" | "recovery" | "email_change";
