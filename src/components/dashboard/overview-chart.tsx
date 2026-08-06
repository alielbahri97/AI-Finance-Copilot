"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartDataTable,
  ChartFigure,
  describeChange,
  describeRange,
} from "@/components/charts/chart-accessibility";
import type { MonthlyPoint } from "@/lib/data";
import { formatCurrency, localeForCurrency } from "@/lib/utils";

interface OverviewChartProps {
  data: MonthlyPoint[];
  currency: string;
}

const SERIES_LABELS: Record<string, string> = {
  income: "Income",
  expenses: "Expenses",
  net: "Net cashflow",
};

function summarize(data: MonthlyPoint[], currency: string, locale: string): string {
  if (data.length === 0) return "Monthly cashflow chart. No months recorded yet.";
  const money = (value: number) => formatCurrency(value, currency, locale);
  const first = data[0];
  const last = data[data.length - 1];
  return (
    `Monthly cashflow, ${first.month} to ${last.month}. ` +
    `Income ranges ${describeRange(data.map((point) => point.income), money)}, ` +
    `expenses ${describeRange(data.map((point) => point.expenses), money)}. ` +
    `Net cashflow ${describeChange(first.net, last.net)} ${money(last.net)}.`
  );
}

export function OverviewChart({ data, currency }: OverviewChartProps) {
  const locale = localeForCurrency(currency);

  return (
    <div className="h-80 w-full">
      <ChartFigure
        className="h-full w-full"
        label={summarize(data, currency, locale)}
        table={
          <ChartDataTable
            caption="Monthly income, expenses and net cashflow"
            columns={["Month", "Income", "Expenses", "Net cashflow"]}
            rows={data.map((point) => [
              point.month,
              formatCurrency(point.income, currency, locale),
              formatCurrency(point.expenses, currency, locale),
              formatCurrency(point.net, currency, locale),
            ])}
          />
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
            barGap={2}
            accessibilityLayer
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="month"
              stroke="var(--muted-foreground)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="var(--muted-foreground)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: number) =>
                new Intl.NumberFormat(locale, { notation: "compact" }).format(value)
              }
            />
            <Tooltip
              formatter={(value, name) => [
                formatCurrency(Number(value ?? 0), currency, locale),
                SERIES_LABELS[String(name)] ?? String(name),
              ]}
              contentStyle={{
                backgroundColor: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                color: "var(--popover-foreground)",
                fontSize: 12,
              }}
              cursor={{ fill: "var(--accent)", opacity: 0.4 }}
            />
            <Bar
              dataKey="income"
              fill="var(--chart-income)"
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            />
            <Bar
              dataKey="expenses"
              fill="var(--chart-expense)"
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            />
            <Line
              type="monotone"
              dataKey="net"
              stroke="var(--chart-net)"
              strokeWidth={2}
              dot={{ r: 3, fill: "var(--chart-net)" }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFigure>
      <div className="text-muted-foreground flex justify-center gap-4 pt-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-sm"
            style={{ backgroundColor: "var(--chart-income)" }}
          />
          Income
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-sm"
            style={{ backgroundColor: "var(--chart-expense)" }}
          />
          Expenses
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded" style={{ backgroundColor: "var(--chart-net)" }} />
          Net cashflow
        </span>
      </div>
    </div>
  );
}
