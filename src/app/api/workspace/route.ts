import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/workspace/audit";
import { requireWorkspace } from "@/lib/workspace/context";

const renameSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
});

/** Renames the current workspace. */
export async function PATCH(request: Request) {
  const auth = await requireWorkspace("manage_settings");
  if (!auth.ok) return auth.response;
  const { user, workspace } = auth.ctx;

  const parsed = renameSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const previous = workspace.name;
  const updated = await prisma.workspace.update({
    where: { id: workspace.id },
    data: { name: parsed.data.name },
    select: { id: true, name: true },
  });
  await recordAudit(workspace.id, user.id, "workspace.renamed", {
    from: previous,
    to: updated.name,
  });

  return NextResponse.json({ workspace: updated });
}
