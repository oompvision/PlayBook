"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function enterAsAdmin(orgId: string) {
  const auth = await getAuthUser();
  if (!auth) {
    redirect("/auth/login");
  }

  // Authorization: super_admin can enter any org; admin only their own
  if (
    auth.profile.role !== "super_admin" &&
    !(auth.profile.role === "admin" && auth.profile.org_id === orgId)
  ) {
    redirect("/");
  }

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("slug")
    .eq("id", orgId)
    .single();

  if (!org) {
    redirect("/super-admin/orgs");
  }

  // Set the admin org cookie — cookies() works reliably in Server Actions
  const cookieStore = await cookies();
  cookieStore.set("playbook-admin-org", org.slug, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 8, // 8 hours
  });

  redirect("/admin");
}
