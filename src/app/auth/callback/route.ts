import { NextResponse } from "next/server";
import { getAppOrigin } from "@/lib/supabase/redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Handles the PKCE code exchange for email confirmation, magic links and
 * password recovery. Supabase redirects here with a `code` query param.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
  const safeNext = next.startsWith("/") ? next : "/dashboard";
  const origin = getAppOrigin();

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
