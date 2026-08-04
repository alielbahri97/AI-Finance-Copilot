import "server-only";

import { logger, serializeError } from "@/lib/logger";

import type { NotificationPreference } from "@/generated/prisma/client";
import { buildForecast } from "@/lib/finance/data";
import { getInvoiceReminders } from "@/lib/invoices/reminders";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";

import { dispatchNotification, type DispatchTarget } from "./dispatch";
import { renderAlertEmail } from "./email";
import { getOrCreatePreferences } from "./preferences";
import { listNotifiableMembers } from "./recipients";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Large transactions (evaluated inline on create/import)              */
/* ------------------------------------------------------------------ */

export interface AlertCandidate {
  type: "INCOME" | "EXPENSE";
  amount: number;
  description: string;
  counterparty: string | null;
  date: Date;
}

/**
 * A transaction is "large" when it exceeds a member's configured threshold,
 * or when it is an expense far above the workspace's statistical norm
 * (mean + 3 standard deviations over the last 90 days, minimum 10 samples).
 * Workspace-aware: every member with view_transactions permission is
 * evaluated against their own notification preferences.
 */
export async function evaluateLargeTransactions(
  workspaceId: string,
  currency: string,
  candidates: AlertCandidate[]
): Promise<void> {
  try {
    const members = await listNotifiableMembers(workspaceId, "view_transactions");
    if (members.length === 0) return;

    // Statistical norm from recent expense history (before this batch).
    const history = await prisma.transaction.findMany({
      where: {
        workspaceId,
        type: "EXPENSE",
        date: { gte: new Date(Date.now() - 90 * MS_PER_DAY) },
      },
      select: { amount: true },
      take: 2000,
    });
    let statLimit = Number.POSITIVE_INFINITY;
    if (history.length >= 10) {
      const amounts = history.map((row) => Number(row.amount));
      const mean = amounts.reduce((sum, value) => sum + value, 0) / amounts.length;
      const variance =
        amounts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / amounts.length;
      statLimit = mean + 3 * Math.sqrt(variance);
    }

    const describe = (tx: AlertCandidate) =>
      `${tx.type === "EXPENSE" ? "-" : "+"}${formatCurrency(tx.amount, currency)} ${tx.counterparty || tx.description}`;

    // Post to the workspace's Slack/Teams channel once, not once per member.
    let chatPosted = false;

    for (const member of members) {
      const prefs = await getOrCreatePreferences(member.userId);
      if (!prefs.largeTransaction) continue;

      const threshold = Number(prefs.largeTransactionThreshold);
      const large = candidates.filter(
        (tx) =>
          (threshold > 0 && tx.amount >= threshold) ||
          (tx.type === "EXPENSE" && tx.amount >= statLimit)
      );
      if (large.length === 0) continue;

      const target: DispatchTarget = { id: member.userId, email: member.email };
      const chatWorkspaceId = chatPosted ? undefined : workspaceId;
      chatPosted = true;

      if (large.length === 1) {
        const tx = large[0];
        const title = `Large ${tx.type === "EXPENSE" ? "expense" : "incoming payment"}: ${formatCurrency(tx.amount, currency)}`;
        const body = `${describe(tx)} on ${tx.date.toISOString().slice(0, 10)}.`;
        await dispatchNotification(target, prefs, {
          type: "LARGE_TRANSACTION",
          title,
          body,
          link: "/transactions",
          chatWorkspaceId,
          emailSubject: title,
          emailHtml: renderAlertEmail({
            title,
            bodyText: "A transaction above your alert threshold was just recorded.",
            details: [
              { label: "Amount", value: formatCurrency(tx.amount, currency) },
              { label: "Type", value: tx.type === "EXPENSE" ? "Expense" : "Income" },
              { label: "Counterparty", value: tx.counterparty || tx.description },
              { label: "Date", value: tx.date.toISOString().slice(0, 10) },
            ],
            ctaLabel: "Review transactions",
            ctaPath: "/transactions",
          }),
        });
        continue;
      }

      // Aggregate to avoid spamming on large imports.
      const sorted = [...large].sort((a, b) => b.amount - a.amount);
      const title = `${large.length} large transactions recorded`;
      const body = sorted.slice(0, 5).map(describe).join("\n");
      await dispatchNotification(target, prefs, {
        type: "LARGE_TRANSACTION",
        title,
        body,
        link: "/transactions",
        chatWorkspaceId,
        emailSubject: title,
        emailHtml: renderAlertEmail({
          title,
          bodyText: `These transactions exceeded your alert threshold:\n${sorted
            .slice(0, 8)
            .map((tx) => `- ${describe(tx)}`)
            .join("\n")}`,
          ctaLabel: "Review transactions",
          ctaPath: "/transactions",
        }),
      });
    }
  } catch (error) {
    // Alerting must never break the transaction write path.
    logger.error("[notifications] large transaction evaluation", { error: serializeError(error) });
  }
}

