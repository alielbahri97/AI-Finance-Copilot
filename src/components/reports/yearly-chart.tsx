"use client";

import { TrendingUpIcon } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyState } from "@/components/ui/empty-state";
import type { YearTrend } from "@/lib/reports/data";
import { formatCurrency, localeForCurrency } from "@/lib/utils";

const SERIES_LABELS: Record<string, string> = {
  revenue: "Revenue",
  expenses: "Expenses",
  profit: "Profit",
};

interface YearlyChartProps {
  data: YearTrend[];
  currency: string;
}

export function YearlyChart({ data, currency }: YearlyChartProps) {
  const locale = localeForCurrency(currency);

  if (data.length === 0) {
    return (
      <EmptyState
        className="h-80"
        icon={TrendingUpIcon}
        title="No yearly history yet"
        description="This fills in once you have transactions spanning more than one year."
      />
    );
  }

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="year"
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
          <Legend
            formatter={(value) => (
              <span className="text-muted-foreground text-xs">
                {SERIES_LABELS[String(value)] ?? String(value)}
              </span>
            )}
          />
          <Bar dataKey="revenue" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={32} />
          <Bar dataKey="expenses" fill="var(--chart-5)" radius={[4, 4, 0, 0]} maxBarSize={32} />
          <Bar dataKey="profit" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
