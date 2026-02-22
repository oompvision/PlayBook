import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";

export default async function EnterOrgPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Look up the org to get its slug
  const { data: org } = await supabase
    .from("organizations")
    .select("slug, name")
    .eq("id", id)
    .single();

  if (!org) notFound();

  // Set cookie so middleware can inject the facility slug
  const cookieStore = await cookies();
  cookieStore.set("playbook-admin-org", org.slug, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 8, // 8 hours
  });

  redirect("/admin");
}
