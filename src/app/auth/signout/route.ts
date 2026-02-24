import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const { origin } = new URL(request.url);
  const response = NextResponse.redirect(origin, { status: 302 });

  // Clear facility context cookies so stale sessions don't leak
  response.cookies.set("playbook-facility", "", { path: "/", maxAge: 0 });
  response.cookies.set("playbook-admin-org", "", { path: "/", maxAge: 0 });

  return response;
}
