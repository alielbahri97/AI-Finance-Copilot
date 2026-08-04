import { NextResponse } from "next/server";
import { z } from "zod";

import { saveConnection } from "@/lib/integrations/connections";
import { requireIntegrationAccess } from "@/lib/integrations/guard";
import { sendTeamsMessage, validateTeamsWebhookUrl } from "@/lib/integrations/providers/teams";
import { getProvider } from "@/lib/integrations/registry";
import { apiError } from "@/lib/api/response";

const webhookSchema = z.object({
  url: z.string().min(12).max(2000),
});

/**
 * Connect flow for webhook-based providers (Microsoft Teams): the user
 * pastes an incoming webhook URL, we verify it with a test post and store
 * it encrypted.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerId } = await params;

  try {
    const access = await requireIntegrationAccess();
    if (!access.ok) return access.response;

    const provider = getProvider(providerId);
    if (!provider || provider.flow !== "webhook") {
      return NextResponse.json(
        { error: "This provider does not use a webhook URL" },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = webhookSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a webhook URL" }, { status: 400 });
    }

    const validationError = validateTeamsWebhookUrl(parsed.data.url);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    try {
      await sendTeamsMessage(parsed.data.url, {
        title: "FinPilot connected",
        body: "Finance alerts and digests will be posted to this channel.",
      });
    } catch {
      return NextResponse.json(
        { error: "The webhook rejected a test message. Check the URL and try again." },
        { status: 400 }
      );
    }

    await saveConnection(
      { workspaceId: access.ctx.workspace.id, userId: access.ctx.user.id },
      provider.id,
      {
        accessToken: parsed.data.url,
        metadata: { verifiedAt: new Date().toISOString() },
      }
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(`POST /api/integrations/${providerId}/webhook`, "Failed to save the webhook", error);
  }
}
