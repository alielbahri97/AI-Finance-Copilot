import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api/response";
import { requireWorkspace } from "@/lib/workspace/context";

export async function GET() {
  try {
    const auth = await requireWorkspace("view_transactions");
    if (!auth.ok) return auth.response;
    const { workspace } = auth.ctx;

    const batches = await prisma.importBatch.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { transactions: true } } },
    });

    return NextResponse.json({
      batches: batches.map((batch) => ({
        id: batch.id,
        fileName: batch.fileName,
        createdAt: batch.createdAt.toISOString(),
        transactionCount: batch._count.transactions,
      })),
    });
  } catch (error) {
    return apiError("GET /api/import/batches", "Failed to load imports", error);
  }
}
