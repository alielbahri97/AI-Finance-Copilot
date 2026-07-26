import {
  detectRecurring,
  nextOccurrences,
  type FinanceTransaction,
  type RecurringItem,
} from "./recurrence";

/**
 * Deterministic cash-flow forecast engine.
 *
 * Methodology (no ML, fully explainable):
 * 1. Recurring income/expense items are detected from 12 months of history
 *    (stable amount + consistent interval) and scheduled forward at their
 *    cadence, each occurrence landing on its projected date.
 * 2. The non-recurring remainder is projected with a least-squares linear
 *    trend over the last six full months of income and expenses (recurring
 *    monthly equivalents subtracted first, results clamped at zero) and
 *    spread evenly across the days of each future month.
 * 3. User assumptions are applied on top: one-off amounts on their date,
 *    monthly recurring adjustments on their day-of-month within their active
 *    window, and % growth assumptions compounding monthly on the organic
 *    (trend + recurring) flows of their side.
 * 4. The confidence band is +/- 1.28 standard deviations of historical
 *    monthly net (an ~80% band), widening with the square root of elapsed
 *    time.
 */

export interface AssumptionInput {
  id: string;
  kind: "ONE_OFF" | "RECURRING" | "PERCENT_GROWTH";
  type: "INCOME" | "EXPENSE";
  label: string;
  amount: number | null;
  percent: number | null;
  date: Date | null;
  startDate: Date | null;
  endDate: Date | null;
  enabled: boolean;
}

export interface ForecastPoint {
  date: string;
  actual: number | null;
  projected: number | null;
  /** [low, high] confidence band, present on projected points. */
  band: [number, number] | null;
}

export interface UpcomingBill {
  label: string;
  category: string;
  amount: number;
  dueDate: string;
  cadence: string;
  source: "detected" | "assumption";
}

export interface ForecastMetrics {
  /** Months until cash hits zero at the projected trajectory; null = cash-flow positive. */
  runwayMonths: number | null;
  /** Average monthly net outflow over the last 3 full months (positive = burning cash). */
  netBurnRate: number;
  /** Average monthly expenses over the last 3 full months. */
  grossBurnRate: number;
  avgMonthlyIncome: number;
  avgMonthlyExpenses: number;
  recurringMonthlyIncome: number;
  recurringMonthlyExpenses: number;
  projectedBalance30d: number;
  projectedBalance90d: number;
  projectedBalance12m: number;
}

