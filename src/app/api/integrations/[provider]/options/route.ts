import { NextResponse } from "next/server";
import { z } from "zod";

import {
  accountBelongsToConnection,
  setAccountIncluded,
} from "@/lib/integrations/bank-accounts";
import { lookupRequestedConnection, patchMetadata } from "@/lib/integrations/connections";
import { requireIntegrationAccess } from "@/lib/integrations/guard";
import { getProvider } from "@/lib/integrations/registry";
import { apiError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

const optionsSchema = z
  .object({
    /** Required once a workspace has more than one connection to the provider. */
    connectionId: z.string().min(1).optional(),
    calendarEnabled: z.boolean().optional(),
    /** User label for this connection; null or empty clears it. */
    displayName: z.string().max(60).nullable().optional(),
    /** Flips one bank account in or out of the aggregated totals. */
    account: z
      .object({ id: z.string().min(1), includeInTotals: z.boolean() })
      .optional(),
  })
  .strict();

/**
 * Per-connection settings: the Google Calendar toggle, a friendly name so two
 * banks can be told apart, and the per-account includeInTotals switch.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerId } = await params;

  try {
    const access = await requireIntegrationAccess();
    if (!access.ok) return access.response;

    const provider = getProvider(providerId);
    if (!provider) {
      return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const parsed = optionsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid options", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const lookup = await lookupRequestedConnection(
      access.ctx.workspace.id,
      provider.id,
      parsed.data.connectionId
    );
    if (!lookup.ok) {
      return NextResponse.json({ error: lookup.error }, { status: lookup.status });
    }

    if (parsed.data.account) {
      // The account id arrives from the client, so confirm it belongs here
      // before touching it.
      const owned = await accountBelongsToConnection(
        parsed.data.account.id,
        lookup.connection.id
      );
      if (!owned) {
        return NextResponse.json({ error: "Account not found" }, { status: 404 });
      }
      await setAccountIncluded(parsed.data.account.id, parsed.data.account.includeInTotals);
    }

    if (parsed.data.displayName !== undefined) {
      await prisma.integrationConnection.update({
        where: { id: lookup.connection.id },
        data: { displayName: parsed.data.displayName?.trim() || null },
      });
    }

    if (parsed.data.calendarEnabled !== undefined) {
      await patchMetadata(lookup.connection.id, {
        calendarEnabled: parsed.data.calendarEnabled,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(`PATCH /api/integrations/${providerId}/options`, "Failed to update options", error);
  }
}
