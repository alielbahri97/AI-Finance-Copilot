import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  CopyIcon,
  FlagIcon,
  LockIcon,
  PieChartIcon,
  RepeatIcon,
} from "lucide-react";

import { StatRowSkeleton, TableCardSkeleton } from "@/components/dashboard/section-skeletons";
import { StatCard } from "@/components/dashboard/stat-card";
import { VendorTable } from "@/components/recurring-spend/vendor-table";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeading } from "@/components/ui/page-heading";
import { getEntitlements } from "@/lib/billing/entitlements";
import {
  OVERLAP_MIN_VENDORS,
  PRICE_CREEP_MIN_PERCENT,
  type RecurringSpendAudit,
} from "@/lib/business/recurring-spend";
import { getRecurringSpendAudit } from "@/lib/business/recurring-spend-data";
import { formatCurrency, localeForCurrency } from "@/lib/utils";
import { getWorkspaceContext, type WorkspaceContext } from "@/lib/workspace/context";
import { editionHasFeature } from "@/lib/workspace/editions";

export const metadata: Metadata = { title: "Recurring spend" };
export const dynamic = "force-dynamic";

/**
 * Read-only and server-rendered, like the personal Subscriptions page it
 * shares a detector with: nothing here is edited, so there is no client-side
 * refetching to support and no API route to guard.
 */
export default async function RecurringSpendPage() {
  const ctx = await getWorkspaceContext();
  if (!ctx) redirect("/login");
  // The edition guard runs on the server, so a typed-in URL is rejected even
  // though the sidebar already hides the link in a Personal workspace.
  if (!editionHasFeature(ctx.workspace.type, "recurringSpend")) notFound();
  if (!ctx.permissions.has("view_reports")) redirect("/dashboard");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageHeading>Recurring spend</PageHeading>
        <p className="text-muted-foreground text-sm">
          Every vendor that charges you on a schedule, what it costs a year, and which ones are
          worth a decision.
        </p>
      </div>

      <Suspense
        fallback={
          <>
            <StatRowSkeleton count={3} />
            <TableCardSkeleton />
          </>
        }
      >
        <RecurringSpendContent ctx={ctx} />
      </Suspense>
    </div>
  );
}

async function RecurringSpendContent({ ctx }: { ctx: WorkspaceContext }) {
  const entitlements = await getEntitlements(ctx.workspace.id);
  if (!entitlements.plan.limits.recurringSpendEnabled) {
    return <LockedState planName={entitlements.plan.name} />;
  }

  const audit = await getRecurringSpendAudit(ctx.workspace.id);
  if (audit.vendors.length === 0) {
    return <NoVendorsState />;
  }

  return <Audit audit={audit} currency={ctx.workspace.currency} />;
}

function Audit({ audit, currency }: { audit: RecurringSpendAudit; currency: string }) {
  const money = (value: number) => formatCurrency(value, currency, localeForCurrency(currency));
  const activeCount = audit.vendors.filter((vendor) => !vendor.overdue).length;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Recurring per month"
          value={money(audit.totalMonthlyRecurring)}
          hint={`${money(audit.totalAnnualisedRecurring)} a year at this rate`}
          icon={RepeatIcon}
        />
        <StatCard
          title="Share of total spend"
          value={
            audit.recurringExpenseShare > 0 ? `${Math.round(audit.recurringExpenseShare)}%` : "—"
          }
          hint={
            audit.monthlyExpenseBase > 0
              ? `of ${money(audit.monthlyExpenseBase)} average monthly expenses`
              : "Not enough expense history to compare against"
          }
          icon={PieChartIcon}
        />
        <StatCard
          title="Worth a decision"
          value={String(audit.flaggedCount)}
          hint={
            audit.flaggedCount === 0
              ? "No price rises, duplicates or stopped charges found"
              : "Price rises, possible duplicates and charges that have stopped"
          }
          icon={FlagIcon}
          tone={audit.flaggedCount > 0 ? "negative" : "default"}
        />
      </div>

      {audit.overlapGroups.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CopyIcon className="size-4" />
              Possible duplicate tools
            </CardTitle>
            <CardDescription>
              Vendors that look like they do the same job. The grouping is the only part of this
              page an AI decides — the amounts and vendors come from your transactions — so treat
              each group as a question rather than an answer.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {audit.overlapGroups.map((group) => (
              <div
                key={group.toolCategory}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-3 last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium capitalize">{group.toolCategory}</p>
                  <p className="text-muted-foreground text-xs">
                    {group.vendorLabels.join(", ")}
                  </p>
                </div>
                <p className="numeric text-sm font-semibold">
                  {money(group.monthlyAmount)}/mo combined
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RepeatIcon className="size-4" />
            Recurring vendors
          </CardTitle>
          <CardDescription>
            {money(audit.totalMonthlyRecurring)} per month across {activeCount}{" "}
            {activeCount === 1 ? "active vendor" : "active vendors"}, sorted by what each costs a
            month.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VendorTable
            vendors={audit.vendors}
            overlapGroups={audit.overlapGroups}
            currency={currency}
          />
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        Detection reads the last 12 months of expenses. A charge counts as recurring after three
        occurrences at a steady amount and interval, and its yearly figure is derived from the
        monthly equivalent, so a quarterly or half-yearly invoice is annualised rather than
        multiplied. A vendor is flagged for price creep when its latest charge is more than{" "}
        {PRICE_CREEP_MIN_PERCENT}% above its first, and for a possible duplicate when{" "}
        {OVERLAP_MIN_VENDORS} or more active vendors are labelled with the same kind of service.
        Payroll, tax and internal transfers are left out of the vendor list — they repeat like a
        subscription but are not one — while still counting towards total spend.
      </p>
    </>
  );
}

function NoVendorsState() {
  return (
    <Card>
      <CardContent>
        <EmptyState
          icon={RepeatIcon}
          title="No recurring charges detected yet"
          description="Finding recurring vendors needs a few months of history: a charge has to appear at least three times, in at least two different months, at a steady amount. Connect a bank account or import more transactions and this page will fill in."
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/import">Import transactions</Link>
            </Button>
          }
        />
      </CardContent>
    </Card>
  );
}

function LockedState({ planName }: { planName: string }) {
  return (
    <Card>
      <CardContent>
        <EmptyState
          icon={LockIcon}
          title="The recurring-spend audit is a Pro feature"
          description={`Your ${planName} plan does not include it. Pro and above find every vendor that charges you on a schedule, total what they cost a year, and flag price rises and tools you may be paying for twice.`}
          action={
            <Button asChild size="sm">
              <Link href="/billing">Upgrade plan</Link>
            </Button>
          }
        />
      </CardContent>
    </Card>
  );
}
