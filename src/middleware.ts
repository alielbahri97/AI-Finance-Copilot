import { NextResponse, type NextRequest } from "next/server";

import { hasBearerAuthorization } from "@/lib/auth/token";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // A Bearer request carries its own identity. There is no cookie session to
  // refresh and no redirect to make — the route handler verifies the token
  // itself — so everything updateSession does would be pure added latency on
  // every call a native client makes.
  if (hasBearerAuthorization(request.headers)) {
    return NextResponse.next();
  }
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - static assets, images, PWA files (no auth needed)
     * - /api/health (probes must not hang on auth)
     * - /api/webhooks and /api/cron (authenticated by signature/secret, not
     *   cookies — running session refresh there is pure overhead)
     * - robots.txt / sitemap.xml (crawler traffic)
     */
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/|robots.txt|sitemap.xml|api/health|api/webhooks|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
