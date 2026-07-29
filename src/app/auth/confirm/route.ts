import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getAppOrigin } from "@/lib/supabase/redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Handles token-hash style confirmation links (used by some Supabase email
 * templates) as an alternative to the PKCE `code` flow.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/dashboard";
  const safeNext = next.startsWith("/") ? next : "/dashboard";
  const origin = getAppOrigin();

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=confirmation_failed`);
}
