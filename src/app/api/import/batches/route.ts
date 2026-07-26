import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";

export async function GET() {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const batches = await prisma.importBatch.findMany({
      where: { userId: user.id },
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
    console.error("GET /api/import/batches failed:", error);
    return NextResponse.json({ error: "Failed to load imports" }, { status: 500 });
  }
}
