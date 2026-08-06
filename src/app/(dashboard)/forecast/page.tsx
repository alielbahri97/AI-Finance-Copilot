import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarClockIcon,
  FlameIcon,
  HourglassIcon,
  LayersIcon,
  LockIcon,
  RepeatIcon,
  WalletIcon,
} from "lucide-react";

import {
  ChartRowSkeleton,
  StatRowSkeleton,
} from "@/components/dashboard/section-skeletons";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  AssumptionsManager,
  type AssumptionItem,
} from "@/components/forecast/assumptions-manager";
import { ExplainForecast } from "@/components/forecast/explain-forecast";
import { ForecastChart } from "@/components/forecast/forecast-chart-lazy";
import { RecurringTable } from "@/components/forecast/recurring-table";
import { ScenarioComparisonChart } from "@/components/forecast/scenario-comparison-chart-lazy";
import { ScenarioDeltaTable } from "@/components/forecast/scenario-delta-table";
import { ScenarioSwitcher } from "@/components/forecast/scenario-switcher";
import { UpcomingBills } from "@/components/forecast/upcoming-bills";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/page-heading";
import { getEntitlements } from "@/lib/billing/entitlements";
import { buildScenarioForecasts, loadScenarioData } from "@/lib/finance/scenario-data";
import {
  assumptionsInScenario,
  BASE_SCENARIO_ID,
  canAddScenario,
  resolveActiveScenarioId,
  resolveComparedScenarioIds,
  scenarioDeltas,
  toScenarioSeries,
} from "@/lib/finance/scenarios";
import { formatCurrency, localeForCurrency } from "@/lib/utils";
import { getWorkspaceContext, type WorkspaceContext } from "@/lib/workspace/context";

export const metadata: Metadata = { title: "Forecast" };
export const dynamic = "force-dynamic";

function runwayDisplay(months: number | null): { value: string; hint: string } {
  if (months === null) {
    return { value: "∞", hint: "Projected cash-flow positive" };
  }
  if (months <= 0) {
    return { value: "0 months", hint: "Balance is already at or below zero" };
  }
  return {
    value: `${Math.round(months * 10) / 10} months`,
    hint: "Until cash reaches zero on the current trajectory",
  };
}

/** A repeated query parameter is a hand-edited URL; take the first value. */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Streams: the header paints immediately, the forecast body follows. */
export default async function ForecastPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string | string[]; compare?: string | string[] }>;
}) {
  const ctx = await getWorkspaceContext();
  if (!ctx) redirect("/login");
  if (!ctx.permissions.has("view_reports")) redirect("/dashboard");

  const params = await searchParams;
  const scenarioParam = firstValue(params.scenario);
  const compareParam = firstValue(params.compare);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageHeading>Cash flow forecast</PageHeading>
        <p className="text-muted-foreground text-sm">
          Deterministic projection from your recurring patterns, spending trend and assumptions.
        </p>
      </div>

      <Suspense
        key={`${scenarioParam ?? ""}|${compareParam ?? ""}`}
        fallback={
          <>
            <StatRowSkeleton />
            <ChartRowSkeleton />
          </>
        }
      >
        <ForecastContent ctx={ctx} scenarioParam={scenarioParam} compareParam={compareParam} />
      </Suspense>
    </div>
  );
}

