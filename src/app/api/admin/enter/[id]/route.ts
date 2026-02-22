import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
  const response = NextResponse.redirect(new URL("/admin", request.url));
  response.cookies.set("playbook-admin-org", org.slug, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 8, // 8 hours
  });

  return response;
}
