import { DatabaseZapIcon, HardDriveUploadIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ReportIssueButton } from "@/components/report-issue/report-issue-button";

/**
 * Why the dashboard has no data:
 * - "unreachable": Postgres is down (pooler outage, cold-start storm,
 *   misconfigured DATABASE_URL). Transient — retrying helps.
 * - "schema-outdated": the database answered, but a deploy shipped ahead of
 *   its migration. Retrying never helps; the migrations must be applied.
 */
export type DatabaseUnavailableReason = "unreachable" | "schema-outdated";

/**
 * Shown when dashboard routes cannot read their data. Auth still works, so we
 * greet the signed-in user and say which of the two failures it is.
 */
export function DatabaseUnavailable({
  email,
  reason = "unreachable",
}: {
  email?: string | null;
  reason?: DatabaseUnavailableReason;
}) {
  const outdated = reason === "schema-outdated";

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-full">
        {outdated ? (
          <HardDriveUploadIcon className="size-7" />
        ) : (
          <DatabaseZapIcon className="size-7" />
        )}
      </div>
      <h1 className="text-2xl font-semibold">
        {outdated ? "FinPilot is mid-update" : "FinPilot is temporarily unavailable"}
      </h1>
      {outdated ? (
        <p className="text-muted-foreground max-w-md text-sm">
          The database schema is out of date — the latest release needs migrations that
          haven&apos;t been applied yet
          {email ? ` (signed in as ${email})` : ""}. Your data is safe and untouched. If you
          run this deployment, apply the pending migrations with{" "}
          <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">npm run db:apply</code>{" "}
          — <Link href="/api/health" className="underline">/api/health</Link> lists exactly
          what is missing.
        </p>
      ) : (
        <p className="text-muted-foreground max-w-md text-sm">
          We can&apos;t reach the database right now
          {email ? ` (signed in as ${email})` : ""}. Your account is fine — try again
          in a minute. If this keeps happening, report an issue.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <Link href="/dashboard">Try again</Link>
        </Button>
        <ReportIssueButton
          variant="inline"
          errorMessage={
            outdated ? "Database schema out of date (pending migrations)" : "Database temporarily unavailable"
          }
        />
      </div>
    </div>
  );
}
