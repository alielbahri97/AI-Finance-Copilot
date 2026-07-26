"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import type { CategoryPoint } from "@/lib/data";
import { formatCurrency } from "@/lib/utils";

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--muted-foreground)",
];

interface CategoryChartProps {
  data: CategoryPoint[];
  currency: string;
}

export function CategoryChart({ data, currency }: CategoryChartProps) {
  if (data.length === 0) {
    return (
      <div className="text-muted-foreground flex h-80 items-center justify-center text-sm">
        No expenses recorded yet
      </div>
    );
  }

  return (
    <div className="flex h-80 w-full flex-col">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="amount"
            nameKey="category"
            innerRadius="55%"
            outerRadius="85%"
            paddingAngle={3}
            strokeWidth={0}
          >
            {data.map((entry, index) => (
              <Cell key={entry.category} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => formatCurrency(Number(value ?? 0), currency)}
            contentStyle={{
              backgroundColor: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              color: "var(--popover-foreground)",
              fontSize: 12,
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-2 sm:grid-cols-3">
        {data.map((entry, index) => (
          <div key={entry.category} className="flex items-center gap-1.5 text-xs">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: COLORS[index % COLORS.length] }}
            />
            <span className="text-muted-foreground truncate">{entry.category}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
