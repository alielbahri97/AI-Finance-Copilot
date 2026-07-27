import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRightIcon,
  ChartSplineIcon,
  PiggyBankIcon,
  ReceiptTextIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  WalletIcon,
} from "lucide-react";

import {
  BalanceChart,
  CategoryChart,
  OverviewChart,
} from "@/components/dashboard/charts-lazy";
import { LargestExpenses } from "@/components/dashboard/largest-expenses";
import { RecentTransactions } from "@/components/dashboard/recent-transactions";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getDashboardData, getOrCreateProfile } from "@/lib/data";
import { buildForecast } from "@/lib/finance/data";
import { getInvoiceReminders } from "@/lib/invoices/reminders";
import { getUser } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const profile = await getOrCreateProfile(user);
  const [data, forecast, invoiceReminders] = await Promise.all([
    getDashboardData(user.id),
    buildForecast(user.id, profile.currency),
    getInvoiceReminders(user.id),
  ]);
  const firstName = profile.fullName?.split(" ")[0];
  const dueCount = invoiceReminders.dueSoon.length + invoiceReminders.overdue.length;

  const runwayLabel =
    forecast.metrics.runwayMonths === null
      ? "∞ (cash-flow positive)"
      : `~${Math.round(forecast.metrics.runwayMonths * 10) / 10} months`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {firstName ? `Welcome back, ${firstName}` : "Dashboard"}
        </h1>
        <p className="text-muted-foreground text-sm">
          Built for small and medium-sized businesses — your overview for the last six months.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Income this month"
          value={formatCurrency(data.monthIncome, profile.currency)}
          hint="vs. previous month"
          icon={TrendingUpIcon}
          changePct={data.incomeChangePct}
          increaseIsGood
        />
        <StatCard
          title="Expenses this month"
          value={formatCurrency(data.monthExpenses, profile.currency)}
          hint="vs. previous month"
          icon={TrendingDownIcon}
          changePct={data.expensesChangePct}
          increaseIsGood={false}
        />
        <StatCard
          title="Total balance"
          value={formatCurrency(data.totalBalance, profile.currency)}
          hint="Across all recorded transactions"
          icon={WalletIcon}
          tone={data.totalBalance >= 0 ? "positive" : "negative"}
        />
        <StatCard
          title="Savings rate"
          value={`${data.savingsRate}%`}
          hint="Share of this month's income kept"
          icon={PiggyBankIcon}
        />
      </div>

      {dueCount > 0 && (
        <Link href="/invoices" className="group">
          <Card className="hover:border-destructive/40 gap-2 py-4 transition-colors">
            <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <div className="bg-destructive/10 text-destructive flex size-10 shrink-0 items-center justify-center rounded-lg">
                <ReceiptTextIcon className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {dueCount === 1 ? "1 invoice needs attention" : `${dueCount} invoices need attention`}
                </p>
                <p className="text-muted-foreground text-xs">
                  {invoiceReminders.overdue.length > 0 &&
                    `${invoiceReminders.overdue.length} overdue (${formatCurrency(invoiceReminders.overdueTotal, profile.currency)})`}
                  {invoiceReminders.overdue.length > 0 && invoiceReminders.dueSoon.length > 0 && " · "}
                  {invoiceReminders.dueSoon.length > 0 &&
                    `${invoiceReminders.dueSoon.length} due this week (${formatCurrency(invoiceReminders.dueSoonTotal, profile.currency)})`}
                </p>
              </div>
              <ArrowRightIcon className="text-muted-foreground group-hover:text-destructive ml-auto size-4 transition-colors" />
            </CardContent>
          </Card>
        </Link>
      )}

      <Link href="/forecast" className="group">
        <Card className="hover:border-primary/40 gap-2 py-4 transition-colors">
          <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
              <ChartSplineIcon className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Cash flow forecast</p>
              <p className="text-muted-foreground text-xs">
                Runway, projections and what-if assumptions
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
              <div>
                <p className="text-muted-foreground text-xs">Cash runway</p>
                <p className="text-sm font-semibold">{runwayLabel}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Projected balance in 30 days</p>
                <p className="text-sm font-semibold">
                  {formatCurrency(forecast.metrics.projectedBalance30d, profile.currency)}
                </p>
              </div>
            </div>
            <ArrowRightIcon className="text-muted-foreground group-hover:text-primary ml-auto size-4 transition-colors" />
          </CardContent>
        </Card>
      </Link>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Monthly cashflow</CardTitle>
            <CardDescription>Income, expenses and net per month</CardDescription>
          </CardHeader>
          <CardContent>
            <OverviewChart data={data.monthlySeries} currency={profile.currency} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Spending by category</CardTitle>
            <CardDescription>Where your money went (last 6 months)</CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryChart data={data.categoryBreakdown} currency={profile.currency} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Cash balance history</CardTitle>
            <CardDescription>Running balance across your transactions</CardDescription>
          </CardHeader>
          <CardContent>
            <BalanceChart data={data.balanceHistory} currency={profile.currency} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Largest expenses</CardTitle>
            <CardDescription>Your biggest outgoings (last 6 months)</CardDescription>
          </CardHeader>
          <CardContent>
            <LargestExpenses expenses={data.largestExpenses} currency={profile.currency} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent transactions</CardTitle>
          <CardDescription>Your latest activity</CardDescription>
        </CardHeader>
        <CardContent>
          <RecentTransactions transactions={data.recentTransactions} currency={profile.currency} />
        </CardContent>
      </Card>
    </div>
  );
}
