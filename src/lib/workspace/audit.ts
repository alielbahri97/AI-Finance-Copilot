import "server-only";

import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

/**
 * Audit-log actions. String union (not an enum) so new actions don't need a
 * migration; the table stores plain text.
 */
export type AuditAction =
  | "member.invited"
  | "member.invitation_revoked"
  | "member.invitation_regenerated"
  | "member.joined"
  | "member.removed"
  | "member.left"
  | "member.role_changed"
  | "member.permissions_changed"
  | "workspace.created"
  | "workspace.renamed"
  | "billing.checkout_started"
  | "billing.portal_opened"
  | "billing.plan_changed"
  | "data.export"
  | "data.transactions_deleted"
  | "data.import_undone"
  | "data.invoice_deleted"
  | "integration.connected"
  | "integration.disconnected";

/**
 * Records a security-relevant event. Never throws — an audit failure must not
 * break the action being audited (it is logged for ops instead).
 */
export async function recordAudit(
  workspaceId: string,
  userId: string | null,
  action: AuditAction,
  detail?: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        workspaceId,
        userId,
        action,
        detail: detail ? (detail as object) : undefined,
      },
    });
  } catch (error) {
    logger.error("[audit] failed to record event", {
      workspaceId,
      action,
      error: serializeError(error),
    });
  }
}
