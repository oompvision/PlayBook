import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Domains that should NOT be treated as facility subdomains
const RESERVED_SUBDOMAINS = ["www", "admin", "api"];
const PLATFORM_HOSTS = ["ezbooker.app", "playbook.com", "localhost", "127.0.0.1"];

function extractFacilitySlug(hostname: string): string | null {
  // Remove port if present
  const host = hostname.split(":")[0];

  // Check for localhost/dev with query param fallback (handled in route)
  if (host === "localhost" || host === "127.0.0.1") {
    return null;
  }

  const parts = host.split(".");

  // Custom domain: slug.playbook.com → 3 parts
  // e.g., "aceindoor.playbook.com" → "aceindoor"
  for (const ph of PLATFORM_HOSTS) {
    const phParts = ph.split(".");
    // If the trailing parts match a known platform host
    if (
      parts.length > phParts.length &&
      parts.slice(-phParts.length).join(".") === ph
    ) {
      const subdomain = parts[0];
      if (RESERVED_SUBDOMAINS.includes(subdomain)) return null;
      return subdomain;
    }
  }

  // Vercel: slug.project-name.vercel.app → 4+ parts
  // But project-name.vercel.app → 3 parts (no facility subdomain)
  if (host.endsWith(".vercel.app") && parts.length >= 4) {
    const subdomain = parts[0];
    if (RESERVED_SUBDOMAINS.includes(subdomain)) return null;
    return subdomain;
  }

  return null;
}

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || "";
  const { pathname } = request.nextUrl;

  // Extract facility slug from subdomain
  let facilitySlug = extractFacilitySlug(hostname);

  // Fallback: check for ?facility= query param and persist via cookie
  const facilityParam = request.nextUrl.searchParams.get("facility");
  if (!facilitySlug && facilityParam) {
    facilitySlug = facilityParam;
  }

  // Fallback: check playbook-facility cookie (set by ?facility= query param for dev/preview)
  if (!facilitySlug) {
    facilitySlug = request.cookies.get("playbook-facility")?.value || null;
  }

  // playbook-admin-org cookie only applies to /admin routes (Enter as Admin flow)
  if (!facilitySlug && pathname.startsWith("/admin")) {
    facilitySlug = request.cookies.get("playbook-admin-org")?.value || null;
  }

  // Pass facility slug as a REQUEST header so server components read it
  const customHeaders: Record<string, string> = {};
  if (facilitySlug) {
    customHeaders["x-facility-slug"] = facilitySlug;
  }

  // Handle Supabase session refresh + inject custom request headers
  const response = await updateSession(request, customHeaders);

  // Persist ?facility= param as a cookie so it sticks across navigations
  if (facilityParam) {
    response.cookies.set("playbook-facility", facilityParam, {
      path: "/",
      maxAge: 60 * 60 * 8, // 8 hours
      httpOnly: true,
      sameSite: "lax",
    });
  }

  // Super admin routes — no facility context needed
  if (pathname.startsWith("/super-admin")) {
    return response;
  }

  // Admin routes — require facility context
  if (pathname.startsWith("/admin")) {
    if (!facilitySlug) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return response;
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder assets
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
