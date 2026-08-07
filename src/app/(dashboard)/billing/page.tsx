import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon, ReceiptTextIcon } from "lucide-react";

import { PlanCards } from "@/components/billing/plan-cards";
import { PortalButton } from "@/components/billing/portal-button";
import { ReferralCard } from "@/components/billing/referral-card";
import { UsageMeters } from "@/components/billing/usage-meters";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeading } from "@/components/ui/page-heading";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getEntitlements } from "@/lib/billing/entitlements";
import {
  getPlan,
  planOrder,
  referralRewardPlan,
  REFERRAL_REWARD_DAYS,
} from "@/lib/billing/plans";
import { getReferralStats } from "@/lib/billing/referrals";
import { getStripe, isBillingConfigured } from "@/lib/billing/stripe";
import { getAppUrl } from "@/lib/env-url";
import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext } from "@/lib/workspace/context";

export const metadata: Metadata = { title: "Billing" };

interface StripeInvoiceRow {
  id: string;
  number: string | null;
  created: string;
  total: number;
  currency: string;
  status: string;
  url: string | null;
}

async function getInvoiceHistory(workspaceId: string): Promise<StripeInvoiceRow[]> {
  const stripe = getStripe();
  if (!stripe) return [];
  const subscription = await prisma.subscription.findUnique({
    where: { workspaceId },
    select: { stripeCustomerId: true },
  });
  if (!subscription?.stripeCustomerId) return [];
  try {
    const invoices = await stripe.invoices.list({
      customer: subscription.stripeCustomerId,
      limit: 12,
    });
    return invoices.data.map((invoice) => ({
      id: invoice.id ?? "",
      number: invoice.number ?? null,
      created: new Date(invoice.created * 1000).toISOString(),
      total: invoice.total / 100,
      currency: invoice.currency.toUpperCase(),
      status: invoice.status ?? "open",
      url: invoice.hosted_invoice_url ?? null,
    }));
  } catch (error) {
    logger.error("failed to list Stripe invoices", { error: serializeError(error) });
    return [];
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const ctx = await getWorkspaceContext();
  if (!ctx) redirect("/login");
  if (!ctx.permissions.has("view_billing")) redirect("/dashboard");
  const { user, workspace } = ctx;

  const { checkout } = await searchParams;

  const billingConfigured = isBillingConfigured();
  const [entitlements, referralStats, invoiceHistory] = await Promise.all([
    getEntitlements(workspace.id),
    getReferralStats(user.id),
    getInvoiceHistory(workspace.id),
  ]);

  const { plan, usage, edition } = entitlements;
  // Only the workspace's own edition is offered: a Personal workspace has no
  // use for seats and a Business one has no use for a €4.99 single-user tier.
  const availablePlans = planOrder(edition).map((id) => getPlan(id, edition));
  const rewardPlanName = referralRewardPlan(edition).name;
  const trialDaysLeft = entitlements.trialEndsAt
    ? Math.max(
        0,
        Math.ceil((new Date(entitlements.trialEndsAt).getTime() - Date.now()) / 86_400_000)
      )
    : 0;
  const referralLink = `${getAppUrl()}/signup?ref=${referralStats.code}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <PageHeading>Billing</PageHeading>
          <p className="text-muted-foreground text-sm">
            Your plan, usage, and invoices.
          </p>
        </div>
        <PortalButton disabled={!billingConfigured || !entitlements.hasStripeCustomer} />
      </div>

      {checkout === "success" && (
        <Alert>
          <CheckCircle2Icon />
          <AlertTitle>Payment received</AlertTitle>
          <AlertDescription>
            Thanks for upgrading! Your plan updates automatically as soon as Stripe confirms the
            subscription (usually within a few seconds).
          </AlertDescription>
        </Alert>
      )}
      {checkout === "canceled" && (
        <Alert>
          <InfoIcon />
          <AlertTitle>Checkout canceled</AlertTitle>
          <AlertDescription>No changes were made to your plan.</AlertDescription>
        </Alert>
      )}
      {!billingConfigured && (
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>Billing is not configured</AlertTitle>
          <AlertDescription>
            Stripe keys are not set on this server, so upgrades are disabled. The app runs fully
            on the {entitlements.isTrial ? "trial" : plan.name} plan. See the README for setup.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Current plan</CardTitle>
              <Badge variant={entitlements.planId === "FREE" ? "secondary" : "default"}>
                {plan.name}
                {entitlements.isTrial ? " trial" : ""}
              </Badge>
            </div>
            <CardDescription>
              {entitlements.isTrial && trialDaysLeft > 0
                ? `Your free ${plan.name} trial ends in ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} — no card required until then.`
                : plan.description}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {entitlements.subscriptionStatus === "PAST_DUE" && (
              <p className="text-destructive font-medium">
                Your last payment failed. Update your payment method in the billing portal to keep
                your plan.
              </p>
            )}
            {entitlements.cancelAtPeriodEnd && entitlements.currentPeriodEnd && (
              <p className="text-muted-foreground">
                Your subscription is set to cancel on {formatDate(entitlements.currentPeriodEnd)}.
                You keep full access until then.
              </p>
            )}
            {!entitlements.cancelAtPeriodEnd && entitlements.currentPeriodEnd && (
              <p className="text-muted-foreground">
                Renews on {formatDate(entitlements.currentPeriodEnd)}.
              </p>
            )}
            {!entitlements.currentPeriodEnd && !entitlements.isTrial && (
              <p className="text-muted-foreground">
                You are on the free plan. Upgrade any time — changes apply immediately.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usage this month</CardTitle>
            <CardDescription>Counters reset at the start of each calendar month.</CardDescription>
          </CardHeader>
          <CardContent>
            <UsageMeters
              meters={[
                {
                  label: "AI messages",
                  used: usage.aiMessages,
                  limit: plan.limits.aiMessagesPerMonth,
                },
                {
                  label: "Statement imports",
                  used: usage.csvImports,
                  limit: plan.limits.csvImportsPerMonth,
                },
                // Personal has no invoices, so the meter would always read 0/0.
                ...(plan.limits.invoiceExtractionsPerMonth === 0
                  ? []
                  : [
                      {
                        label: "Invoice extractions",
                        used: usage.invoiceExtractions,
                        limit: plan.limits.invoiceExtractionsPerMonth,
                      },
                    ]),
                {
                  label: "Excel / PDF exports",
                  used: usage.exports,
                  limit: plan.limits.exportsEnabled ? null : 0,
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <PlanCards
        plans={availablePlans}
        currentPlanId={entitlements.planId}
        isTrial={entitlements.isTrial}
        billingConfigured={billingConfigured}
      />

      <Card>
        <CardHeader>
          <CardTitle>Refer a friend</CardTitle>
          <CardDescription>
            Earn free {rewardPlanName} time for every referral that upgrades.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReferralCard
            code={referralStats.code}
            link={referralLink}
            total={referralStats.total}
            converted={referralStats.converted}
            rewardDays={REFERRAL_REWARD_DAYS}
            rewardPlanName={rewardPlanName}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoice history</CardTitle>
          <CardDescription>Invoices issued by Stripe for your subscription.</CardDescription>
        </CardHeader>
        <CardContent>
          {invoiceHistory.length === 0 ? (
            <EmptyState
              className="py-8"
              icon={ReceiptTextIcon}
              title={billingConfigured ? "No invoices yet" : "Billing is not configured"}
              description={
                billingConfigured
                  ? "Stripe issues one after each payment, and every invoice stays downloadable here."
                  : "This workspace is not connected to Stripe, so there is nothing to bill and no history to show."
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoiceHistory.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell>
                      {invoice.url ? (
                        <a
                          href={invoice.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {invoice.number ?? invoice.id}
                        </a>
                      ) : (
                        <span className="font-medium">{invoice.number ?? invoice.id}</span>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(invoice.created)}</TableCell>
                    <TableCell className="capitalize">{invoice.status}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {invoice.total.toLocaleString("en-US", {
                        style: "currency",
                        currency: invoice.currency,
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
