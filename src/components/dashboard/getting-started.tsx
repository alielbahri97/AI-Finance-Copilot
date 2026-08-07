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
import { cn } from "@/lib/utils";

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
  primary?: boolean;
}> = [
  {
    href: "/integrations",
    icon: PlugIcon,
    title: "Connect a bank",
    description: "Read-only access. Balances and transactions keep updating on their own.",
    primary: true,
  },
  {
    href: "/import",
    icon: UploadIcon,
    title: "Upload a statement",
    description: "Drop a CSV, Excel, PDF or MT940 export. Duplicates are skipped.",
  },
  {
    href: "/transactions",
    icon: PlusIcon,
    title: "Add one manually",
    description: "Type a single income or expense to see how it reads.",
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
        <CardTitle>Let&apos;s get your money in</CardTitle>
        <CardDescription>
          {edition === "personal"
            ? "Once a few transactions are here, this page shows what you have, what came in and went out, and where it goes."
            : "Once a few transactions are here, this page shows cash position, monthly income and expenses, and where money goes by category."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {canAddData ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {OPTIONS.map((option) => (
              <Link
                key={option.href}
                href={option.href}
                className={cn(
                  "focus-visible:border-ring focus-visible:ring-ring/50 flex flex-col gap-2.5 rounded-xl border p-4 outline-none transition-[border-color,background-color,box-shadow] duration-150 focus-visible:ring-[3px]",
                  option.primary
                    ? "border-primary/40 bg-primary/[0.04] hover:border-primary/60 hover:bg-primary/[0.07]"
                    : "hover:border-primary/40 hover:bg-muted/40"
                )}
              >
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-lg",
                    option.primary
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  <option.icon className="size-4" />
                </span>
                <span className="text-sm font-semibold tracking-tight">{option.title}</span>
                <span className="text-muted-foreground text-sm leading-relaxed">
                  {option.description}
                </span>
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