async function ForecastContent({
  ctx,
  scenarioParam,
  compareParam,
}: {
  ctx: WorkspaceContext;
  scenarioParam?: string;
  compareParam?: string;
}) {
  const workspaceId = ctx.workspace.id;
  const currency = ctx.workspace.currency;

  // The scenarios and every assumption in one pass, shared by the switcher, the
  // assumptions manager and the engine — which then runs once per scenario over
  // one load of history.
  const data = await loadScenarioData(workspaceId);
  const activeId = resolveActiveScenarioId(scenarioParam, data.scenarios);
  const comparedIds = resolveComparedScenarioIds(activeId, compareParam, data.scenarios);

  const [compared, entitlements] = await Promise.all([
    buildScenarioForecasts(workspaceId, currency, comparedIds, data),
    getEntitlements(workspaceId),
  ]);

  const forecast = compared[0].forecast;
  const active = data.scenarios.find((scenario) => scenario.id === activeId);
  const isComparing = compared.length > 1;

  const assumptionsUnlocked = entitlements.plan.limits.assumptionsEnabled;
  const namedScenarios = data.scenarios.filter((scenario) => scenario.id !== BASE_SCENARIO_ID);
  // A workspace that downgrades keeps the scenarios it named: it can still read,
  // rename and delete them, it just cannot add more.
  const showScenarios = assumptionsUnlocked || namedScenarios.length > 0;
  const canCreateScenario =
    assumptionsUnlocked &&
    canAddScenario(namedScenarios.length, entitlements.plan.limits.maxScenarios).allowed;

  const assumptions: AssumptionItem[] = assumptionsInScenario(data.assumptions, activeId).map(
    (row) => ({
      id: row.id,
      kind: row.kind,
      type: row.type,
      label: row.label,
      amount: row.amount === null ? null : Number(row.amount),
      percent: row.percent === null ? null : Number(row.percent),
      date: row.date?.toISOString().slice(0, 10) ?? null,
      startDate: row.startDate?.toISOString().slice(0, 10) ?? null,
      endDate: row.endDate?.toISOString().slice(0, 10) ?? null,
      enabled: row.enabled,
    })
  );

  const { metrics } = forecast;
  const runway = runwayDisplay(metrics.runwayMonths);
  const isBurning = metrics.netBurnRate > 0;
  const money = (value: number) => formatCurrency(value, currency, localeForCurrency(currency));

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Cash runway"
          value={runway.value}
          hint={runway.hint}
          icon={HourglassIcon}
          tone={metrics.runwayMonths === null ? "positive" : metrics.runwayMonths < 6 ? "negative" : "default"}
        />
        <StatCard
          title={isBurning ? "Net burn rate" : "Net cash added"}
          value={`${money(Math.abs(metrics.netBurnRate))}/mo`}
          hint={`Gross expenses ${money(metrics.grossBurnRate)}/mo (3-month avg)`}
          icon={FlameIcon}
          tone={isBurning ? "negative" : "positive"}
        />
        <StatCard
          title="Recurring expenses"
          value={`${money(metrics.recurringMonthlyExpenses)}/mo`}
          hint={`Recurring income ${money(metrics.recurringMonthlyIncome)}/mo`}
          icon={RepeatIcon}
        />
        <StatCard
          title="Balance in 30 days"
          value={money(metrics.projectedBalance30d)}
          hint={`90 days: ${money(metrics.projectedBalance90d)} · 12 months: ${money(metrics.projectedBalance12m)}`}
          icon={WalletIcon}
          tone={metrics.projectedBalance30d >= 0 ? "default" : "negative"}
        />
      </div>

      {showScenarios ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayersIcon className="size-4" />
              Scenarios
            </CardTitle>
            <CardDescription>
              Keep a named set of assumptions per plan you are weighing up, and put two or three on
              the same chart
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScenarioSwitcher
              scenarios={data.scenarios}
              activeId={activeId}
              comparedIds={comparedIds}
              canCreate={canCreateScenario}
              // Null hides the quota line, which is the right answer for a
              // workspace whose plan no longer includes scenarios at all.
              scenarioLimit={assumptionsUnlocked ? entitlements.plan.limits.maxScenarios : null}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Projected balance</CardTitle>
          <CardDescription>
            {isComparing
              ? `${compared.map((entry) => entry.name).join(" vs ")} — historical actuals once, one projected line per scenario, with the confidence band on ${compared[0].name}`
              : "Historical actuals and the projected trajectory with an ~80% confidence band"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isComparing ? (
            <ScenarioComparisonChart scenarios={toScenarioSeries(compared)} currency={currency} />
          ) : (
            <ForecastChart horizons={forecast.horizons} currency={currency} />
          )}
        </CardContent>
      </Card>

      {isComparing ? (
        <Card>
          <CardHeader>
            <CardTitle>Where the scenarios end up</CardTitle>
            <CardDescription>
              Cash at each horizon and how long it lasts, against {compared[0].name}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScenarioDeltaTable deltas={scenarioDeltas(compared)} currency={currency} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>AI explanation</CardTitle>
          <CardDescription>
            {isComparing
              ? "What separates these scenarios, and which assumptions are behind it"
              : "Drivers, risks and recommendations for this forecast"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ExplainForecast
            scenarioId={activeId}
            comparedIds={comparedIds}
            comparedNames={compared.map((entry) => entry.name)}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Assumptions</CardTitle>
            <CardDescription>
              One-off amounts, monthly adjustments and % growth applied to the projection
            </CardDescription>
          </CardHeader>
          <CardContent>
            {assumptionsUnlocked ? (
              <AssumptionsManager
                assumptions={assumptions}
                currency={currency}
                scenarioId={activeId}
                scenarioName={namedScenarios.length > 0 ? active?.name : undefined}
              />
            ) : (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <div className="bg-muted flex size-10 items-center justify-center rounded-full">
                  <LockIcon className="text-muted-foreground size-5" />
                </div>
                <p className="text-sm font-medium">
                  What-if assumptions and scenarios are a Pro feature
                </p>
                <p className="text-muted-foreground max-w-sm text-sm">
                  Model new hires, expected payments and growth on top of your forecast — then keep
                  them as named scenarios and compare two or three side by side.
                </p>
                <Button asChild size="sm">
                  <Link href="/billing">Upgrade plan</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClockIcon className="size-4" />
              Upcoming bills
            </CardTitle>
            <CardDescription>Projected recurring payments over the next 45 days</CardDescription>
          </CardHeader>
          <CardContent>
            <UpcomingBills bills={forecast.upcomingBills} currency={currency} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recurring expenses</CardTitle>
            <CardDescription>
              Detected from your history · {money(metrics.recurringMonthlyExpenses)}
              /month total
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RecurringTable
              items={forecast.recurringExpenses}
              currency={currency}
              emptyTitle="No recurring expenses detected yet"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recurring income</CardTitle>
            <CardDescription>
              Detected from your history · {money(metrics.recurringMonthlyIncome)}
              /month total
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RecurringTable
              items={forecast.recurringIncome}
              currency={currency}
              emptyTitle="No recurring income detected yet"
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
