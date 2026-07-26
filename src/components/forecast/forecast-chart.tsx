"use client";

import { useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ForecastPoint } from "@/lib/finance/forecast";
import { formatCurrency } from "@/lib/utils";

type HorizonKey = "d30" | "d90" | "m12";

interface ForecastChartProps {
  horizons: Record<HorizonKey, ForecastPoint[]>;
  currency: string;
}

const HORIZON_LABELS: Record<HorizonKey, string> = {
  d30: "30 days",
  d90: "90 days",
  m12: "12 months",
};

function formatTick(value: string): string {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ForecastChart({ horizons, currency }: ForecastChartProps) {
  const [horizon, setHorizon] = useState<HorizonKey>("d90");
  const data = horizons[horizon];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={horizon} onValueChange={(value) => setHorizon(value as HorizonKey)}>
          <TabsList>
            {(Object.keys(HORIZON_LABELS) as HorizonKey[]).map((key) => (
              <TabsTrigger key={key} value={key}>
                {HORIZON_LABELS[key]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="text-muted-foreground flex gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ backgroundColor: "var(--chart-1)" }} />
            Actual
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-0 w-4 border-t-2 border-dashed"
              style={{ borderColor: "var(--chart-2)" }}
            />
            Projected
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-4 rounded-sm opacity-40"
              style={{ backgroundColor: "var(--chart-2)" }}
            />
            ~80% band
          </span>
        </div>
      </div>

      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="date"
              stroke="var(--muted-foreground)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              minTickGap={48}
              tickFormatter={formatTick}
            />
            <YAxis
              stroke="var(--muted-foreground)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              width={64}
              domain={["auto", "auto"]}
              tickFormatter={(value: number) =>
                new Intl.NumberFormat("en-US", { notation: "compact" }).format(value)
              }
            />
            <Tooltip
              formatter={(value, name) => {
                if (name === "band" && Array.isArray(value)) {
                  return [
                    `${formatCurrency(Number(value[0]), currency)} – ${formatCurrency(Number(value[1]), currency)}`,
                    "Confidence band",
                  ];
                }
                return [
                  formatCurrency(Number(value ?? 0), currency),
                  name === "actual" ? "Actual balance" : "Projected balance",
                ];
              }}
              labelFormatter={(label) =>
                new Date(String(label)).toLocaleDateString("en-US", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })
              }
              contentStyle={{
                backgroundColor: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                color: "var(--popover-foreground)",
                fontSize: 12,
              }}
            />
            <Area
              dataKey="band"
              stroke="none"
              fill="var(--chart-2)"
              fillOpacity={0.15}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="actual"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="projected"
              stroke="var(--chart-2)"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
