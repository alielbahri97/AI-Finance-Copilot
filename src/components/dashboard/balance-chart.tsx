"use client";

import { ChartSplineIcon } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartDataTable,
  ChartFigure,
  describeChange,
} from "@/components/charts/chart-accessibility";
import { EmptyState } from "@/components/ui/empty-state";
import type { BalancePoint } from "@/lib/data";
import { formatCurrency, formatDate, localeForCurrency } from "@/lib/utils";

interface BalanceChartProps {
  data: BalancePoint[];
  currency: string;
}

function summarize(data: BalancePoint[], currency: string, locale: string): string {
  const money = (value: number) => formatCurrency(value, currency, locale);
  const balances = data.map((point) => point.balance);
  const first = data[0];
  const last = data[data.length - 1];
  return (
    `Cash balance over time, ${formatDate(first.date, locale)} to ${formatDate(last.date, locale)}. ` +
    `From ${money(first.balance)}, ${describeChange(first.balance, last.balance)} ` +
    `${money(last.balance)}. Low ${money(Math.min(...balances))}, ` +
    `high ${money(Math.max(...balances))}.`
  );
}

export function BalanceChart({ data, currency }: BalanceChartProps) {
  const locale = localeForCurrency(currency);

  if (data.length === 0) {
    return (
      <EmptyState
        className="h-72"
        icon={ChartSplineIcon}
        title="No transactions recorded yet"
        description="The balance line is drawn from your transaction history — import a statement or connect a bank to fill it in."
      />
    );
  }

  return (
    <div className="h-72 w-full">
      <ChartFigure
        className="h-full w-full"
        label={summarize(data, currency, locale)}
        table={
          <ChartDataTable
            caption="Cash balance by date"
            columns={["Date", "Balance"]}
            rows={data.map((point) => [
              formatDate(point.date, locale),
              formatCurrency(point.balance, currency, locale),
            ])}
          />
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
            accessibilityLayer
          >
            <defs>
              <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="date"
              stroke="var(--muted-foreground)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
              tickFormatter={(value: string) =>
                new Date(value).toLocaleDateString(locale, { month: "short", day: "numeric" })
              }
            />
            <YAxis
              stroke="var(--muted-foreground)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              width={60}
              tickFormatter={(value: number) =>
                new Intl.NumberFormat(locale, { notation: "compact" }).format(value)
              }
            />
            <Tooltip
              formatter={(value) => [
                formatCurrency(Number(value ?? 0), currency, locale),
                "Balance",
              ]}
              labelFormatter={(label) => formatDate(String(label), locale)}
              contentStyle={{
                backgroundColor: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                color: "var(--popover-foreground)",
                fontSize: 12,
              }}
            />
            <Area
              type="monotone"
              dataKey="balance"
              stroke="var(--chart-1)"
              strokeWidth={2}
              fill="url(#balanceGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartFigure>
    </div>
  );
}
