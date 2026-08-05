import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import { findAssetInWorkspace, toValuationRow } from "@/lib/personal/net-worth-data";
import { prisma } from "@/lib/prisma";

import { requireNetWorthAccess } from "../../guard";
import { endOfUtcDay, valuationCreateSchema } from "../../schemas";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Appends a valuation. There is deliberately no PATCH and no DELETE on this
 * collection: the history is what draws the net-worth line, and rewriting it
 * would quietly change the past. A correction is a newer row on the same date,
 * which the "latest wins" rule then prefers.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireNetWorthAccess("edit_transactions");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const { id } = await context.params;
    const asset = await findAssetInWorkspace(workspace.id, id);
    if (!asset) {
      return NextResponse.json({ error: "Holding not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = valuationCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid valuation", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const values = parsed.data;

    // A figure dated in the future would move today's net worth on money that
    // has not changed hands, and the history would carry it forward.
    if (values.asOf > endOfUtcDay()) {
      return NextResponse.json({ error: "Date cannot be in the future" }, { status: 400 });
    }

    const valuation = await prisma.assetValuation.create({
      data: { assetId: id, value: values.value, asOf: values.asOf },
    });

    return NextResponse.json({ valuation: toValuationRow(valuation) }, { status: 201 });
  } catch (error) {
    return apiError(
      "POST /api/net-worth/[id]/valuations",
      "Failed to record the valuation",
      error
    );
  }
}
