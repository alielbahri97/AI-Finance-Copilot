import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api/response";
import { enforceRateLimit } from "@/lib/api/rate-limit-guard";
import { requireIntegrationAccess } from "@/lib/integrations/guard";
import { listInstitutions } from "@/lib/integrations/providers/gocardless";
import { getProvider, isProviderConfigured } from "@/lib/integrations/registry";

const querySchema = z.object({
  country: z
    .string()
    .length(2)
    .regex(/^[a-zA-Z]{2}$/, "country must be a two-letter ISO code"),
});

/** Banks available in a country, for the GoCardless connect picker. */
export async function GET(request: NextRequest) {
  try {
    const access = await requireIntegrationAccess();
    if (!access.ok) return access.response;

    const limited = await enforceRateLimit("sync", access.user.id);
    if (limited) return limited;

    const provider = getProvider("gocardless");
    if (!provider || !isProviderConfigured(provider)) {
      return NextResponse.json(
        { error: "GoCardless is not configured on this server." },
        { status: 503 }
      );
    }

    const parsed = querySchema.safeParse({
      country: request.nextUrl.searchParams.get("country") ?? "",
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Pass ?country=XX (two-letter ISO code)." },
        { status: 400 }
      );
    }

    const institutions = await listInstitutions(parsed.data.country);
    return NextResponse.json(
      { institutions },
      // The bank list changes rarely; let the browser cache per-user for an hour.
      { headers: { "Cache-Control": "private, max-age=3600" } }
    );
  } catch (error) {
    return apiError(
      "GET /api/integrations/gocardless/institutions",
      "Could not load the bank list",
      error
    );
  }
}
