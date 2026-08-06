import { Suspense } from "react";

import { DataExportMenu, type DataExportOption } from "@/components/exports/data-export-menu";
import { getEntitlements } from "@/lib/billing/entitlements";

const FILTER_KEYS = ["q", "type", "category", "batch", "from", "to", "min", "max"];

const OPTIONS: DataExportOption[] = [
  { format: "csv", label: "CSV (current filters)" },
  { format: "excel", label: "Excel (current filters)", paid: true },
];

export async function TransactionsExportButton({ workspaceId }: { workspaceId: string }) {
  const entitlements = await getEntitlements(workspaceId);
  return (
    <Suspense fallback={null}>
      <DataExportMenu
        href="/api/exports/transactions"
        options={OPTIONS}
        paidLocked={!entitlements.plan.limits.exportsEnabled}
        forwardSearchParams={FILTER_KEYS}
      />
    </Suspense>
  );
}
