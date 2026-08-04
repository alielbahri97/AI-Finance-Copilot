import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/transactions",
  "/import",
  "/categories",
  "/invoices",
  "/forecast",
  "/reports",
  "/copilot",
  "/integrations",
  "/billing",
  "/admin",
  "/profile",
  "/settings",
  "/onboarding",
];
const AUTH_ROUTES = ["/login", "/signup", "/forgot-password"];

/**
 * Auth-server timeout. On a paid Supabase project (no cold pauses) responses
 * are fast, so fail fast at 5s instead of dragging a bad request toward
 * Vercel's ~25s middleware limit. Tune with SUPABASE_AUTH_TIMEOUT_MS if your
 * auth region is far from the Vercel function region.
 */
const SUPABASE_FETCH_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.SUPABASE_AUTH_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 5_000;
})();

function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUPABASE_FETCH_TIMEOUT_MS);

  const upstream = init?.signal;
  if (upstream) {
    if (upstream.aborted) {
      controller.abort(upstream.reason);
    } else {
      upstream.addEventListener("abort", () => controller.abort(upstream.reason), {
        once: true,
      });
    }
  }

  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timeoutId)
  );
}

function redirectToLogin(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

function isTransientAuthFailure(error: { name?: string; status?: number } | null) {
  if (!error) return false;
  return error.name === "AuthRetryableFetchError" || error.status === 0;
}

/** True when the request carries a Supabase auth session cookie. */
function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("-auth-token"));
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return supabaseResponse;
  }

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const isAuthRoute = AUTH_ROUTES.some((route) => pathname.startsWith(route));

  // Fast path: no session cookie means there is nothing to refresh and no
  // user to resolve — skip building the Supabase client entirely. This keeps
  // anonymous traffic (landing page, crawlers, auth pages) at ~0ms overhead.
  if (!hasAuthCookie(request)) {
    if (isProtected) {
      return redirectToLogin(request, pathname);
    }
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
    global: {
      fetch: fetchWithTimeout,
    },
  });

  // IMPORTANT: do not add logic between createServerClient and getUser();
  // it can cause hard-to-debug session refresh issues.
  let user = null;
  try {
    // Outer race covers lock/init hangs that bypass fetch abort.
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("supabase_auth_timeout")),
          SUPABASE_FETCH_TIMEOUT_MS + 1_000
        );
      }),
    ]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
    if (isTransientAuthFailure(result.error)) {
      // Fail fast instead of MIDDLEWARE_INVOCATION_TIMEOUT (~25s).
      if (isProtected) {
        return redirectToLogin(request, pathname);
      }
      return supabaseResponse;
    }
    user = result.data.user;
  } catch {
    if (isProtected) {
      return redirectToLogin(request, pathname);
    }
    return supabaseResponse;
  }

  if (!user && isProtected) {
    return redirectToLogin(request, pathname);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
