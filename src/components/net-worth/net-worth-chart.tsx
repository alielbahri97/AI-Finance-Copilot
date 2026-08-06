"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCurrency } from "@/lib/utils";

import type { NetWorthChartPoint } from "./types";

interface NetWorthChartProps {
  data: NetWorthChartPoint[];
  currency: string;
}

/**
 * Net worth month by month. One line rather than a stacked assets-and-debts
 * chart: the question is "is the number going up", and the breakdown lives in
 * the tooltip and the tables below.
 *
 * The zero line is drawn explicitly because net worth can legitimately be
 * negative — a mortgage taken out last month, a student loan — and without it
 * an axis that never reaches zero reads as if the debt were an asset.
 */
export function NetWorthChart({ data, currency }: NetWorthChartProps) {
  if (data.length === 0) {
    return (
      <div className="text-muted-foreground flex h-72 items-center justify-center text-sm">
        Nothing to chart yet
      </div>
    );
  }

  const lowest = Math.min(...data.map((point) => point.netWorth));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="netWorthGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="var(--muted-foreground)"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis
            stroke="var(--muted-foreground)"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={(value: number) =>
              new Intl.NumberFormat("en-US", { notation: "compact" }).format(value)
            }
          />
          {lowest < 0 ? <ReferenceLine y={0} stroke="var(--border)" /> : null}
          <Tooltip
            formatter={(value, name) => [
              formatCurrency(Number(value ?? 0), currency),
              String(name),
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
            dataKey="netWorth"
            name="Net worth"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#netWorthGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
