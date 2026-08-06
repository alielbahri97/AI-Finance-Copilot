import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client.
 *
 * Passkeys are experimental in supabase-js: the opt-in flag is required or
 * `signInWithPasskey` / `registerPasskey` throw. Server-side GoTrue must also
 * have Passkeys enabled in the dashboard (see DEPLOYMENT.md).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        experimental: { passkey: true },
      },
    }
  );
}
