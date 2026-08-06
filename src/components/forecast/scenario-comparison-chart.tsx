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

import { ChartDataTable, ChartFigure, describeChange } from "@/components/charts/chart-accessibility";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildComparisonSeries,
  scenarioColor,
  scenarioSeriesKey,
  type HorizonKey,
  type ScenarioSeries,
} from "@/lib/finance/scenarios";
import { formatCurrency, formatDate, localeForCurrency } from "@/lib/utils";

interface ScenarioComparisonChartProps {
  /** Primary scenario first; its confidence band is the one drawn. */
  scenarios: ScenarioSeries[];
  currency: string;
}

const HORIZON_LABELS: Record<HorizonKey, string> = {
  d30: "30 days",
  d90: "90 days",
  m12: "12 months",
};

/** Dashes get longer down the list, so the lines are still distinct in print. */
const LINE_DASHES = ["6 4", "2 3", "10 4"];

function formatTick(value: string, locale: string): string {
  return new Date(value).toLocaleDateString(locale, { month: "short", day: "numeric" });
}

function summarize(
  scenarios: ScenarioSeries[],
  horizon: HorizonKey,
  currency: string,
  locale: string
): string {
  const money = (value: number) => formatCurrency(value, currency, locale);
  const ends = scenarios.map((scenario) => {
    const projections = scenario.horizons[horizon].filter((point) => point.projected !== null);
    return { name: scenario.name, end: projections[projections.length - 1]?.projected ?? null };
  });
  const primary = ends[0];
  const primaryEnd = primary?.end;
  if (primary === undefined || primaryEnd === null || primaryEnd === undefined) {
    return `Comparison of ${scenarios.length} forecast scenarios. Not enough history to project.`;
  }

  const start =
    scenarios[0].horizons[horizon].filter((point) => point.actual !== null).slice(-1)[0]?.actual ??
    0;
  const rest = ends
    .slice(1)
    .map((entry) =>
      entry.end === null
        ? `${entry.name} has no projection`
        : `${entry.name} ends at ${money(entry.end)}, ${
            entry.end === primaryEnd
              ? "the same"
              : `${money(Math.abs(entry.end - primaryEnd))} ${entry.end > primaryEnd ? "higher" : "lower"}`
          }`
    )
    .join("; ");

  return (
    `Projected cash balance over the next ${HORIZON_LABELS[horizon]} for ${scenarios.length} scenarios. ` +
    `From ${money(start)}, ${primary.name} is ${describeChange(start, primaryEnd)} ${money(primaryEnd)}. ${rest}.`
  );
}

/**
 * The projected-balance lines of two or three scenarios on one axis.
 *
 * Only the primary scenario keeps its confidence band: three overlapping
 * translucent bands say nothing a reader can act on, and the comparison is
 * about the gap between the lines, not the width of each.
 */
export function ScenarioComparisonChart({ scenarios, currency }: ScenarioComparisonChartProps) {
  const [horizon, setHorizon] = useState<HorizonKey>("d90");
  const locale = localeForCurrency(currency);
  const data = buildComparisonSeries(scenarios, horizon);
  const nameByKey = new Map(
    scenarios.map((scenario, index) => [scenarioSeriesKey(index), scenario.name])
  );

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
        <div className="text-muted-foreground flex flex-wrap gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ backgroundColor: "var(--chart-net)" }} />
            Actual
          </span>
          {scenarios.map((scenario, index) => (
            <span key={scenario.id} className="flex items-center gap-1.5">
              <span
                className="h-0 w-4 border-t-2"
                style={{
                  borderColor: scenarioColor(index),
                  borderTopStyle: "dashed",
                }}
              />
              {scenario.name}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-4 rounded-sm opacity-40"
              style={{ backgroundColor: scenarioColor(0) }}
            />
            ~80% band ({scenarios[0]?.name})
          </span>
        </div>
      </div>

      <div className="h-80 w-full">
        <ChartFigure
          className="h-full w-full"
          label={summarize(scenarios, horizon, currency, locale)}
          table={
            <ChartDataTable
              caption={`Projected cash balance per scenario over the next ${HORIZON_LABELS[horizon]}`}
              columns={[
                "Date",
                "Actual balance",
                ...scenarios.map((scenario) => `${scenario.name} (projected)`),
              ]}
              rows={data.map((row) => [
                formatDate(row.date, locale),
                row.actual === null ? "—" : formatCurrency(row.actual, currency, locale),
                ...scenarios.map((_, index) => {
                  const value = row[scenarioSeriesKey(index)];
                  return typeof value === "number"
                    ? formatCurrency(value, currency, locale)
                    : "—";
                }),
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
                    name === "actual" ? "Actual balance" : (nameByKey.get(String(name)) ?? name),
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
                fill={scenarioColor(0)}
                fillOpacity={0.12}
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
              {scenarios.map((scenario, index) => (
                <Line
                  key={scenario.id}
                  type="monotone"
                  dataKey={scenarioSeriesKey(index)}
                  stroke={scenarioColor(index)}
                  strokeWidth={2}
                  strokeDasharray={LINE_DASHES[index % LINE_DASHES.length]}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </ChartFigure>
      </div>
    </div>
  );
}
