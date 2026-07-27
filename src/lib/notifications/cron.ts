import "server-only";

import { prisma } from "@/lib/prisma";

import { checkInvoiceReminders, checkLowCash } from "./alerts";
import { dispatchNotification } from "./dispatch";
import { renderDigestEmail } from "./email";
import { getOrCreatePreferences } from "./preferences";
import { generateSummary, type SummaryKind } from "./summaries";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface CronStats {
  users: number;
  summariesSent: number;
  lowCashAlerts: number;
  invoiceReminders: number;
  errors: number;
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

/**
 * Evaluates every user's due summaries and alerts. Designed to run hourly
 * (Vercel Cron) and be idempotent: each send updates a last-sent timestamp on
 * the preference row, so re-runs within the same window are no-ops.
 *
 * - Daily summary: once per UTC day.
 * - Weekly summary: Mondays, at most once per 6 days.
 * - Monthly summary: the 1st, at most once per 27 days.
 * - Low cash + invoice reminders: evaluated on every run, sent at most once
 *   per UTC day while the condition holds.
 */
export async function runNotificationCron(now = new Date()): Promise<CronStats> {
  const stats: CronStats = {
    users: 0,
    summariesSent: 0,
    lowCashAlerts: 0,
    invoiceReminders: 0,
    errors: 0,
  };

  const profiles = await prisma.profile.findMany({
    select: { id: true, email: true, currency: true, aiProvider: true },
  });
  stats.users = profiles.length;

  for (const profile of profiles) {
    try {
      const prefs = await getOrCreatePreferences(profile.id);
      const target = { id: profile.id, email: profile.email };

      /* ---- Summaries ---- */
      const dueSummaries: SummaryKind[] = [];
      if (prefs.dailySummary && (!prefs.lastDailySentAt || !isSameUtcDay(prefs.lastDailySentAt, now))) {
        dueSummaries.push("daily");
      }
      if (
        prefs.weeklySummary &&
        now.getUTCDay() === 1 &&
        (!prefs.lastWeeklySentAt || now.getTime() - prefs.lastWeeklySentAt.getTime() > 6 * MS_PER_DAY)
      ) {
        dueSummaries.push("weekly");
      }
      if (
        prefs.monthlySummary &&
        now.getUTCDate() === 1 &&
        (!prefs.lastMonthlySentAt ||
          now.getTime() - prefs.lastMonthlySentAt.getTime() > 27 * MS_PER_DAY)
      ) {
        dueSummaries.push("monthly");
      }

      for (const kind of dueSummaries) {
        // Claim the slot before dispatching so a concurrent/re-run cron
        // doesn't double-send even if dispatch is slow.
        await prisma.notificationPreference.update({
          where: { userId: profile.id },
          data:
            kind === "daily"
              ? { lastDailySentAt: now }
              : kind === "weekly"
                ? { lastWeeklySentAt: now }
                : { lastMonthlySentAt: now },
        });

        const digest = await generateSummary(profile.id, profile, kind);
        await dispatchNotification(target, prefs, {
          type: digest.type,
          title: digest.title,
          body: digest.body,
          link: "/dashboard",
          emailSubject: digest.title,
          emailHtml: renderDigestEmail({
            title: digest.title,
            periodLabel: digest.periodLabel,
            bodyText: digest.body,
            stats: digest.stats,
          }),
        });
        stats.summariesSent += 1;
      }

      /* ---- Low cash ---- */
      if (
        prefs.lowCash &&
        (!prefs.lastLowCashAt || !isSameUtcDay(prefs.lastLowCashAt, now))
      ) {
        const check = await checkLowCash(profile.id, profile.currency, prefs);
        if (check.triggered) {
          await prisma.notificationPreference.update({
            where: { userId: profile.id },
            data: { lastLowCashAt: now },
          });
          await dispatchNotification(target, prefs, {
            type: "LOW_CASH",
            title: check.title!,
            body: check.body!,
            link: "/forecast",
            emailSubject: check.title,
            emailHtml: check.emailHtml,
          });
          stats.lowCashAlerts += 1;
        }
      }

      /* ---- Invoice reminders ---- */
      if (
        prefs.invoiceReminders &&
        (!prefs.lastInvoiceRemindAt || !isSameUtcDay(prefs.lastInvoiceRemindAt, now))
      ) {
        const check = await checkInvoiceReminders(profile.id, profile.currency);
        if (check.triggered) {
          await prisma.notificationPreference.update({
            where: { userId: profile.id },
            data: { lastInvoiceRemindAt: now },
          });
          await dispatchNotification(target, prefs, {
            type: "INVOICE_REMINDER",
            title: check.title!,
            body: check.body!,
            link: "/invoices",
            emailSubject: check.title,
            emailHtml: check.emailHtml,
          });
          stats.invoiceReminders += 1;
        }
      }
    } catch (error) {
      stats.errors += 1;
      console.error(`[notifications] cron failed for user ${profile.id}:`, error);
    }
  }

  return stats;
}
