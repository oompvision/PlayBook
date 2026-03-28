import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { rateLimit } from "@/lib/rate-limit";

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

function applySecurityHeaders(response: NextResponse): void {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );
  response.headers.set("X-DNS-Prefetch-Control", "on");
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload"
  );
}

// Rate limit config per path prefix: [maxRequests, windowMs]
const RATE_LIMITS: Record<string, [number, number]> = {
  "/api/chat":  [20, 60_000],   // 20 req/min
  "/api/lead":  [5,  60_000],   // 5 req/min
  "/auth/login": [10, 60_000],  // 10 req/min
  "/auth/signup": [5, 60_000],  // 5 req/min
};

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || "";
  const { pathname } = request.nextUrl;

  // Rate limiting for sensitive endpoints
  for (const [prefix, [limit, windowMs]] of Object.entries(RATE_LIMITS)) {
    if (pathname.startsWith(prefix)) {
      const ip = getClientIp(request);
      const result = rateLimit(`${ip}:${prefix}`, limit, windowMs);
      if (result.limited) {
        const res = NextResponse.json(
          { error: "Too many requests. Please try again later." },
          { status: 429 }
        );
        res.headers.set("Retry-After", String(Math.ceil((result.resetAt - Date.now()) / 1000)));
        applySecurityHeaders(res);
        return res;
      }
      break;
    }
  }

  // Extract facility slug from subdomain
  let facilitySlug = extractFacilitySlug(hostname);

  // Determine if running on localhost (dev mode)
  const host = hostname.split(":")[0];
  const isLocalhost = host === "localhost" || host === "127.0.0.1";

  // Fallback: check for ?facility= query param and persist via cookie
  const facilityParam = request.nextUrl.searchParams.get("facility");
  if (!facilitySlug && facilityParam) {
    facilitySlug = facilityParam;
  }

  // Fallback: check cookies — but only in appropriate contexts.
  // For /admin routes: prefer playbook-admin-org (set by Enter as Admin flow)
  // over playbook-facility (set by customer browsing) to prevent a stale
  // customer cookie from sending an admin to the wrong org's dashboard.
  // For all other routes: playbook-facility is preferred (intentional ?facility= action).
  if (!facilitySlug) {
    const isAdminRoute = pathname.startsWith("/admin") || pathname.startsWith("/api/");

    if (isAdminRoute || isLocalhost) {
      // On admin routes (or localhost), check admin org cookie first
      facilitySlug = request.cookies.get("playbook-admin-org")?.value || null;
    }

    if (!facilitySlug) {
      facilitySlug = request.cookies.get("playbook-facility")?.value || null;
    }

    // Final fallback: admin org cookie for localhost (non-admin routes)
    if (!facilitySlug && isLocalhost) {
      facilitySlug = request.cookies.get("playbook-admin-org")?.value || null;
    }
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

  // Apply security headers to all responses
  applySecurityHeaders(response);

  // Super admin routes — no facility context needed
  if (pathname.startsWith("/super-admin")) {
    return response;
  }

  // Admin routes — require facility context
  if (pathname.startsWith("/admin")) {
    if (!facilitySlug) {
      const redirect = NextResponse.redirect(new URL("/", request.url));
      applySecurityHeaders(redirect);
      return redirect;
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
