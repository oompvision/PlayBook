import { getFacilitySlug } from "@/lib/facility";
import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { ChatBubble } from "./chat-bubble";

/**
 * Server component that conditionally renders the floating chat bubble.
 * Only shows on facility-scoped customer pages (not admin, super-admin, or homepage).
 */
export async function ChatBubbleLoader() {
  const slug = await getFacilitySlug();
  if (!slug) return null;

  // Don't show on admin or super-admin pages
  const headerStore = await headers();
  const url = headerStore.get("x-url") || headerStore.get("referer") || "";
  const pathname = url ? new URL(url, "http://localhost").pathname : "";

  // We can't reliably get the pathname from headers in all cases,
  // so the client component will handle route-based hiding.
  // Here we only gate on facility slug existence.

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("slug", slug)
    .single();

  if (!org) return null;

  return <ChatBubble facilitySlug={slug} orgName={org.name} />;
}
