import {
  BalanceChart,
  CategoryChart,
  OverviewChart,
} from "@/components/dashboard/charts-lazy";
import { CashLegend } from "@/components/dashboard/cash-card";
import { LargestExpenses } from "@/components/dashboard/largest-expenses";
import { RecentTransactions } from "@/components/dashboard/recent-transactions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getDashboardData } from "@/lib/data";

/**
 * Cashflow, category, balance and transaction views. Every edition gets these:
 * a month-by-month picture of money in and out reads the same whether the
 * account belongs to a company or a person, so only the wording differs.
 *
 * `getDashboardData` is request-memoized, so rendering this next to the stats
 * row costs one query set, not two.
 */
export async function ChartsSection({
  workspaceId,
  currency,
  edition = "business",
}: {
  workspaceId: string;
  currency: string;
  edition?: "business" | "personal";
}) {
  const data = await getDashboardData(workspaceId);
  const personal = edition === "personal";

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{personal ? "Money in and out" : "Monthly cashflow"}</CardTitle>
            <CardDescription>
              {personal
                ? "What came in, what went out, and what you kept each month"
                : "Income, expenses and net per month"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OverviewChart data={data.monthlySeries} currency={currency} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Spending by category</CardTitle>
            <CardDescription>Where your money went (last 6 months)</CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryChart data={data.categoryBreakdown} currency={currency} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{personal ? "Balance over time" : "Cash balance history"}</CardTitle>
            <CardDescription>
              {data.cash.source === "bank"
                ? "Running balance, ending at your combined bank balance"
                : "Running balance across your transactions"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BalanceChart data={data.balanceHistory} currency={currency} />
            <CashLegend cash={data.cash} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Largest expenses</CardTitle>
            <CardDescription>Your biggest outgoings (last 6 months)</CardDescription>
          </CardHeader>
          <CardContent>
            <LargestExpenses expenses={data.largestExpenses} currency={currency} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent transactions</CardTitle>
          <CardDescription>Your latest activity</CardDescription>
        </CardHeader>
        <CardContent>
          <RecentTransactions transactions={data.recentTransactions} currency={currency} />
        </CardContent>
      </Card>
    </>
  );
}
