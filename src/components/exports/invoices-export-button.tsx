import { Suspense } from "react";

import { DataExportMenu, type DataExportOption } from "@/components/exports/data-export-menu";
import { getEntitlements } from "@/lib/billing/entitlements";

const OPTIONS: DataExportOption[] = [
  { format: "csv", label: "CSV" },
  { format: "csv", label: "CSV with line items", params: { lines: "1" } },
  { format: "excel", label: "Excel", paid: true },
  { format: "excel", label: "Excel with line items", paid: true, params: { lines: "1" } },
];

export async function InvoicesExportButton({ workspaceId }: { workspaceId: string }) {
  const entitlements = await getEntitlements(workspaceId);
  return (
    <Suspense fallback={null}>
      <DataExportMenu
        href="/api/exports/invoices"
        options={OPTIONS}
        paidLocked={!entitlements.plan.limits.exportsEnabled}
        forwardSearchParams={["status", "vendor", "from", "to"]}
      />
    </Suspense>
  );
}
