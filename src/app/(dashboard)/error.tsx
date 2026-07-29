"use client";

import { useEffect } from "react";
import { DatabaseZapIcon, AlertTriangleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ReportIssueButton } from "@/components/report-issue/report-issue-button";

function looksLikeDbOutage(message: string): boolean {
  return /database|postgres|prisma|ECONN|ETIMEDOUT|P1001|P1002|P1017|too many clients|connection/i.test(
    message
  );
}

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard-boundary]", error.digest ?? "", error);
  }, [error]);

  const dbDown = looksLikeDbOutage(error.message || "");

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <div
        className={
          dbDown
            ? "bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-full"
            : "bg-destructive/10 text-destructive flex size-14 items-center justify-center rounded-full"
        }
      >
        {dbDown ? (
          <DatabaseZapIcon className="size-7" />
        ) : (
          <AlertTriangleIcon className="size-7" />
        )}
      </div>
      <h1 className="text-2xl font-semibold">
        {dbDown ? "FinPilot is temporarily unavailable" : "Something went wrong"}
      </h1>
      <p className="text-muted-foreground max-w-md text-sm">
        {dbDown
          ? "We can't reach the database right now. Your account is fine — try again in a minute."
          : error.message || "An unexpected error occurred. Please try again."}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <ReportIssueButton
          variant="inline"
          errorMessage={error.message}
          errorDigest={error.digest}
        />
      </div>
    </div>
  );
}
