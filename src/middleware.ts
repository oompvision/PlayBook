import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Domains that should NOT be treated as facility subdomains
const RESERVED_SUBDOMAINS = ["www", "admin", "api"];
const PLATFORM_HOSTS = ["playbook.com", "localhost", "127.0.0.1"];

function extractFacilitySlug(hostname: string): string | null {
  // Remove port if present
  const host = hostname.split(":")[0];

  // Check for localhost/dev with query param fallback (handled in route)
  if (host === "localhost" || host === "127.0.0.1") {
    return null;
  }

  // Extract subdomain from hostname
  // e.g., "aceindoor.playbook.com" → "aceindoor"
  // e.g., "aceindoor.playbook-app.vercel.app" → "aceindoor"
  const parts = host.split(".");

  // Need at least 3 parts for a subdomain (slug.domain.tld)
  // or 4+ for vercel (slug.project.vercel.app)
  if (parts.length >= 3) {
    const subdomain = parts[0];

    // Skip reserved subdomains
    if (RESERVED_SUBDOMAINS.includes(subdomain)) {
      return null;
    }

    // Check if the remaining parts form a known platform host
    const remainingHost = parts.slice(1).join(".");
    const isPlatformDomain =
      PLATFORM_HOSTS.some((ph) => remainingHost.includes(ph)) ||
      remainingHost.includes("vercel.app");

    if (isPlatformDomain) {
      return subdomain;
    }
  }

  return null;
}

export async function middleware(request: NextRequest) {
  // First, handle Supabase session refresh
  const response = await updateSession(request);

  const hostname = request.headers.get("host") || "";
  const { pathname } = request.nextUrl;

  // Extract facility slug from subdomain
  let facilitySlug = extractFacilitySlug(hostname);

  // Fallback: check for ?facility= query param (for local dev)
  if (!facilitySlug) {
    facilitySlug = request.nextUrl.searchParams.get("facility");
  }

  // Fallback: check cookie (set by super admin "Enter as Admin" flow)
  if (!facilitySlug) {
    facilitySlug = request.cookies.get("playbook-admin-org")?.value || null;
  }

  // Set facility slug as a header so server components can access it
  if (facilitySlug) {
    response.headers.set("x-facility-slug", facilitySlug);
  }

  // Super admin routes — no facility context needed
  if (pathname.startsWith("/super-admin")) {
    return response;
  }

  // Admin routes — require facility context
  if (pathname.startsWith("/admin")) {
    if (!facilitySlug) {
      // No facility context — redirect to root
      return NextResponse.redirect(new URL("/", request.url));
    }
    response.headers.set("x-facility-slug", facilitySlug);
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