/* ------------------------------------------------------------------ */
/* Low cash (evaluated by cron)                                        */
/* ------------------------------------------------------------------ */

export interface LowCashCheck {
  triggered: boolean;
  title?: string;
  body?: string;
  emailHtml?: string;
}

/**
 * Fires when the current balance is below the configured floor, or the
 * forecast projects it to drop below the floor within the horizon.
 */
export async function checkLowCash(
  workspaceId: string,
  currency: string,
  prefs: NotificationPreference
): Promise<LowCashCheck> {
  const forecast = await buildForecast(workspaceId, currency);
  const floor = Number(prefs.lowCashFloor);
  const horizonDays = prefs.lowCashHorizonDays;

  if (forecast.currentBalance < floor) {
    const title = "Low cash warning";
    const body = `Your balance ${formatCurrency(forecast.currentBalance, currency)} is below your floor of ${formatCurrency(floor, currency)}.`;
    return {
      triggered: true,
      title,
      body,
      emailHtml: renderAlertEmail({
        title,
        bodyText: body,
        details: [
          { label: "Current balance", value: formatCurrency(forecast.currentBalance, currency) },
          { label: "Configured floor", value: formatCurrency(floor, currency) },
        ],
        ctaLabel: "Open forecast",
        ctaPath: "/forecast",
      }),
    };
  }

  // Walk the projected daily points within the horizon.
  const points = forecast.horizons.d90.filter((point) => point.projected !== null);
  const horizonEnd = new Date(Date.now() + horizonDays * MS_PER_DAY);
  for (const point of points) {
    if (new Date(`${point.date}T00:00:00.000Z`) > horizonEnd) break;
    if ((point.projected as number) < floor) {
      const title = "Projected low cash";
      const body = `Your balance is projected to fall below ${formatCurrency(floor, currency)} around ${point.date} (projected ${formatCurrency(point.projected as number, currency)}).`;
      return {
        triggered: true,
        title,
        body,
        emailHtml: renderAlertEmail({
          title,
          bodyText: body,
          details: [
            { label: "Current balance", value: formatCurrency(forecast.currentBalance, currency) },
            { label: "Projected date", value: point.date },
            {
              label: "Projected balance",
              value: formatCurrency(point.projected as number, currency),
            },
            { label: "Configured floor", value: formatCurrency(floor, currency) },
          ],
          ctaLabel: "Open forecast",
          ctaPath: "/forecast",
        }),
      };
    }
  }

  return { triggered: false };
}

/* ------------------------------------------------------------------ */
/* Invoice reminders (evaluated by cron)                               */
/* ------------------------------------------------------------------ */

export interface InvoiceReminderCheck {
  triggered: boolean;
  title?: string;
  body?: string;
  emailHtml?: string;
}

/** Reuses the stage-5 reminders logic: due within 7 days or overdue. */
export async function checkInvoiceReminders(
  workspaceId: string,
  currency: string
): Promise<InvoiceReminderCheck> {
  const reminders = await getInvoiceReminders(workspaceId);
  const overdueCount = reminders.overdue.length;
  const dueSoonCount = reminders.dueSoon.length;
  if (overdueCount === 0 && dueSoonCount === 0) return { triggered: false };

  const pieces: string[] = [];
  if (overdueCount > 0) {
    pieces.push(
      `${overdueCount} overdue (${formatCurrency(reminders.overdueTotal, currency)})`
    );
  }
  if (dueSoonCount > 0) {
    pieces.push(
      `${dueSoonCount} due this week (${formatCurrency(reminders.dueSoonTotal, currency)})`
    );
  }

  const total = overdueCount + dueSoonCount;
  const title = total === 1 ? "1 invoice needs attention" : `${total} invoices need attention`;
  const body = pieces.join(" · ");

  const details = [...reminders.overdue, ...reminders.dueSoon].slice(0, 8).map((invoice) => ({
    label: `${invoice.vendor || "Unknown vendor"}${invoice.dueDate ? ` — due ${invoice.dueDate.slice(0, 10)}` : ""}`,
    value: formatCurrency(invoice.total, invoice.currency),
  }));

  return {
    triggered: true,
    title,
    body,
    emailHtml: renderAlertEmail({
      title,
      bodyText: `You have ${body}.`,
      details,
      ctaLabel: "Open invoices",
      ctaPath: "/invoices",
    }),
  };
}
