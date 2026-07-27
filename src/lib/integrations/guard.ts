import "server-only";

import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";

import { getEntitlements, upgradeError } from "@/lib/billing/entitlements";
import { getUser } from "@/lib/supabase/server";

import { isEncryptionConfigured } from "./crypto";

/**
 * Common gate for integration API routes: authenticated + Business-plan
 * entitlement + the shared token-encryption key present.
 */
export async function requireIntegrationAccess(): Promise<
  { ok: true; user: User } | { ok: false; response: NextResponse }
> {
  const user = await getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const entitlements = await getEntitlements(user.id);
  if (!entitlements.plan.limits.integrationsEnabled) {
    return {
      ok: false,
      response: NextResponse.json(upgradeError("Integrations", entitlements.planId), {
        status: 402,
      }),
    };
  }

  if (!isEncryptionConfigured()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Integrations are not configured (INTEGRATION_ENCRYPTION_KEY missing)" },
        { status: 503 }
      ),
    };
  }

  return { ok: true, user };
}
