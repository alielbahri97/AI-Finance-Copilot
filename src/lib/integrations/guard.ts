import "server-only";

import { NextResponse } from "next/server";

import { getEntitlements, upgradeError } from "@/lib/billing/entitlements";
import { requireWorkspace, type WorkspaceContext } from "@/lib/workspace/context";

import { isEncryptionConfigured } from "./crypto";

/**
 * Common gate for integration API routes: authenticated + manage_integrations
 * permission in the current workspace + Business-plan entitlement + the
 * shared token-encryption key present.
 */
export async function requireIntegrationAccess(): Promise<
  { ok: true; ctx: WorkspaceContext } | { ok: false; response: NextResponse }
> {
  const auth = await requireWorkspace("manage_integrations");
  if (!auth.ok) return auth;

  const entitlements = await getEntitlements(auth.ctx.workspace.id);
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

  return { ok: true, ctx: auth.ctx };
}
