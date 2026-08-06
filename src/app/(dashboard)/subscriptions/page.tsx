import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  CalendarClockIcon,
  CreditCardIcon,
  FlagIcon,
  HouseIcon,
  LockIcon,
  RepeatIcon,
} from "lucide-react";

import { StatRowSkeleton, TableCardSkeleton } from "@/components/dashboard/section-skeletons";
import { StatCard } from "@/components/dashboard/stat-card";
import { SubscriptionList } from "@/components/subscriptions/subscription-list";
import { UpcomingCharges } from "@/components/subscriptions/upcoming-charges";
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
  REVIEW_MAX_MONTHLY_AMOUNT,
  UPCOMING_HORIZON_DAYS,
} from "@/lib/personal/subscriptions";
import { getSubscriptionsOverview } from "@/lib/personal/subscriptions-data";
import { formatCurrency, localeForCurrency } from "@/lib/utils";
import { getWorkspaceContext, type WorkspaceContext } from "@/lib/workspace/context";
import { editionHasFeature } from "@/lib/workspace/editions";

export const metadata: Metadata = { title: "Subscriptions" };
export const dynamic = "force-dynamic";

/**
 * Read-only and server-rendered: nothing on this page is edited, so there is
 * no client-side refetching to support and no API route to guard.
 */
export default async function SubscriptionsPage() {
  const ctx = await getWorkspaceContext();
  if (!ctx) redirect("/login");
  // The edition guard runs on the server, so a typed-in URL is rejected even
  // though the sidebar already hides the link in a Business workspace.
  if (!editionHasFeature(ctx.workspace.type, "subscriptions")) notFound();
  if (!ctx.permissions.has("view_reports")) redirect("/dashboard");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageHeading>Subscriptions</PageHeading>
        <p className="text-muted-foreground text-sm">
          Recurring charges found in your transactions, what they cost each month, and which ones
          are worth a second look.
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
        <SubscriptionsContent ctx={ctx} />
      </Suspense>
    </div>
  );
}

async function SubscriptionsContent({ ctx }: { ctx: WorkspaceContext }) {
  const entitlements = await getEntitlements(ctx.workspace.id);
  if (!entitlements.plan.limits.subscriptionInsightsEnabled) {
    return <LockedState planName={entitlements.plan.name} />;
  }

  const currency = ctx.workspace.currency;
  const overview = await getSubscriptionsOverview(ctx.workspace.id);

  if (overview.subscriptions.length === 0 && overview.bills.length === 0) {
    return <NoSubscriptionsState />;
  }

  const stoppedCount = overview.subscriptions.filter((item) =>
    item.flags.includes("overdue")
  ).length;
  const money = (value: number) => formatCurrency(value, currency, localeForCurrency(currency));

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Subscriptions per month"
          value={money(overview.totalMonthlyCost)}
          hint={`${money(overview.annualisedCost)} a year at this rate`}
          icon={CreditCardIcon}
        />
        <StatCard
          title="Worth reviewing"
          value={String(overview.flaggedCount)}
          hint={
            overview.flaggedCount === 0
              ? "No price rises or stopped charges found"
              : "Price rises, stopped charges, and small ones running a long time"
          }
          icon={FlagIcon}
          tone={overview.flaggedCount > 0 ? "negative" : "default"}
        />
        <StatCard
          title="Recurring bills"
          value={`${money(overview.totalMonthlyBills)}/mo`}
          hint="Housing, utilities, insurance and loans, counted separately"
          icon={HouseIcon}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RepeatIcon className="size-4" />
            Your subscriptions
          </CardTitle>
          <CardDescription>
            {money(overview.totalMonthlyCost)} per month across{" "}
            {overview.subscriptions.length}{" "}
            {overview.subscriptions.length === 1 ? "subscription" : "subscriptions"}
            {stoppedCount > 0
              ? `. ${stoppedCount} of them ${stoppedCount === 1 ? "has" : "have"} not been charged in a while and ${stoppedCount === 1 ? "is" : "are"} left out of the total, in case ${stoppedCount === 1 ? "it was" : "they were"} cancelled.`
              : "."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SubscriptionList
            items={overview.subscriptions}
            currency={currency}
            emptyTitle="No subscriptions detected yet"
            emptyDescription="Everything recurring in your history looks like a bill rather than a subscription."
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HouseIcon className="size-4" />
              Recurring bills
            </CardTitle>
            <CardDescription>
              Rent, utilities, insurance and loan repayments repeat like subscriptions but are not
              yours to cancel, so they are kept out of the subscription total.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SubscriptionList
              items={overview.bills}
              currency={currency}
              emptyTitle="No recurring bills detected"
              emptyDescription="Housing, utilities, insurance and loan payments show up here once they repeat on a regular date."
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClockIcon className="size-4" />
              Next {UPCOMING_HORIZON_DAYS} days
            </CardTitle>
            <CardDescription>
              Projected from each charge&apos;s cadence, so treat the dates as close rather than
              exact.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UpcomingCharges charges={overview.upcomingCharges} currency={currency} />
          </CardContent>
        </Card>
      </div>

      <p className="text-muted-foreground text-xs">
        Detection reads the last 12 months of transactions. A charge is counted as recurring after
        three occurrences at a steady amount and interval. Subscriptions under{" "}
        {money(REVIEW_MAX_MONTHLY_AMOUNT)} a month that have run for a while at
        the same price are marked as worth reviewing — your transactions show payments, not usage.
      </p>
    </>
  );
}

function NoSubscriptionsState() {
  return (
    <Card>
      <CardContent>
        <EmptyState
          icon={RepeatIcon}
          title="No recurring charges detected yet"
          description="Finding subscriptions needs a few months of history: a charge has to appear at least three times, in at least two different months, at a steady amount. Connect a bank account or import more transactions and this page will fill in."
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
          title="Subscription insights are a Plus feature"
          description={`Your ${planName} plan does not include them. Plus and Premium find every recurring charge in your transactions, total what they cost each month, and flag price rises and subscriptions worth reviewing.`}
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
