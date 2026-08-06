import "server-only";

import type { AiProvider, NotificationType } from "@/generated/prisma/client";
import { getAiClient, providerFromProfile } from "@/lib/ai";
import { buildFinancialSnapshot, renderSnapshot } from "@/lib/ai/context";
import { BRAND } from "@/lib/branding";
import { buildForecast } from "@/lib/finance/data";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { formatCurrency, localeForCurrency } from "@/lib/utils";

export type SummaryKind = "daily" | "weekly" | "monthly";

const KIND_CONFIG: Record<
  SummaryKind,
  { days: number; label: string; type: NotificationType }
> = {
  daily: { days: 1, label: "the last 24 hours", type: "DAILY_SUMMARY" },
  weekly: { days: 7, label: "the last 7 days", type: "WEEKLY_SUMMARY" },
  monthly: { days: 30, label: "the last 30 days", type: "MONTHLY_SUMMARY" },
};

export interface SummaryDigest {
  type: NotificationType;
  title: string;
  periodLabel: string;
  body: string;
  stats: { label: string; value: string }[];
}

interface SummaryProfile {
  currency: string;
  aiProvider: AiProvider;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How long the AI gets to write one digest body before the deterministic one
 * is used instead.
 *
 * The notification cron writes a digest for every user inside a single
 * invocation with a hard 300s ceiling (see `maxDuration` in
 * src/app/api/cron/notifications/route.ts), so an unbounded call here does not
 * merely delay one digest — it spends the budget of every user still queued
 * behind it, who then silently receive nothing at all. This sits well above a
 * healthy provider's latency for a reply this short, so reaching it means
 * something is actually wrong and the deterministic body is the better answer.
 */
export const SUMMARY_AI_TIMEOUT_MS = 8_000;

/**
 * Builds an AI-written digest of the workspace's finances for the period.
 * Falls back to a deterministic text summary when no AI provider is
 * configured, the call fails, or the AI does not answer within
 * {@link SUMMARY_AI_TIMEOUT_MS} — a digest is always produced.
 */
export async function generateSummary(
  workspaceId: string,
  profile: SummaryProfile,
  kind: SummaryKind,
  options: { timeoutMs?: number } = {}
): Promise<SummaryDigest> {
  const config = KIND_CONFIG[kind];
  const now = new Date();
  const windowStart = new Date(now.getTime() - config.days * MS_PER_DAY);

  const [rows, forecast] = await Promise.all([
    prisma.transaction.findMany({
      where: { workspaceId, date: { gte: windowStart, lte: now } },
      orderBy: { amount: "desc" },
      select: {
        type: true,
        amount: true,
        description: true,
        counterparty: true,
        category: { select: { name: true } },
      },
    }),
    buildForecast(workspaceId, profile.currency),
  ]);

  const currency = profile.currency;
  const locale = localeForCurrency(currency);
  const money = (value: number) => formatCurrency(value, currency, locale);
  let income = 0;
  let expenses = 0;
  for (const row of rows) {
    if (row.type === "INCOME") income += Number(row.amount);
    else expenses += Number(row.amount);
  }
  const net = income - expenses;

  const largest = rows
    .filter((row) => row.type === "EXPENSE")
    .slice(0, 3)
    .map(
      (row) =>
        `${row.counterparty || row.description} (${row.category?.name ?? "Uncategorized"}): ${money(Number(row.amount))}`
    );

  const upcomingBills = forecast.upcomingBills.slice(0, 5);
  const billsText = upcomingBills
    .map((bill) => `${bill.label}: ${money(bill.amount)} due ${bill.dueDate}`)
    .join("; ");

  const runwayText =
    forecast.metrics.runwayMonths === null
      ? "cash-flow positive (no runway limit)"
      : `${Math.round(forecast.metrics.runwayMonths * 10) / 10} months of runway`;

  const stats = [
    { label: "Income", value: money(income) },
    { label: "Expenses", value: money(expenses) },
    { label: "Net", value: money(net) },
    { label: "Balance", value: money(forecast.currentBalance) },
  ];

  const title = `Your ${kind} financial summary`;
  const periodLabel = `Covering ${config.label} · ${now.toISOString().slice(0, 10)}`;

  const body =
    (await generateAiBody(
      workspaceId,
      profile,
      kind,
      config.label,
      {
        transactionCount: rows.length,
        income,
        expenses,
        net,
        largest,
        billsText,
        runwayText,
        projected30d: forecast.metrics.projectedBalance30d,
        currentBalance: forecast.currentBalance,
        currency,
        locale,
      },
      options
    )) ??
    buildFallbackBody(config.label, {
      transactionCount: rows.length,
      income,
      expenses,
      net,
      largest,
      billsText,
      runwayText,
      projected30d: forecast.metrics.projectedBalance30d,
      currency,
      locale,
    });

  return { type: config.type, title, periodLabel, body, stats };
}

interface SummaryFacts {
  transactionCount: number;
  income: number;
  expenses: number;
  net: number;
  largest: string[];
  billsText: string;
  runwayText: string;
  projected30d: number;
  currentBalance?: number;
  currency: string;
  locale: string;
}

async function generateAiBody(
  workspaceId: string,
  profile: SummaryProfile,
  kind: SummaryKind,
  windowLabel: string,
  facts: SummaryFacts,
  options: { timeoutMs?: number } = {}
): Promise<string | null> {
  try {
    const snapshot = await buildFinancialSnapshot(workspaceId, profile.currency);
    const client = getAiClient(providerFromProfile(profile.aiProvider));

    const money = (value: number) => formatCurrency(value, facts.currency, facts.locale);
    const activity = [
      `Window: ${windowLabel}`,
      `Transactions recorded: ${facts.transactionCount}`,
      `Income: ${money(facts.income)}, expenses: ${money(facts.expenses)}, net: ${money(facts.net)}`,
      facts.largest.length > 0 ? `Largest expenses: ${facts.largest.join("; ")}` : "",
      facts.billsText ? `Upcoming bills: ${facts.billsText}` : "No upcoming bills detected.",
      `Forecast: ${facts.runwayText}; projected balance in 30 days ${money(facts.projected30d)}.`,
    ]
      .filter(Boolean)
      .join("\n");

    const text = await client.chat(
      [
        {
          role: "system",
          content:
            `You are ${BRAND.name}, an AI finance assistant. Write the body of a ${kind} financial digest notification. ` +
            "Cover: what happened in the period, notable changes, upcoming bills, and the forecast outlook. " +
            "Use 2-4 short paragraphs and at most one simple list with '-' bullets. Plain text only - no markdown headers, bold, or tables. " +
            "Be specific with amounts, honest about uncertainty, and keep it under 170 words. Do not invent numbers.",
        },
        {
          role: "user",
          content: `FULL FINANCIAL SNAPSHOT:\n${renderSnapshot(snapshot)}\n\nTHIS PERIOD'S ACTIVITY:\n${activity}`,
        },
      ],
      {
        maxTokens: 500,
        signal: AbortSignal.timeout(options.timeoutMs ?? SUMMARY_AI_TIMEOUT_MS),
      }
    );

    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (error) {
    logger.info("AI summary unavailable, using deterministic fallback", {
      detail: error instanceof Error ? error.message : String(error),
      timedOut: error instanceof Error && error.name === "TimeoutError",
    });
    return null;
  }
}

/** Deterministic digest used when no AI provider is configured. */
function buildFallbackBody(windowLabel: string, facts: SummaryFacts): string {
  const parts: string[] = [];
  const fmt = (value: number) => formatCurrency(value, facts.currency, facts.locale);

  if (facts.transactionCount === 0) {
    parts.push(`No transactions were recorded in ${windowLabel}.`);
  } else {
    parts.push(
      `In ${windowLabel} you recorded ${facts.transactionCount} transaction${facts.transactionCount === 1 ? "" : "s"}: ` +
        `${fmt(facts.income)} in, ${fmt(facts.expenses)} out (net ${fmt(facts.net)}).`
    );
  }

  if (facts.largest.length > 0) {
    parts.push(`Largest expenses:\n${facts.largest.map((line) => `- ${line}`).join("\n")}`);
  }

  parts.push(
    facts.billsText ? `Upcoming bills: ${facts.billsText}.` : "No upcoming bills detected."
  );
  parts.push(
    `Forecast outlook: ${facts.runwayText}; projected balance in 30 days is ${fmt(facts.projected30d)}.`
  );

  return parts.join("\n\n");
}
