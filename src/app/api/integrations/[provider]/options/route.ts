import { NextResponse } from "next/server";
import { z } from "zod";

import { getConnection, patchMetadata } from "@/lib/integrations/connections";
import { requireIntegrationAccess } from "@/lib/integrations/guard";
import { getProvider } from "@/lib/integrations/registry";

const optionsSchema = z
  .object({
    calendarEnabled: z.boolean().optional(),
  })
  .strict();

/** Per-provider options, e.g. the Google Calendar event-creation toggle. */
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

    const connection = await getConnection(access.user.id, provider.id);
    if (!connection) {
      return NextResponse.json({ error: "Not connected" }, { status: 404 });
    }

    await patchMetadata(connection.id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`PATCH /api/integrations/${providerId}/options failed:`, error);
    return NextResponse.json({ error: "Failed to update options" }, { status: 500 });
  }
}
