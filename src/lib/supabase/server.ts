import { cache } from "react";

import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";

import { BearerAuthError, userFromAccessToken } from "@/lib/auth/bearer";
import { extractBearerToken } from "@/lib/auth/token";
import { logger } from "@/lib/logger";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component where cookies are read-only.
            // Safe to ignore because middleware refreshes the session.
          }
        },
      },
    }
  );
}

/**
 * Returns the user of the cookie session, or null.
 *
 * Wrapped in React cache() so the layout, page and nested server components
 * of a single request share one auth-server round trip instead of each
 * paying ~50-150ms for their own getUser() call.
 */
export const getCookieUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Returns the authenticated user for this request, or null, by whichever of
 * the two schemes it used: a Bearer access token, or the cookie session.
 *
 * The Bearer branch is here rather than only in the workspace guard because a
 * dozen user-scoped routes — the notification feed, push subscriptions, the
 * profile, onboarding, the product tour — authenticate through this function
 * alone and never resolve a workspace. Their data is genuinely per-user, so
 * that is the right guard; but while it read cookies only, every one of them
 * answered 401 to a native client, and the Android app needs most of them.
 *
 * Web is unaffected: a browser request carries no Authorization header and
 * takes exactly the path it always did.
 */
export const getUser = cache(async (): Promise<User | null> => {
  const token = extractBearerToken(await ambientAuthorizationHeader());
  if (!token) return getCookieUser();

  try {
    return await userFromAccessToken(token);
  } catch (error) {
    if (error instanceof BearerAuthError) {
      logger.warn("bearer_token_rejected", { code: error.code });
      return null;
    }
    logger.error("bearer_token_verification_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
});

/**
 * The Authorization header of the request being served, when there is one to
 * read. `headers()` throws outside a request scope, which is what a unit test
 * and any build-time evaluation look like.
 */
async function ambientAuthorizationHeader(): Promise<string | null> {
  try {
    return (await headers()).get("authorization");
  } catch {
    return null;
  }
}
