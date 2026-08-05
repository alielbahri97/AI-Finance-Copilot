import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import {
  assetNameTaken,
  getNetWorthOverview,
  toAssetRecord,
} from "@/lib/personal/net-worth-data";
import { prisma } from "@/lib/prisma";

import { requireNetWorthAccess } from "./guard";
import { assetCreateSchema, endOfUtcDay, startOfUtcDay } from "./schemas";

export async function GET() {
  try {
    const auth = await requireNetWorthAccess("view_reports");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const overview = await getNetWorthOverview(workspace.id, workspace.currency);

    return NextResponse.json({
      position: overview.position,
      history: overview.history,
      trend: overview.trend,
    });
  } catch (error) {
    return apiError("GET /api/net-worth", "Failed to load net worth", error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireNetWorthAccess("edit_transactions");
    if (!auth.ok) return auth.response;
    const { user, workspace } = auth.ctx;

    const body = await request.json();
    const parsed = assetCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid holding", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const values = parsed.data;

    // A valuation dated tomorrow would move today's net worth on a figure that
    // does not exist yet, and the history series would carry it forward.
    const asOf = values.asOf ?? startOfUtcDay();
    if (asOf > endOfUtcDay()) {
      return NextResponse.json({ error: "Date cannot be in the future" }, { status: 400 });
    }

    // The unique index on (workspaceId, name) is the real guard; asking first
    // turns the collision into a clear answer instead of a 500. Names matter
    // more here than elsewhere: the same mortgage entered twice is a
    // double-counted liability.
    if (await assetNameTaken(workspace.id, values.name)) {
      return NextResponse.json(
        { error: "Something with that name is already tracked" },
        { status: 409 }
      );
    }

    const asset = await prisma.asset.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        name: values.name,
        kind: values.kind,
        currency: values.currency ?? null,
        note: values.note ?? null,
        // An opening figure is optional: a holding can be named now and valued
        // when the user has looked the number up.
        ...(values.value === undefined
          ? {}
          : { valuations: { create: { value: values.value, asOf } } }),
      },
    });

    return NextResponse.json({ asset: toAssetRecord(asset) }, { status: 201 });
  } catch (error) {
    return apiError("POST /api/net-worth", "Failed to add the holding", error);
  }
}
