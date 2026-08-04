import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api/response";
import { recordAudit } from "@/lib/workspace/audit";
import { requireWorkspace } from "@/lib/workspace/context";

type RouteContext = { params: Promise<{ id: string }> };

/** Undo an import: deleting the batch cascades to its transactions. */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const auth = await requireWorkspace("edit_transactions");
    if (!auth.ok) return auth.response;
    const { user, workspace } = auth.ctx;

    const { id } = await context.params;
    const batch = await prisma.importBatch.findFirst({
      where: { id, workspaceId: workspace.id },
      include: { _count: { select: { transactions: true } } },
    });
    if (!batch) {
      return NextResponse.json({ error: "Import not found" }, { status: 404 });
    }

    await prisma.importBatch.delete({ where: { id } });
    await recordAudit(workspace.id, user.id, "data.import_undone", {
      batchId: id,
      fileName: batch.fileName,
      removedTransactions: batch._count.transactions,
    });

    return NextResponse.json({ success: true, removedTransactions: batch._count.transactions });
  } catch (error) {
    return apiError("DELETE /api/import/batches/[id]", "Failed to undo import", error);
  }
}
