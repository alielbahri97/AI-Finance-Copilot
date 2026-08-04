import { ScrollTextIcon } from "lucide-react";

/**
 * Server-rendered audit trail for owners/admins: who did what, when.
 * Entries are recorded by recordAudit() across the app.
 */

export interface AuditEntryView {
  id: string;
  action: string;
  actor: string | null;
  detail: unknown;
  createdAt: Date;
}

const ACTION_LABELS: Record<string, string> = {
  "member.invited": "invited a member",
  "member.invitation_revoked": "revoked an invitation",
  "member.joined": "joined the workspace",
  "member.removed": "removed a member",
  "member.left": "left the workspace",
  "member.role_changed": "changed a member's role",
  "member.permissions_changed": "changed a member's permissions",
  "workspace.renamed": "renamed the workspace",
  "billing.checkout_started": "started a plan upgrade",
  "billing.portal_opened": "opened the billing portal",
  "billing.plan_changed": "changed the plan",
  "data.export": "exported data",
  "data.transactions_deleted": "deleted transactions",
  "data.import_undone": "undid an import",
  "data.invoice_deleted": "deleted an invoice",
  "integration.connected": "connected an integration",
  "integration.disconnected": "disconnected an integration",
};

function describeDetail(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const parts = Object.entries(detail as Record<string, unknown>)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .map(([key, value]) => `${key}: ${String(value)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function AuditLog({ entries }: { entries: AuditEntryView[] }) {
  if (entries.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 py-8 text-sm">
        <ScrollTextIcon className="size-6" aria-hidden />
        No activity recorded yet.
      </div>
    );
  }

  return (
    <ul className="flex max-h-80 flex-col divide-y overflow-y-auto rounded-lg border">
      {entries.map((entry) => {
        const detail = describeDetail(entry.detail);
        return (
          <li key={entry.id} className="flex flex-col gap-0.5 px-3 py-2">
            <p className="text-sm">
              <span className="font-medium">{entry.actor ?? "System"}</span>{" "}
              {ACTION_LABELS[entry.action] ?? entry.action}
            </p>
            <p className="text-muted-foreground text-xs">
              {entry.createdAt.toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
              {detail ? ` — ${detail}` : ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
