import Link from "next/link";
import { PlugIcon, PlusIcon, UploadIcon, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DashboardData } from "@/lib/data";

/**
 * True when the workspace has nothing for the dashboard to draw: no
 * transactions in the six-month window it reads, and no bank account whose
 * balance could stand in for them. Both halves matter — a freshly connected
 * bank with no recent activity still has a real cash position, and showing it
 * a "get started" card would be wrong.
 */
export function hasNoFinancialData(
  data: Pick<DashboardData, "transactionCount" | "cash">
): boolean {
  return data.transactionCount === 0 && data.cash.accounts.length === 0;
}

const OPTIONS: Array<{
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
}> = [
  {
    href: "/integrations",
    icon: PlugIcon,
    title: "Connect a bank",
    description:
      "Log in at your bank to grant read-only access. Transactions and balances arrive on their own and keep updating.",
  },
  {
    href: "/import",
    icon: UploadIcon,
    title: "Upload a statement",
    description:
      "Export a CSV, Excel, PDF or MT940 statement from your bank and drop the file in. You map the columns once; duplicates are skipped.",
  },
  {
    href: "/transactions",
    icon: PlusIcon,
    title: "Add one manually",
    description: "Type in a single income or expense to see how it reads.",
  },
];

interface GettingStartedProps {
  /** Only the wording differs: a household is not a company. */
  edition?: "business" | "personal";
  /** Members without edit rights get the explanation but no dead buttons. */
  canAddData?: boolean;
}

/**
 * Replaces the KPI row and charts while a workspace has no data. The zeros and
 * the empty pie chart they stand in for are not neutral — they read as a
 * broken product rather than an empty one, and they never say what to do next.
 */
export function GettingStarted({
  edition = "business",
  canAddData = true,
}: GettingStartedProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Nothing to show yet</CardTitle>
        <CardDescription>
          {edition === "personal"
            ? "There are no transactions from the last six months, so once some are in, this page shows what you have, what came in and went out each month, and where the money goes."
            : "There are no transactions from the last six months, so once some are in, this page shows your cash position, monthly income and expenses, and where the money goes by category."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {canAddData ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {OPTIONS.map((option) => (
              <Link
                key={option.href}
                href={option.href}
                className="hover:border-primary/50 hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-ring/50 flex flex-col gap-2 rounded-lg border p-4 transition-colors outline-none focus-visible:ring-[3px]"
              >
                <span className="bg-muted text-muted-foreground flex size-9 items-center justify-center rounded-md">
                  <option.icon className="size-4" />
                </span>
                <span className="text-sm font-medium">{option.title}</span>
                <span className="text-muted-foreground text-sm">{option.description}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-muted-foreground text-sm">
              Someone with permission to edit transactions has to connect a bank or import a
              statement first.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href="/help">How importing works</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