export interface ForecastResult {
  currency: string;
  generatedAt: string;
  currentBalance: number;
  metrics: ForecastMetrics;
  horizons: {
    d30: ForecastPoint[];
    d90: ForecastPoint[];
    m12: ForecastPoint[];
  };
  recurringIncome: RecurringItem[];
  recurringExpenses: RecurringItem[];
  upcomingBills: UpcomingBill[];
  activeAssumptions: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30.44;
const SIM_DAYS = 400; // covers 12 calendar months ahead with margin
const BAND_Z = 1.28; // ~80% confidence

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function monthIndex(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

function daysInMonthOf(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function linearTrend(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: values[0] };
  const xMean = (n - 1) / 2;
  const yMean = mean(values);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (values[i] - yMean);
    denominator += (i - xMean) ** 2;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  return { slope, intercept: yMean - slope * xMean };
}

export interface ForecastInputs {
  transactions: FinanceTransaction[];
  /** Net balance of everything before the 12-month window. */
  priorNet: number;
  assumptions: AssumptionInput[];
  currency: string;
  now: Date;
}

/** Pure computation, separated from data access for clarity and testability. */
export function computeForecast(inputs: ForecastInputs): ForecastResult {
  const { transactions, priorNet, assumptions, currency } = inputs;
  const today = utcDay(inputs.now);
  const todayIso = isoDay(today);
  const currentMonthIndex = monthIndex(today);

  /* ---- Historical daily balance over the 12-month window ---- */
  const dailyNet = new Map<string, number>();
  let windowNet = 0;
  for (const tx of transactions) {
    const signed = tx.type === "INCOME" ? tx.amount : -tx.amount;
    const day = isoDay(tx.date);
    dailyNet.set(day, (dailyNet.get(day) ?? 0) + signed);
    windowNet += signed;
  }
  const currentBalance = round2(priorNet + windowNet);

  const historyStart = new Date(today.getTime() - 365 * MS_PER_DAY);
  const actualBalanceByDay = new Map<string, number>();
  {
    let running = priorNet;
    // Transactions dated before historyStart but inside the fetch window
    // (edge days) are folded into the opening balance.
    for (const [day, net] of dailyNet) {
      if (day < isoDay(historyStart)) running += net;
    }
    for (let t = historyStart.getTime(); t <= today.getTime(); t += MS_PER_DAY) {
      const day = isoDay(new Date(t));
      running += dailyNet.get(day) ?? 0;
      actualBalanceByDay.set(day, round2(running));
    }
    // Ensure the boundary point matches the exact current balance.
    actualBalanceByDay.set(todayIso, currentBalance);
  }

  /* ---- Monthly history (full months only) ---- */
  const monthlyIncome = new Map<number, number>();
  const monthlyExpenses = new Map<number, number>();
  for (const tx of transactions) {
    const index = monthIndex(tx.date);
    if (index >= currentMonthIndex) continue; // exclude the partial current month
    const map = tx.type === "INCOME" ? monthlyIncome : monthlyExpenses;
    map.set(index, (map.get(index) ?? 0) + tx.amount);
  }

  const trendMonths: number[] = [];
  for (let i = 6; i >= 1; i--) trendMonths.push(currentMonthIndex - i);
  const activeTrendMonths = trendMonths.filter(
    (index) => (monthlyIncome.get(index) ?? 0) > 0 || (monthlyExpenses.get(index) ?? 0) > 0
  );
  const incomeSeries = activeTrendMonths.map((index) => monthlyIncome.get(index) ?? 0);
  const expenseSeries = activeTrendMonths.map((index) => monthlyExpenses.get(index) ?? 0);
  const netSeries = activeTrendMonths.map(
    (index) => (monthlyIncome.get(index) ?? 0) - (monthlyExpenses.get(index) ?? 0)
  );

  const incomeTrend = linearTrend(incomeSeries);
  const expenseTrend = linearTrend(expenseSeries);
  const trendLength = incomeSeries.length;
  const monthlyNetStd = stdDev(netSeries);

  /* ---- Recurring detection & monthly equivalents ---- */
  const recurring = detectRecurring(transactions);
  const recurringIncome = recurring.filter((item) => item.type === "INCOME");
  const recurringExpenses = recurring.filter((item) => item.type === "EXPENSE");
  const recurringMonthlyIncome = recurringIncome.reduce((sum, item) => sum + item.monthlyAmount, 0);
  const recurringMonthlyExpenses = recurringExpenses.reduce(
    (sum, item) => sum + item.monthlyAmount,
    0
  );

  /* ---- Schedule recurring occurrences across the simulation window ---- */
  const simStart = new Date(today.getTime() + MS_PER_DAY);
  const simEnd = new Date(today.getTime() + SIM_DAYS * MS_PER_DAY);
  const recurringIncomeByDay = new Map<string, number>();
  const recurringExpenseByDay = new Map<string, number>();
  for (const item of recurring) {
    const target = item.type === "INCOME" ? recurringIncomeByDay : recurringExpenseByDay;
    for (const occurrence of nextOccurrences(item, simStart, simEnd)) {
      const day = isoDay(occurrence);
      target.set(day, (target.get(day) ?? 0) + item.averageAmount);
    }
  }

  /* ---- Assumptions ---- */
  const enabledAssumptions = assumptions.filter((assumption) => assumption.enabled);
  const oneOffByDay = new Map<string, number>();
  const monthlyAdjustments: {
    signed: number;
    dayOfMonth: number;
    from: number; // month index
    to: number;
  }[] = [];
  const growth: { type: "INCOME" | "EXPENSE"; monthlyRate: number; from: number; to: number }[] =
    [];

  for (const assumption of enabledAssumptions) {
    const sign = assumption.type === "INCOME" ? 1 : -1;
    if (assumption.kind === "ONE_OFF" && assumption.date && assumption.amount !== null) {
      const day = isoDay(utcDay(assumption.date));
      if (day > todayIso && utcDay(assumption.date) <= simEnd) {
        oneOffByDay.set(day, (oneOffByDay.get(day) ?? 0) + sign * assumption.amount);
      }
    } else if (assumption.kind === "RECURRING" && assumption.amount !== null) {
      monthlyAdjustments.push({
        signed: sign * assumption.amount,
        dayOfMonth: assumption.startDate ? utcDay(assumption.startDate).getUTCDate() : 1,
        from: assumption.startDate
          ? Math.max(monthIndex(assumption.startDate), currentMonthIndex)
          : currentMonthIndex,
        to: assumption.endDate ? monthIndex(assumption.endDate) : Number.MAX_SAFE_INTEGER,
      });
    } else if (assumption.kind === "PERCENT_GROWTH" && assumption.percent !== null) {
      growth.push({
        type: assumption.type,
        monthlyRate: assumption.percent / 100,
        from: assumption.startDate ? monthIndex(assumption.startDate) : currentMonthIndex,
        to: assumption.endDate ? monthIndex(assumption.endDate) : Number.MAX_SAFE_INTEGER,
      });
    }
  }

  function growthMultiplier(type: "INCOME" | "EXPENSE", index: number): number {
    let multiplier = 1;
    for (const entry of growth) {
      if (entry.type !== type || index < entry.from || index > entry.to) continue;
      // Compound over the months elapsed since the growth became active.
      const monthsActive = Math.max(0, index - Math.max(entry.from, currentMonthIndex)) + 1;
      multiplier *= (1 + entry.monthlyRate) ** monthsActive;
    }
    return multiplier;
  }

  /* ---- Daily simulation ---- */
  const projectedByDay = new Map<string, { balance: number; low: number; high: number }>();
  let balance = currentBalance;

  for (let step = 1; step <= SIM_DAYS; step++) {
    const date = new Date(today.getTime() + step * MS_PER_DAY);
    const day = isoDay(date);
    const index = monthIndex(date);
    const monthsAhead = index - currentMonthIndex;
    const daysInMonth = daysInMonthOf(date);

    // Trend projection for this month (x continues the fitted series).
    const x = trendLength + monthsAhead;
    const trendIncome =
      trendLength >= 2
        ? Math.max(0, incomeTrend.intercept + incomeTrend.slope * x)
        : mean(incomeSeries);
    const trendExpenses =
      trendLength >= 2
        ? Math.max(0, expenseTrend.intercept + expenseTrend.slope * x)
        : mean(expenseSeries);

    // Non-recurring remainder, spread across the days of the month.
    const nonRecIncomeDaily = Math.max(0, trendIncome - recurringMonthlyIncome) / daysInMonth;
    const nonRecExpenseDaily = Math.max(0, trendExpenses - recurringMonthlyExpenses) / daysInMonth;

    const incomeFlow =
      (nonRecIncomeDaily + (recurringIncomeByDay.get(day) ?? 0)) *
      growthMultiplier("INCOME", index);
    const expenseFlow =
      (nonRecExpenseDaily + (recurringExpenseByDay.get(day) ?? 0)) *
      growthMultiplier("EXPENSE", index);

    let net = incomeFlow - expenseFlow;

    net += oneOffByDay.get(day) ?? 0;
    for (const adjustment of monthlyAdjustments) {
      if (index < adjustment.from || index > adjustment.to) continue;
      const applyDay = Math.min(adjustment.dayOfMonth, daysInMonth);
      if (date.getUTCDate() === applyDay) net += adjustment.signed;
    }

    balance += net;
    const bandWidth = BAND_Z * monthlyNetStd * Math.sqrt(step / DAYS_PER_MONTH);
    projectedByDay.set(day, {
      balance: round2(balance),
      low: round2(balance - bandWidth),
      high: round2(balance + bandWidth),
    });
  }

  /* ---- Chart series ---- */
  function dailySeries(historyDays: number, futureDays: number): ForecastPoint[] {
    const points: ForecastPoint[] = [];
    for (let offset = historyDays; offset >= 1; offset--) {
      const day = isoDay(new Date(today.getTime() - offset * MS_PER_DAY));
      points.push({
        date: day,
        actual: actualBalanceByDay.get(day) ?? null,
        projected: null,
        band: null,
      });
    }
    // Boundary point keeps the actual and projected lines connected.
    points.push({
      date: todayIso,
      actual: currentBalance,
      projected: currentBalance,
      band: [currentBalance, currentBalance],
    });
    for (let step = 1; step <= futureDays; step++) {
      const day = isoDay(new Date(today.getTime() + step * MS_PER_DAY));
      const entry = projectedByDay.get(day);
      if (!entry) continue;
      points.push({
        date: day,
        actual: null,
        projected: entry.balance,
        band: [entry.low, entry.high],
      });
    }
    return points;
  }

  function monthlySeries(): ForecastPoint[] {
    const points: ForecastPoint[] = [];
    for (let back = 12; back >= 1; back--) {
      const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back + 1, 0));
      if (end.getTime() < historyStart.getTime()) continue;
      const day = isoDay(end);
      points.push({
        date: day,
        actual: actualBalanceByDay.get(day) ?? null,
        projected: null,
        band: null,
      });
    }
    points.push({
      date: todayIso,
      actual: currentBalance,
      projected: currentBalance,
      band: [currentBalance, currentBalance],
    });
    for (let ahead = 0; ahead <= 12; ahead++) {
      const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + ahead + 1, 0));
      const capped = end.getTime() > simEnd.getTime() ? simEnd : end;
      const entry = projectedByDay.get(isoDay(capped));
      if (!entry) continue;
      points.push({
        date: isoDay(capped),
        actual: null,
        projected: entry.balance,
        band: [entry.low, entry.high],
      });
    }
    return points;
  }

  /* ---- Metrics ---- */
  const recentMonths = [1, 2, 3].map((back) => currentMonthIndex - back);
  const recentIncome = recentMonths.map((index) => monthlyIncome.get(index) ?? 0);
  const recentExpenses = recentMonths.map((index) => monthlyExpenses.get(index) ?? 0);
  const grossBurnRate = round2(mean(recentExpenses));
  const avgMonthlyIncome = round2(mean(recentIncome));
  const netBurnRate = round2(grossBurnRate - avgMonthlyIncome);

  const balanceAt = (days: number): number =>
    projectedByDay.get(isoDay(new Date(today.getTime() + days * MS_PER_DAY)))?.balance ??
    currentBalance;

  // Runway: first projected zero-crossing; extrapolate past the simulation if
  // the trajectory is still downward at its end.
  let runwayMonths: number | null = null;
  if (currentBalance <= 0) {
    runwayMonths = 0;
  } else {
    for (let step = 1; step <= SIM_DAYS; step++) {
      const day = isoDay(new Date(today.getTime() + step * MS_PER_DAY));
      const entry = projectedByDay.get(day);
      if (entry && entry.balance <= 0) {
        runwayMonths = round2(step / DAYS_PER_MONTH);
        break;
      }
    }
    if (runwayMonths === null) {
      const endBalance = balanceAt(SIM_DAYS);
      const lastMonthNet = balanceAt(SIM_DAYS) - balanceAt(SIM_DAYS - 30);
      if (lastMonthNet < 0) {
        runwayMonths = round2(SIM_DAYS / DAYS_PER_MONTH + endBalance / Math.abs(lastMonthNet));
      }
    }
  }

  const monthly12 = monthlySeries();
  const lastMonthly = monthly12[monthly12.length - 1];

  /* ---- Upcoming bills (next 45 days) ---- */
  const billsWindowEnd = new Date(today.getTime() + 45 * MS_PER_DAY);
  const upcomingBills: UpcomingBill[] = [];
  for (const item of recurringExpenses) {
    for (const occurrence of nextOccurrences(item, simStart, billsWindowEnd)) {
      upcomingBills.push({
        label: item.label,
        category: item.category,
        amount: item.averageAmount,
        dueDate: isoDay(occurrence),
        cadence: item.cadence,
        source: "detected",
      });
    }
  }
  for (const assumption of enabledAssumptions) {
    if (assumption.kind !== "RECURRING" || assumption.type !== "EXPENSE") continue;
    if (assumption.amount === null) continue;
    const dayOfMonth = assumption.startDate ? utcDay(assumption.startDate).getUTCDate() : 1;
    const from = assumption.startDate ? monthIndex(assumption.startDate) : currentMonthIndex;
    const to = assumption.endDate ? monthIndex(assumption.endDate) : Number.MAX_SAFE_INTEGER;
    for (let ahead = 0; ahead <= 2; ahead++) {
      const index = currentMonthIndex + ahead;
      if (index < from || index > to) continue;
      const year = Math.floor(index / 12);
      const month = index % 12;
      const date = new Date(
        Date.UTC(year, month, Math.min(dayOfMonth, new Date(Date.UTC(year, month + 1, 0)).getUTCDate()))
      );
      if (date <= today || date > billsWindowEnd) continue;
      upcomingBills.push({
        label: assumption.label,
        category: "Assumption",
        amount: assumption.amount,
        dueDate: isoDay(date),
        cadence: "monthly",
        source: "assumption",
      });
    }
  }
  upcomingBills.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return {
    currency,
    generatedAt: todayIso,
    currentBalance,
    metrics: {
      runwayMonths,
      netBurnRate,
      grossBurnRate,
      avgMonthlyIncome,
      avgMonthlyExpenses: grossBurnRate,
      recurringMonthlyIncome: round2(recurringMonthlyIncome),
      recurringMonthlyExpenses: round2(recurringMonthlyExpenses),
      projectedBalance30d: balanceAt(30),
      projectedBalance90d: balanceAt(90),
      projectedBalance12m: lastMonthly?.projected ?? balanceAt(365),
    },
    horizons: {
      d30: dailySeries(30, 30),
      d90: dailySeries(90, 90),
      m12: monthly12,
    },
    recurringIncome,
    recurringExpenses,
    upcomingBills: upcomingBills.slice(0, 15),
    activeAssumptions: enabledAssumptions.length,
  };
}

