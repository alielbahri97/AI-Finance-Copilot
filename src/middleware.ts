import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
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
