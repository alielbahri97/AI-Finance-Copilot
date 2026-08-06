"use client";

import { ChartColumnIcon } from "lucide-react";
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
import { EmptyState } from "@/components/ui/empty-state";
import type { MonthTrend } from "@/lib/reports/data";
import { formatCurrency, localeForCurrency } from "@/lib/utils";

const SERIES_LABELS: Record<string, string> = {
  revenue: "Revenue",
  expenses: "Expenses",
  profit: "Profit",
};

interface MonthlyTrendChartProps {
  data: MonthTrend[];
  currency: string;
}

function summarize(data: MonthTrend[], currency: string, locale: string): string {
  const money = (value: number) => formatCurrency(value, currency, locale);
  const first = data[0];
  const last = data[data.length - 1];
  const profitable = data.filter((entry) => entry.profit > 0).length;
  return (
    `Revenue, expenses and profit by month, ${first.label} to ${last.label}. ` +
    `Revenue ranges ${describeRange(data.map((entry) => entry.revenue), money)}, ` +
    `expenses ${describeRange(data.map((entry) => entry.expenses), money)}. ` +
    `Profit ${describeChange(first.profit, last.profit)} ${money(last.profit)}, ` +
    `positive in ${profitable} of ${data.length} months.`
  );
}

export function MonthlyTrendChart({ data, currency }: MonthlyTrendChartProps) {
  const locale = localeForCurrency(currency);

  if (data.length === 0 || data.every((entry) => entry.revenue === 0 && entry.expenses === 0)) {
    return (
      <EmptyState
        className="h-80"
        icon={ChartColumnIcon}
        title="No activity in this period"
        description="Nothing was recorded between these dates. Widen the range above, or import the months you are missing."
      />
    );
  }

  return (
    <div className="h-80 w-full">
      <ChartFigure
        className="h-full w-full"
        label={summarize(data, currency, locale)}
        table={
          <ChartDataTable
            caption="Revenue, expenses and profit by month"
            columns={["Month", "Revenue", "Expenses", "Profit"]}
            rows={data.map((entry) => [
              entry.label,
              formatCurrency(entry.revenue, currency, locale),
              formatCurrency(entry.expenses, currency, locale),
              formatCurrency(entry.profit, currency, locale),
            ])}
          />
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
            accessibilityLayer
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
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
              width={64}
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
              dataKey="revenue"
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
              dataKey="profit"
              stroke="var(--chart-net)"
              strokeWidth={2}
              dot={{ r: 3, fill: "var(--chart-net)" }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFigure>
    </div>
  );
}
