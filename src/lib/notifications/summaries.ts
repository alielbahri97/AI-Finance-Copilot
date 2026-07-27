import "server-only";

import type { AiProvider, NotificationType } from "@/generated/prisma/client";
import { getAiClient } from "@/lib/ai";
import { buildFinancialSnapshot, renderSnapshot } from "@/lib/ai/context";
import { buildForecast } from "@/lib/finance/data";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";

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
 * Builds an AI-written digest of the user's finances for the period. Falls
 * back to a deterministic text summary when no AI provider is configured or
 * the call fails — a digest is always produced.
 */
export async function generateSummary(
  userId: string,
  profile: SummaryProfile,
  kind: SummaryKind
): Promise<SummaryDigest> {
  const config = KIND_CONFIG[kind];
  const now = new Date();
  const windowStart = new Date(now.getTime() - config.days * MS_PER_DAY);

  const [rows, forecast] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId, date: { gte: windowStart, lte: now } },
      orderBy: { amount: "desc" },
      select: {
        type: true,
        amount: true,
        description: true,
        counterparty: true,
        category: { select: { name: true } },
      },
    }),
    buildForecast(userId, profile.currency),
  ]);

  const currency = profile.currency;
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
        `${row.counterparty || row.description} (${row.category?.name ?? "Uncategorized"}): ${formatCurrency(Number(row.amount), currency)}`
    );

  const upcomingBills = forecast.upcomingBills.slice(0, 5);
  const billsText = upcomingBills
    .map((bill) => `${bill.label}: ${formatCurrency(bill.amount, currency)} due ${bill.dueDate}`)
    .join("; ");

  const runwayText =
    forecast.metrics.runwayMonths === null
      ? "cash-flow positive (no runway limit)"
      : `${Math.round(forecast.metrics.runwayMonths * 10) / 10} months of runway`;

  const stats = [
    { label: "Income", value: formatCurrency(income, currency) },
    { label: "Expenses", value: formatCurrency(expenses, currency) },
    { label: "Net", value: formatCurrency(net, currency) },
    { label: "Balance", value: formatCurrency(forecast.currentBalance, currency) },
  ];

  const title = `Your ${kind} financial summary`;
  const periodLabel = `Covering ${config.label} · ${now.toISOString().slice(0, 10)}`;

  const body =
    (await generateAiBody(userId, profile, kind, config.label, {
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
    })) ??
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
}

async function generateAiBody(
  userId: string,
  profile: SummaryProfile,
  kind: SummaryKind,
  windowLabel: string,
  facts: SummaryFacts
): Promise<string | null> {
  try {
    const snapshot = await buildFinancialSnapshot(userId, profile.currency);
    const client = getAiClient(profile.aiProvider === "ANTHROPIC" ? "anthropic" : "openai");

    const activity = [
      `Window: ${windowLabel}`,
      `Transactions recorded: ${facts.transactionCount}`,
      `Income: ${formatCurrency(facts.income, facts.currency)}, expenses: ${formatCurrency(facts.expenses, facts.currency)}, net: ${formatCurrency(facts.net, facts.currency)}`,
      facts.largest.length > 0 ? `Largest expenses: ${facts.largest.join("; ")}` : "",
      facts.billsText ? `Upcoming bills: ${facts.billsText}` : "No upcoming bills detected.",
      `Forecast: ${facts.runwayText}; projected balance in 30 days ${formatCurrency(facts.projected30d, facts.currency)}.`,
    ]
      .filter(Boolean)
      .join("\n");

    const text = await client.chat(
      [
        {
          role: "system",
          content:
            `You are FinPilot, an AI finance copilot. Write the body of a ${kind} financial digest notification. ` +
            "Cover: what happened in the period, notable changes, upcoming bills, and the forecast outlook. " +
            "Use 2-4 short paragraphs and at most one simple list with '-' bullets. Plain text only - no markdown headers, bold, or tables. " +
            "Be specific with amounts, honest about uncertainty, and keep it under 170 words. Do not invent numbers.",
        },
        {
          role: "user",
          content: `FULL FINANCIAL SNAPSHOT:\n${renderSnapshot(snapshot)}\n\nTHIS PERIOD'S ACTIVITY:\n${activity}`,
        },
      ],
      { maxTokens: 500 }
    );

    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (error) {
    console.log(
      `[notifications] AI summary unavailable, using fallback: ${error instanceof Error ? error.message : error}`
    );
    return null;
  }
}

/** Deterministic digest used when no AI provider is configured. */
function buildFallbackBody(windowLabel: string, facts: SummaryFacts): string {
  const parts: string[] = [];
  const fmt = (value: number) => formatCurrency(value, facts.currency);

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
