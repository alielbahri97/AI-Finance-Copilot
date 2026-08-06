import { NextResponse } from "next/server";

import type { Prisma } from "@/generated/prisma/client";
import { apiError } from "@/lib/api/response";
import {
  assetNameTaken,
  findAssetInWorkspace,
  toAssetRecord,
} from "@/lib/personal/net-worth-data";
import { prisma } from "@/lib/prisma";

import { requireNetWorthAccess } from "../guard";
import { assetUpdateSchema } from "../schemas";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireNetWorthAccess("edit_transactions");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const { id } = await context.params;
    const existing = await findAssetInWorkspace(workspace.id, id);
    if (!existing) {
      return NextResponse.json({ error: "Holding not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = assetUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid holding", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const values = parsed.data;

    if (values.name && values.name.toLowerCase() !== existing.name.toLowerCase()) {
      if (await assetNameTaken(workspace.id, values.name, id)) {
        return NextResponse.json(
          { error: "Something with that name is already tracked" },
          { status: 409 }
        );
      }
    }

    const data: Prisma.AssetUncheckedUpdateManyInput = {};
    if (values.name !== undefined) data.name = values.name;
    // Changing the kind can move a holding from the asset side to the liability
    // side. That is the point — a "loan" entered as an asset by mistake is
    // fixed here — and the whole history moves with it, because which side a
    // holding falls on is derived from the kind rather than stored per row.
    if (values.kind !== undefined) data.kind = values.kind;
    if (values.currency !== undefined) data.currency = values.currency;
    if (values.note !== undefined) data.note = values.note;

    // Scoped by workspace above; updateMany keeps the write itself scoped too.
    await prisma.asset.updateMany({ where: { id, workspaceId: workspace.id }, data });

    const updated = await findAssetInWorkspace(workspace.id, id);
    if (!updated) {
      return NextResponse.json({ error: "Holding not found" }, { status: 404 });
    }

    return NextResponse.json({ asset: toAssetRecord(updated) });
  } catch (error) {
    return apiError("PATCH /api/net-worth/[id]", "Failed to update the holding", error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const auth = await requireNetWorthAccess("edit_transactions");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const { id } = await context.params;
    // Valuations cascade with the asset: the history describes that one thing
    // and means nothing without it.
    const result = await prisma.asset.deleteMany({
      where: { id, workspaceId: workspace.id },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Holding not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError("DELETE /api/net-worth/[id]", "Failed to delete the holding", error);
  }
}
