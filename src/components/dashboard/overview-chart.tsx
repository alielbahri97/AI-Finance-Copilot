"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
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

export function OverviewChart({ data, currency }: OverviewChartProps) {
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-5)" stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--chart-5)" stopOpacity={0} />
            </linearGradient>
          </defs>
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
              name === "income" ? "Income" : "Expenses",
            ]}
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
            dataKey="income"
            stroke="var(--chart-2)"
            strokeWidth={2}
            fill="url(#incomeGradient)"
          />
          <Area
            type="monotone"
            dataKey="expenses"
            stroke="var(--chart-5)"
            strokeWidth={2}
            fill="url(#expenseGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
