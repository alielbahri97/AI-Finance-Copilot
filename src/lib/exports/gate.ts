import "server-only";

import { NextResponse } from "next/server";

import { getEntitlements, upgradeError } from "@/lib/billing/entitlements";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/workspace/audit";
import { getWorkspaceContext, type WorkspaceContext } from "@/lib/workspace/context";
import type { Permission } from "@/lib/workspace/permissions";

/**
 * Export formats and their plan rules (HANDOFF decisions):
 * - csv  — free on every plan
 * - zip  — full data portability; always free
 * - excel / pdf — paid (`exportsEnabled`)
 */
export type ExportFormat = "csv" | "excel" | "pdf" | "zip";

export interface ExportAccess {
  ctx: WorkspaceContext;
  entitlements: Awaited<ReturnType<typeof getEntitlements>>;
}

/**
 * Auth + permission + rate-limit + format-aware plan gate for export routes.
 * `requiredPermission` defaults to export_data; pass a page-specific view
 * permission when the surface has its own (e.g. view_transactions).
 */
export async function assertExportAccess(
  format: ExportFormat,
  options: {
    requiredPermissions?: Permission[];
    auditDetail?: Record<string, unknown>;
  } = {}
): Promise<{ ok: true; access: ExportAccess } | { ok: false; response: NextResponse }> {
  const ctx = await getWorkspaceContext();
  if (!ctx) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const required: Permission[] = options.requiredPermissions ?? ["export_data"];
  for (const permission of required) {
    if (!ctx.permissions.has(permission)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "You don't have permission to export data from this workspace." },
          { status: 403 }
        ),
      };
    }
  }

  const limited = await checkRateLimit(`export:${ctx.user.id}`, RATE_LIMITS.export);
  if (!limited.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Too many export requests — please wait a moment." },
        { status: 429 }
      ),
    };
  }

  const entitlements = await getEntitlements(ctx.workspace.id);
  const paidFormat = format === "excel" || format === "pdf";
  if (paidFormat && !entitlements.plan.limits.exportsEnabled) {
    return {
      ok: false,
      response: NextResponse.json(
        upgradeError("Excel and PDF exports", entitlements.planId, entitlements.edition),
        { status: 402 }
      ),
    };
  }

  await recordAudit(ctx.workspace.id, ctx.user.id, "data.export", {
    format,
    ...options.auditDetail,
  });

  return { ok: true, access: { ctx, entitlements } };
}

export function csvResponse(body: string, fileName: string): NextResponse {
  return new NextResponse(withBomBody(body), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

export function binaryResponse(
  bytes: Uint8Array | Buffer,
  contentType: string,
  fileName: string
): NextResponse {
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

function withBomBody(csv: string): string {
  return csv.startsWith("\uFEFF") ? csv : `\uFEFF${csv}`;
}
