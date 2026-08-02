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

/** Stay well under Vercel's ~25s middleware invocation limit. */
const SUPABASE_FETCH_TIMEOUT_MS = 8_000;

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
