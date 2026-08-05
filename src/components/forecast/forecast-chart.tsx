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

import {
  ChartDataTable,
  ChartFigure,
  describeChange,
} from "@/components/charts/chart-accessibility";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ForecastPoint } from "@/lib/finance/forecast";
import { formatCurrency, formatDate, localeForCurrency } from "@/lib/utils";

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

function formatTick(value: string, locale: string): string {
  return new Date(value).toLocaleDateString(locale, { month: "short", day: "numeric" });
}

function summarize(
  data: ForecastPoint[],
  horizon: HorizonKey,
  currency: string,
  locale: string
): string {
  const money = (value: number) => formatCurrency(value, currency, locale);
  const scope = `Cash balance forecast over the next ${HORIZON_LABELS[horizon]}.`;

  const actuals = data.filter((point) => point.actual !== null);
  const projections = data.filter((point) => point.projected !== null);
  const lastActual = actuals[actuals.length - 1];
  const lastProjection = projections[projections.length - 1];
  if (!lastActual || !lastProjection?.projected) return `${scope} Not enough history to project.`;

  const start = lastActual.actual as number;
  const end = lastProjection.projected;
  const band = lastProjection.band;
  return (
    `${scope} From a current balance of ${money(start)}, ` +
    `${describeChange(start, end)} ${money(end)} by ${formatDate(lastProjection.date, locale)}` +
    `${band ? `, within a roughly 80% confidence band of ${money(band[0])} to ${money(band[1])}` : ""}.`
  );
}

export function ForecastChart({ horizons, currency }: ForecastChartProps) {
  const [horizon, setHorizon] = useState<HorizonKey>("d90");
  const data = horizons[horizon];
  const locale = localeForCurrency(currency);

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
            <span className="h-0.5 w-4 rounded" style={{ backgroundColor: "var(--chart-net)" }} />
            Actual
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-0 w-4 border-t-2 border-dashed"
              style={{ borderColor: "var(--chart-projected)" }}
            />
            Projected
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-4 rounded-sm opacity-40"
              style={{ backgroundColor: "var(--chart-projected)" }}
            />
            ~80% band
          </span>
        </div>
      </div>

      <div className="h-80 w-full">
        <ChartFigure
          className="h-full w-full"
          label={summarize(data, horizon, currency, locale)}
          table={
            <ChartDataTable
              caption={`Actual and projected cash balance over the next ${HORIZON_LABELS[horizon]}`}
              columns={["Date", "Actual balance", "Projected balance", "Confidence band"]}
              rows={data.map((point) => [
                formatDate(point.date, locale),
                point.actual === null ? "—" : formatCurrency(point.actual, currency, locale),
                point.projected === null
                  ? "—"
                  : formatCurrency(point.projected, currency, locale),
                point.band === null
                  ? "—"
                  : `${formatCurrency(point.band[0], currency, locale)} to ${formatCurrency(point.band[1], currency, locale)}`,
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
                dataKey="date"
                stroke="var(--muted-foreground)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                minTickGap={48}
                tickFormatter={(value: string) => formatTick(value, locale)}
              />
              <YAxis
                stroke="var(--muted-foreground)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                width={64}
                domain={["auto", "auto"]}
                tickFormatter={(value: number) =>
                  new Intl.NumberFormat(locale, { notation: "compact" }).format(value)
                }
              />
              <Tooltip
                formatter={(value, name) => {
                  if (name === "band" && Array.isArray(value)) {
                    return [
                      `${formatCurrency(Number(value[0]), currency, locale)} – ${formatCurrency(Number(value[1]), currency, locale)}`,
                      "Confidence band",
                    ];
                  }
                  return [
                    formatCurrency(Number(value ?? 0), currency, locale),
                    name === "actual" ? "Actual balance" : "Projected balance",
                  ];
                }}
                labelFormatter={(label) => formatDate(String(label), locale)}
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
                fill="var(--chart-projected)"
                fillOpacity={0.15}
                isAnimationActive={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="actual"
                stroke="var(--chart-net)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="projected"
                stroke="var(--chart-projected)"
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartFigure>
      </div>
    </div>
  );
}
