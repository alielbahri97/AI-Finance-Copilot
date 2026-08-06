import { prisma } from "@/lib/prisma";

import { csvLines } from "./csv";

const MAX_ENTRIES = 5_000;

export async function buildAuditLogCsv(workspaceId: string): Promise<string> {
  const entries = await prisma.auditLog.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: MAX_ENTRIES,
    include: { profile: { select: { email: true, fullName: true } } },
  });

  return csvLines([
    ["When", "Actor email", "Actor name", "Action", "Detail"],
    ...entries.map((entry) => [
      entry.createdAt.toISOString(),
      entry.profile?.email ?? "",
      entry.profile?.fullName ?? "",
      entry.action,
      entry.detail ? JSON.stringify(entry.detail) : "",
    ]),
  ]);
}
