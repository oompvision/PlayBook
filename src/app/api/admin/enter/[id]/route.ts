import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Require authentication
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  // Authorization: super_admin can enter any org; admin only their own
  if (
    auth.profile.role !== "super_admin" &&
    !(auth.profile.role === "admin" && auth.profile.org_id === id)
  ) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const supabase = await createClient();

  // Look up the org to get its slug
  const { data: org } = await supabase
    .from("organizations")
    .select("slug")
    .eq("id", id)
    .single();

  if (!org) {
    return NextResponse.redirect(new URL("/super-admin/orgs", request.url));
  }

  // Set cookie and redirect to admin dashboard
  // Include ?facility= param so middleware can resolve the slug immediately,
  // even if the cookie isn't available on the redirected request yet
  const response = NextResponse.redirect(
    new URL(`/admin?facility=${encodeURIComponent(org.slug)}`, request.url)
  );
  response.cookies.set("playbook-admin-org", org.slug, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 8, // 8 hours
  });

  return response;
}
