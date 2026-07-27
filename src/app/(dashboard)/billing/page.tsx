import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon } from "lucide-react";

import { PlanCards } from "@/components/billing/plan-cards";
import { PortalButton } from "@/components/billing/portal-button";
import { ReferralCard } from "@/components/billing/referral-card";
import { UsageMeters } from "@/components/billing/usage-meters";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { PLAN_ORDER, PLANS } from "@/lib/billing/plans";
import { getReferralStats, REFERRAL_REWARD_DAYS } from "@/lib/billing/referrals";
import { getStripe, isBillingConfigured } from "@/lib/billing/stripe";
import { getOrCreateProfile } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";

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

async function getInvoiceHistory(userId: string): Promise<StripeInvoiceRow[]> {
  const stripe = getStripe();
  if (!stripe) return [];
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
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
    console.error("[billing] failed to list Stripe invoices:", error);
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
  const user = await getUser();
  if (!user) redirect("/login");

  const { checkout } = await searchParams;
  await getOrCreateProfile(user);

  const billingConfigured = isBillingConfigured();
  const [entitlements, referralStats, invoiceHistory] = await Promise.all([
    getEntitlements(user.id),
    getReferralStats(user.id),
    getInvoiceHistory(user.id),
  ]);

  const { plan, usage } = entitlements;
  const trialDaysLeft = entitlements.trialEndsAt
    ? Math.max(
        0,
        Math.ceil((new Date(entitlements.trialEndsAt).getTime() - Date.now()) / 86_400_000)
      )
    : 0;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const referralLink = `${appUrl}/signup?ref=${referralStats.code}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
          <p className="text-muted-foreground text-sm">
            Your plan, usage and invoices — all in one place.
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
              <p className="text-warning-foreground text-muted-foreground">
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
                  label: "CSV imports",
                  used: usage.csvImports,
                  limit: plan.limits.csvImportsPerMonth,
                },
                {
                  label: "Invoice extractions",
                  used: usage.invoiceExtractions,
                  limit: plan.limits.invoiceExtractionsPerMonth,
                },
                {
                  label: "Report exports",
                  used: usage.exports,
                  limit: plan.limits.exportsEnabled ? null : 0,
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <PlanCards
        plans={PLAN_ORDER.map((id) => PLANS[id])}
        currentPlanId={entitlements.planId}
        isTrial={entitlements.isTrial}
        billingConfigured={billingConfigured}
      />

      <Card>
        <CardHeader>
          <CardTitle>Refer a friend</CardTitle>
          <CardDescription>Earn free Pro time for every referral that upgrades.</CardDescription>
        </CardHeader>
        <CardContent>
          <ReferralCard
            code={referralStats.code}
            link={referralLink}
            total={referralStats.total}
            converted={referralStats.converted}
            rewardDays={REFERRAL_REWARD_DAYS}
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
            <p className="text-muted-foreground py-4 text-center text-sm">
              {billingConfigured
                ? "No invoices yet — they will appear here after your first payment."
                : "Invoice history is available once billing is configured."}
            </p>
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
