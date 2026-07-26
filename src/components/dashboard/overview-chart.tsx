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

import type { MonthlyPoint } from "@/lib/data";
import { formatCurrency } from "@/lib/utils";

interface OverviewChartProps {
  data: MonthlyPoint[];
  currency: string;
}

const SERIES_LABELS: Record<string, string> = {
  income: "Income",
  expenses: "Expenses",
  net: "Net cashflow",
};

export function OverviewChart({ data, currency }: OverviewChartProps) {
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barGap={2}>
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
              new Intl.NumberFormat("en-US", { notation: "compact" }).format(value)
            }
          />
          <Tooltip
            formatter={(value, name) => [
              formatCurrency(Number(value ?? 0), currency),
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
          <Bar dataKey="income" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="expenses" fill="var(--chart-5)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Line
            type="monotone"
            dataKey="net"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--chart-1)" }}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="text-muted-foreground flex justify-center gap-4 pt-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ backgroundColor: "var(--chart-2)" }} />
          Income
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ backgroundColor: "var(--chart-5)" }} />
          Expenses
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded" style={{ backgroundColor: "var(--chart-1)" }} />
          Net cashflow
        </span>
      </div>
    </div>
  );
}
