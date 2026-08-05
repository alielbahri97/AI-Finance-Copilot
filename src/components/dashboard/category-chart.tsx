"use client";

import { ChartPieIcon } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { ChartDataTable, ChartFigure } from "@/components/charts/chart-accessibility";
import { EmptyState } from "@/components/ui/empty-state";
import type { CategoryPoint } from "@/lib/data";
import { formatCurrency, localeForCurrency } from "@/lib/utils";

interface CategoryChartProps {
  data: CategoryPoint[];
  currency: string;
}

/** Share of total spend, to one decimal so small categories don't all read 0%. */
function share(amount: number, total: number): string {
  if (total <= 0) return "0%";
  const pct = (amount / total) * 100;
  return `${pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10}%`;
}

function summarize(
  data: CategoryPoint[],
  total: number,
  currency: string,
  locale: string
): string {
  const largest = data[0];
  return (
    `Spending by category. ${data.length} ${data.length === 1 ? "category" : "categories"} ` +
    `totalling ${formatCurrency(total, currency, locale)}. ` +
    `Largest is ${largest.category} at ${formatCurrency(largest.amount, currency, locale)}, ` +
    `${share(largest.amount, total)} of the total.`
  );
}

export function CategoryChart({ data, currency }: CategoryChartProps) {
  const locale = localeForCurrency(currency);

  if (data.length === 0) {
    return (
      <EmptyState
        className="h-80"
        icon={ChartPieIcon}
        title="No expenses recorded yet"
        description="Once money starts going out, this shows which categories it goes to."
      />
    );
  }

  const total = data.reduce((sum, entry) => sum + entry.amount, 0);

  return (
    <div className="flex h-80 w-full flex-col">
      <ChartFigure
        className="min-h-0 flex-1"
        label={summarize(data, total, currency, locale)}
        table={
          <ChartDataTable
            caption="Spending by category"
            columns={["Category", "Amount", "Share of total"]}
            rows={data.map((entry) => [
              entry.category,
              formatCurrency(entry.amount, currency, locale),
              share(entry.amount, total),
            ])}
          />
        }
      >
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
              {data.map((entry) => (
                <Cell key={entry.category} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => formatCurrency(Number(value ?? 0), currency, locale)}
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
      </ChartFigure>
      {/*
        The legend carries the amounts too: on a donut with eight slices the
        arcs alone can't be read back to a value, and hovering each one to find
        out is not a reasonable way to answer "what did I spend on groceries".
      */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 pt-2 text-xs sm:grid-cols-2">
        {data.map((entry) => (
          <div key={entry.category} className="flex items-center gap-1.5">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-muted-foreground truncate">{entry.category}</span>
            <span className="numeric text-foreground ml-auto shrink-0 font-medium">
              {formatCurrency(entry.amount, currency, locale)}
            </span>
            <span className="numeric text-muted-foreground w-9 shrink-0 text-right">
              {share(entry.amount, total)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
