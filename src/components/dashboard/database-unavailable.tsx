import { DatabaseZapIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ReportIssueButton } from "@/components/report-issue/report-issue-button";

/**
 * Shown when dashboard routes cannot reach Postgres (pooler outage, cold
 * start storm, misconfigured DATABASE_URL). Auth still works; data does not.
 */
export function DatabaseUnavailable({ email }: { email?: string | null }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-full">
        <DatabaseZapIcon className="size-7" />
      </div>
      <h1 className="text-2xl font-semibold">FinPilot is temporarily unavailable</h1>
      <p className="text-muted-foreground max-w-md text-sm">
        We can&apos;t reach the database right now
        {email ? ` (signed in as ${email})` : ""}. Your account is fine — try again
        in a minute. If this keeps happening, report an issue.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <Link href="/dashboard">Try again</Link>
        </Button>
        <ReportIssueButton
          variant="inline"
          errorMessage="Database temporarily unavailable"
        />
      </div>
    </div>
  );
}
