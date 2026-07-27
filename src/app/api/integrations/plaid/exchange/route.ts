import { NextResponse } from "next/server";
import { z } from "zod";

import { saveConnection } from "@/lib/integrations/connections";
import { requireIntegrationAccess } from "@/lib/integrations/guard";
import { exchangePlaidPublicToken } from "@/lib/integrations/providers/plaid";

const exchangeSchema = z.object({
  publicToken: z.string().min(10).max(500),
  institution: z.string().max(200).optional(),
});

/** Exchanges the public token from Plaid Link for a permanent access token. */
export async function POST(request: Request) {
  try {
    const access = await requireIntegrationAccess();
    if (!access.ok) return access.response;

    const body = await request.json().catch(() => null);
    const parsed = exchangeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { accessToken, itemId } = await exchangePlaidPublicToken(parsed.data.publicToken);
    await saveConnection(access.user.id, "plaid", {
      accessToken,
      metadata: { itemId, institution: parsed.data.institution ?? null },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/integrations/plaid/exchange failed:", error);
    return NextResponse.json({ error: "Could not complete the connection" }, { status: 502 });
  }
}
