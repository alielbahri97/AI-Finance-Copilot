import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api/response";
import { timestamp } from "@/lib/api/wire";
import { getEntitlements, upgradeError } from "@/lib/billing/entitlements";
import { bankQuotaRefusal, checkBankConnectionQuota } from "@/lib/integrations/bank-quota";
import { isEncryptionConfigured } from "@/lib/integrations/crypto";
import { IntegrationError } from "@/lib/integrations/oauth";
import {
  createPendingConnection,
  mintConnectionReference,
} from "@/lib/integrations/pending-connections";
import { createRequisition } from "@/lib/integrations/providers/gocardless";
import {
  editionAllowsProvider,
  getProvider,
  isProviderConfigured,
} from "@/lib/integrations/registry";
import { recordAudit } from "@/lib/workspace/audit";
import { requireWorkspace } from "@/lib/workspace/context";

/**
 * Starts a GoCardless bank connection for a client that cannot follow a
 * redirect chain into a cookie jar: the consent link comes back as JSON, the
 * client opens it in a Custom Tab, and the app finishes the handshake by
 * posting the reference to /finalize.
 *
 * Deliberately not named "connect": in the App Router a static segment wins
 * over a dynamic one, so a file at gocardless/connect would silently take the
 * web UI's traffic away from [provider]/connect.
 *
 * POST rather than GET because it has a side effect — every call mints a
 * requisition (and an end-user agreement) at GoCardless.
 */

const PROVIDER_ID = "gocardless";

const bodySchema = z.object({
  institutionId: z
    .string()
    .min(1, "institutionId must be a GoCardless institution id")
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/, "institutionId must be a GoCardless institution id")
    .optional(),
});

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace(request, "manage_integrations");
    if (!auth.ok) return auth.response;
    const { user, workspace } = auth.ctx;

    // An absent body is the ordinary case: the server's default bank is used.
    const raw = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    const entitlements = await getEntitlements(workspace.id);
    if (!entitlements.plan.limits.integrationsEnabled) {
      return NextResponse.json(
        upgradeError("Integrations", entitlements.planId, entitlements.edition),
        { status: 402 }
      );
    }

    const provider = getProvider(PROVIDER_ID);
    if (!provider || !editionAllowsProvider(workspace.type, provider)) {
      return NextResponse.json(
        { error: "GoCardless is not available in this workspace." },
        { status: 404 }
      );
    }
    if (!isProviderConfigured(provider) || !isEncryptionConfigured()) {
      return NextResponse.json(
        { error: "GoCardless is not configured on this server." },
        { status: 503 }
      );
    }

    // The plan's bank allowance is checked here, before the consent link
    // exists, because a bank's own approval screen is the worst possible place
    // to learn that the plan is out of connections. saveConnection checks it
    // again at the end of the flow; this is the check that keeps the user from
    // ever reaching the bank in the first place.
    const quota = await checkBankConnectionQuota(
      workspace.id,
      entitlements.plan.limits.bankConnections
    );
    if (!quota.allowed) {
      return NextResponse.json(
        { error: bankQuotaRefusal(quota, entitlements.plan.name), code: "LIMIT_REACHED" },
        { status: 402 }
      );
    }

    const institutionId = parsed.data.institutionId ?? process.env.GOCARDLESS_INSTITUTION_ID;
    if (!institutionId) {
      return NextResponse.json(
        { error: "Pick a bank first: pass institutionId from /api/integrations/gocardless/institutions." },
        { status: 400 }
      );
    }

    const reference = mintConnectionReference(user.id);
    const { requisitionId, link } = await createRequisition(institutionId, reference);
    const pending = await createPendingConnection({
      workspaceId: workspace.id,
      userId: user.id,
      provider: provider.id,
      requisitionId,
      reference,
      institutionId,
      link,
    });
    await recordAudit(workspace.id, user.id, "integration.connect_started", {
      provider: provider.id,
      institution: institutionId,
      requisitionId,
    });

    return NextResponse.json({
      link,
      requisitionId,
      reference,
      institutionId,
      expiresAt: timestamp(pending.expiresAt),
    });
  } catch (error) {
    if (error instanceof IntegrationError) {
      // Raised by GoCardless itself (bad secrets, an IP that is not in the
      // allow-list, an unknown institution); the message is user-safe.
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return apiError(
      "POST /api/integrations/gocardless/link",
      "Could not start the bank connection",
      error
    );
  }
}
