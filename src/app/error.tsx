"use client";

import { useEffect } from "react";
import { AlertTriangleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ReportIssueButton } from "@/components/report-issue/report-issue-button";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest correlates this client report with the server-side log line
    // (and with Sentry events when @sentry/nextjs is wired up).
    console.error("[boundary]", error.digest ?? "", error);
  }, [error]);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="bg-destructive/10 text-destructive flex size-14 items-center justify-center rounded-full">
        <AlertTriangleIcon className="size-7" />
      </div>
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground max-w-md text-sm">
        {error.message || "An unexpected error occurred. Please try again."}
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
