import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

/** Undo an import: deleting the batch cascades to its transactions. */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const batch = await prisma.importBatch.findFirst({
      where: { id, userId: user.id },
      include: { _count: { select: { transactions: true } } },
    });
    if (!batch) {
      return NextResponse.json({ error: "Import not found" }, { status: 404 });
    }

    await prisma.importBatch.delete({ where: { id } });

    return NextResponse.json({ success: true, removedTransactions: batch._count.transactions });
  } catch (error) {
    console.error("DELETE /api/import/batches/[id] failed:", error);
    return NextResponse.json({ error: "Failed to undo import" }, { status: 500 });
  }
}
