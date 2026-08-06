import { Suspense } from "react";

import { DataExportMenu, type DataExportOption } from "@/components/exports/data-export-menu";
import { getEntitlements } from "@/lib/billing/entitlements";

const OPTIONS: DataExportOption[] = [
  { format: "csv", label: "CSV" },
  { format: "excel", label: "Excel", paid: true },
  { format: "pdf", label: "PDF summary", paid: true },
];

export async function ForecastExportButton({ workspaceId }: { workspaceId: string }) {
  const entitlements = await getEntitlements(workspaceId);
  return (
    <Suspense fallback={null}>
      <DataExportMenu
        href="/api/exports/forecast"
        options={OPTIONS}
        paidLocked={!entitlements.plan.limits.exportsEnabled}
      />
    </Suspense>
  );
}
