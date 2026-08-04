import "server-only";

import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/workspace/permissions";

import { checkInvoiceReminders, checkLowCash } from "./alerts";
import { dispatchNotification } from "./dispatch";
import { renderDigestEmail } from "./email";
import { getOrCreatePreferences } from "./preferences";
import { dueSummaries, isDailyAlertDue } from "./schedule";
import { generateSummary } from "./summaries";

export interface CronStats {
  users: number;
  summariesSent: number;
  lowCashAlerts: number;
  invoiceReminders: number;
  errors: number;
}

interface UserWorkspaces {
  userId: string;
  email: string;
  aiProvider: "OPENAI" | "ANTHROPIC" | "GROQ";
  /** Workspaces this user may see reports for, with the workspace currency. */
  reportable: { id: string; currency: string }[];
  /** Workspaces this user may see invoices for. */
  invoiceable: Set<string>;
  /**
   * Workspaces this user owns. Slack/Teams channel posts follow the owner's
   * alerts so a shared channel gets each event once, not once per member.
   */
  ownerOf: Set<string>;
}

/**
 * Picks the workspace a user's digest should cover: the one (among their
 * viewable workspaces) with the most recent transaction, falling back to the
 * first membership. A partner in a shared restaurant workspace with an empty
 * personal workspace gets the restaurant digest, not an empty one.
 */
async function pickPrimaryWorkspace(
  candidates: { id: string; currency: string }[]
): Promise<{ id: string; currency: string } | null> {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const latest = await prisma.transaction.findFirst({
    where: { workspaceId: { in: candidates.map((c) => c.id) } },
    orderBy: { date: "desc" },
    select: { workspaceId: true },
  });
  return candidates.find((c) => c.id === latest?.workspaceId) ?? candidates[0];
}

/**
 * Evaluates every member's due summaries and alerts, workspace-aware:
 * digests and alerts are computed from the workspace a member can actually
 * see (their most active viewable workspace), and permission-gated. Designed
 * to run hourly (Vercel Cron) and be idempotent: each send updates a
 * last-sent timestamp on the member's preference row, so re-runs within the
 * same window are no-ops.
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

  const memberships = await prisma.workspaceMember.findMany({
    select: {
      userId: true,
      role: true,
      permissions: true,
      workspace: { select: { id: true, currency: true } },
      profile: { select: { email: true, aiProvider: true } },
    },
  });

  // Group by user: one digest per user, covering their primary workspace.
  const byUser = new Map<string, UserWorkspaces>();
  for (const member of memberships) {
    const entry = byUser.get(member.userId) ?? {
      userId: member.userId,
      email: member.profile.email,
      aiProvider: member.profile.aiProvider,
      reportable: [],
      invoiceable: new Set<string>(),
      ownerOf: new Set<string>(),
    };
    if (hasPermission(member.role, member.permissions, "view_reports")) {
      entry.reportable.push({ id: member.workspace.id, currency: member.workspace.currency });
    }
    if (hasPermission(member.role, member.permissions, "view_invoices")) {
      entry.invoiceable.add(member.workspace.id);
    }
    if (member.role === "OWNER") {
      entry.ownerOf.add(member.workspace.id);
    }
    byUser.set(member.userId, entry);
  }
  stats.users = byUser.size;

  for (const user of byUser.values()) {
    try {
      const prefs = await getOrCreatePreferences(user.userId);
      const target = { id: user.userId, email: user.email };
      const primary = await pickPrimaryWorkspace(user.reportable);
      if (!primary) continue;
      const chatWorkspaceId = user.ownerOf.has(primary.id) ? primary.id : undefined;

      /* ---- Summaries ---- */
      for (const kind of dueSummaries(prefs, now)) {
        // Claim the slot before dispatching so a concurrent/re-run cron
        // doesn't double-send even if dispatch is slow.
        await prisma.notificationPreference.update({
          where: { userId: user.userId },
          data:
            kind === "daily"
              ? { lastDailySentAt: now }
              : kind === "weekly"
                ? { lastWeeklySentAt: now }
                : { lastMonthlySentAt: now },
        });

        const digest = await generateSummary(
          primary.id,
          { currency: primary.currency, aiProvider: user.aiProvider },
          kind
        );
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
      if (prefs.lowCash && isDailyAlertDue(prefs.lastLowCashAt, now)) {
        const check = await checkLowCash(primary.id, primary.currency, prefs);
        if (check.triggered) {
          await prisma.notificationPreference.update({
            where: { userId: user.userId },
            data: { lastLowCashAt: now },
          });
          await dispatchNotification(target, prefs, {
            type: "LOW_CASH",
            title: check.title!,
            body: check.body!,
            link: "/forecast",
            chatWorkspaceId,
            emailSubject: check.title,
            emailHtml: check.emailHtml,
          });
          stats.lowCashAlerts += 1;
        }
      }

      /* ---- Invoice reminders ---- */
      if (
        prefs.invoiceReminders &&
        user.invoiceable.has(primary.id) &&
        isDailyAlertDue(prefs.lastInvoiceRemindAt, now)
      ) {
        const check = await checkInvoiceReminders(primary.id, primary.currency);
        if (check.triggered) {
          await prisma.notificationPreference.update({
            where: { userId: user.userId },
            data: { lastInvoiceRemindAt: now },
          });
          await dispatchNotification(target, prefs, {
            type: "INVOICE_REMINDER",
            title: check.title!,
            body: check.body!,
            link: "/invoices",
            chatWorkspaceId,
            emailSubject: check.title,
            emailHtml: check.emailHtml,
          });
          stats.invoiceReminders += 1;
        }
      }
    } catch (error) {
      stats.errors += 1;
      logger.error("notification cron failed for user", {
        userId: user.userId,
        error: serializeError(error),
      });
    }
  }

  return stats;
}
