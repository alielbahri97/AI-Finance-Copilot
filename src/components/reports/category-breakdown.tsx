"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import type { CategoryTotal } from "@/lib/reports/data";
import { formatCurrency } from "@/lib/utils";

interface CategoryBreakdownProps {
  data: CategoryTotal[];
  currency: string;
  emptyLabel: string;
}

export function CategoryBreakdown({ data, currency, emptyLabel }: CategoryBreakdownProps) {
  if (data.length === 0) {
    return (
      <div className="text-muted-foreground flex h-64 items-center justify-center text-sm">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="flex h-64 w-full flex-col">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="total"
            nameKey="name"
            innerRadius="55%"
            outerRadius="85%"
            paddingAngle={3}
            strokeWidth={0}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
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
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-2">
        {data.slice(0, 6).map((entry) => (
          <div key={entry.name} className="flex items-center justify-between gap-1.5 text-xs">
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-muted-foreground truncate">{entry.name}</span>
            </div>
            <span className="shrink-0 font-medium tabular-nums">
              {formatCurrency(entry.total, currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
