import { Suspense } from "react";

import { DataExportMenu, type DataExportOption } from "@/components/exports/data-export-menu";
import { getEntitlements } from "@/lib/billing/entitlements";

export async function DashboardExportButton({ workspaceId }: { workspaceId: string }) {
  const entitlements = await getEntitlements(workspaceId);
  const options: DataExportOption[] = [
    { format: "pdf", label: "PDF snapshot", paid: true, omitFormatParam: true },
  ];
  return (
    <Suspense fallback={null}>
      <DataExportMenu
        href="/api/exports/dashboard"
        options={options}
        paidLocked={!entitlements.plan.limits.exportsEnabled}
        label="Export"
      />
    </Suspense>
  );
}

export async function BanksExportButton() {
  const options: DataExportOption[] = [
    { format: "csv", label: "Balances CSV", omitFormatParam: true },
  ];
  return (
    <Suspense fallback={null}>
      <DataExportMenu href="/api/exports/banks" options={options} label="Export balances" />
    </Suspense>
  );
}

export async function AuditExportButton() {
  const options: DataExportOption[] = [
    { format: "csv", label: "Audit log CSV", omitFormatParam: true },
  ];
  return (
    <Suspense fallback={null}>
      <DataExportMenu href="/api/exports/audit" options={options} label="Export CSV" />
    </Suspense>
  );
}

export async function FullDataExportButton() {
  const options: DataExportOption[] = [
    { format: "zip", label: "Download everything (ZIP)", omitFormatParam: true },
  ];
  return (
    <Suspense fallback={null}>
      <DataExportMenu href="/api/exports/full" options={options} label="Full data export" />
    </Suspense>
  );
}
