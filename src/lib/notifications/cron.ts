import "server-only";

import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/workspace/permissions";

import { checkInvoiceReminders, checkLowCash } from "./alerts";
import { dispatchNotification, type DispatchResult } from "./dispatch";
import { renderDigestEmail, type EmailDeliveryResult } from "./email";
import { getOrCreatePreferences } from "./preferences";
import { CRON_RUN_BUDGET_MS, dueSummaries, isDailyAlertDue } from "./schedule";
import { generateSummary } from "./summaries";

/**
 * How many Resend message ids one run reports back. Enough to prove that mail
 * really went out without letting the response grow with the user base.
 */
const MAX_REPORTED_MESSAGE_IDS = 10;

/**
 * What the email channel did across the run. Without this, `summariesSent`
 * counts events, not mail, and an operator cannot tell a delivered digest from
 * one silently skipped because RESEND_API_KEY was never set.
 */
export interface CronEmailStats {
  /** Sends Resend accepted. */
  sent: number;
  /** Sends skipped because RESEND_API_KEY and EMAIL_FROM are not both set. */
  notConfigured: number;
  failed: number;
  /** Failures Resend blames on an unverified sending domain, not on the key. */
  domainRestricted: number;
  /** Resend ids for accepted sends, capped at {@link MAX_REPORTED_MESSAGE_IDS}. */
  messageIds: string[];
}

export interface CronStats {
  users: number;
  /**
   * Users the run never started because it ran out of budget. Nothing was
   * claimed for them, so the next run picks them up — but a non-zero value
   * means the instance no longer fits one invocation and needs looking at.
   */
  usersSkipped: number;
  summariesSent: number;
  lowCashAlerts: number;
  invoiceReminders: number;
  errors: number;
  email: CronEmailStats;
}

function recordEmail(stats: CronEmailStats, result: EmailDeliveryResult | undefined): void {
  if (!result) return;
  if (result.status === "sent") {
    stats.sent += 1;
    if (result.id && stats.messageIds.length < MAX_REPORTED_MESSAGE_IDS) {
      stats.messageIds.push(result.id);
    }
    return;
  }
  if (result.status === "not_configured") {
    stats.notConfigured += 1;
    return;
  }
  stats.failed += 1;
  if (result.domainRestricted) stats.domainRestricted += 1;
}

interface WorkspaceRef {
  id: string;
  currency: string;
}

interface UserWorkspaces {
  userId: string;
  email: string;
  aiProvider: "OPENAI" | "ANTHROPIC" | "GROQ";
  /**
   * Workspaces this user may see reports for, with the workspace currency.
   * Scope of the digests and the low-cash alert: both are built from balances,
   * transactions and the forecast, which is what `view_reports` gates
   * everywhere else (/dashboard, /reports, /forecast, /api/forecast).
   */
  reportable: WorkspaceRef[];
  /** Workspaces this user may see invoices for — scope of invoice reminders. */
  invoiceable: WorkspaceRef[];
  /**
   * Workspaces this user owns. Slack/Teams channel posts follow the owner's
   * alerts so a shared channel gets each event once, not once per member.
   */
  ownerOf: Set<string>;
}

/**
 * Picks the workspace a notification should cover: the one (among the
 * workspaces the user may see that kind of data in) with the most recent
 * transaction, falling back to the first membership. A partner in a shared
 * restaurant workspace with an empty personal workspace gets the restaurant
 * digest, not an empty one.
 */
async function pickPrimaryWorkspace(candidates: WorkspaceRef[]): Promise<WorkspaceRef | null> {
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
 * Evaluates every member's due summaries and alerts, workspace-aware: each
 * notification is computed from a workspace the member is allowed to see that
 * kind of data in, so nothing reaches someone who could not open it in the
 * app. Every window below is at least a day wide, so a daily schedule (what
 * vercel.json declares, and the most Vercel's Hobby plan allows) misses
 * nothing; an hourly one only shortens the wait after a user enables a digest.
 * Idempotent either way: each send updates a last-sent timestamp on the
 * member's preference row, so re-runs within the same window are no-ops.
 *
 * - Daily summary: once per UTC day.
 * - Weekly summary: Mondays, at most once per 6 days.
 * - Monthly summary: the 1st, at most once per 27 days.
 * - Low cash + invoice reminders: evaluated on every run, sent at most once
 *   per UTC day while the condition holds.
 *
 * Bounded by `options.budgetMs`: once the run has been going that long it
 * stops starting users and reports the rest as `usersSkipped`, because the
 * invocation has a hard ceiling and being killed inside the loop would drop
 * the remaining users with nothing written anywhere.
 */
export async function runNotificationCron(
  now = new Date(),
  options: { budgetMs?: number } = {}
): Promise<CronStats> {
  const budgetMs = options.budgetMs ?? CRON_RUN_BUDGET_MS;
  const startedAt = Date.now();
  const stats: CronStats = {
    users: 0,
    usersSkipped: 0,
    summariesSent: 0,
    lowCashAlerts: 0,
    invoiceReminders: 0,
    errors: 0,
    email: { sent: 0, notConfigured: 0, failed: 0, domainRestricted: 0, messageIds: [] },
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

  // Group by user, keeping the workspaces they may see reports in and the ones
  // they may see invoices in apart: those are different notifications gated on
  // different permissions, and a member can easily hold one and not the other.
  const byUser = new Map<string, UserWorkspaces>();
  for (const member of memberships) {
    const entry = byUser.get(member.userId) ?? {
      userId: member.userId,
      email: member.profile.email,
      aiProvider: member.profile.aiProvider,
      reportable: [],
      invoiceable: [],
      ownerOf: new Set<string>(),
    };
    const workspace = { id: member.workspace.id, currency: member.workspace.currency };
    if (hasPermission(member.role, member.permissions, "view_reports")) {
      entry.reportable.push(workspace);
    }
    if (hasPermission(member.role, member.permissions, "view_invoices")) {
      entry.invoiceable.push(workspace);
    }
    if (member.role === "OWNER") {
      entry.ownerOf.add(member.workspace.id);
    }
    byUser.set(member.userId, entry);
  }

  // Order comes from the membership query, which does not promise one. Users
  // are independent of each other, so any order is correct; it does mean that
  // if the deadline below keeps firing, roughly the same tail is deferred each
  // run. Serving the least-recently-notified first would fix that properly and
  // needs a preference-ordered query, which is only worth it once a run
  // actually reports usersSkipped.
  const queue = [...byUser.values()];
  stats.users = queue.length;

  for (const [index, user] of queue.entries()) {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= budgetMs) {
      // Nothing has been claimed for the users left here — no last-sent
      // timestamp is written before this check — so they stay due and the next
      // run sends their digest late rather than never.
      stats.usersSkipped = queue.length - index;
      logger.warn("notification cron ran out of budget", {
        budgetMs,
        elapsedMs,
        usersProcessed: index,
        usersSkipped: stats.usersSkipped,
      });
      break;
    }

    try {
      const prefs = await getOrCreatePreferences(user.userId);
      const target = { id: user.userId, email: user.email };

      // Two scopes, because the permissions differ: report access covers the
      // digests and the low-cash alert, invoice access covers the reminders. A
      // member who may see invoices but not reports gets the reminders and
      // nothing else, and vice versa. They collapse to one workspace — and one
      // lookup — whenever the user may see both there, which is the norm.
      const reportPrimary = await pickPrimaryWorkspace(user.reportable);
      const invoicePrimary =
        reportPrimary && user.invoiceable.some((entry) => entry.id === reportPrimary.id)
          ? reportPrimary
          : await pickPrimaryWorkspace(user.invoiceable);
      if (!reportPrimary && !invoicePrimary) continue;

      /* ---- Summaries ---- */
      if (reportPrimary) {
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
            reportPrimary.id,
            { currency: reportPrimary.currency, aiProvider: user.aiProvider },
            kind
          );
          const dispatched: DispatchResult = await dispatchNotification(target, prefs, {
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
          recordEmail(stats.email, dispatched.email);
          stats.summariesSent += 1;
        }
      }

      /* ---- Low cash ---- */
      if (reportPrimary && prefs.lowCash && isDailyAlertDue(prefs.lastLowCashAt, now)) {
        const check = await checkLowCash(reportPrimary.id, reportPrimary.currency, prefs);
        if (check.triggered) {
          await prisma.notificationPreference.update({
            where: { userId: user.userId },
            data: { lastLowCashAt: now },
          });
          const dispatched: DispatchResult = await dispatchNotification(target, prefs, {
            type: "LOW_CASH",
            title: check.title!,
            body: check.body!,
            link: "/forecast",
            chatWorkspaceId: user.ownerOf.has(reportPrimary.id) ? reportPrimary.id : undefined,
            emailSubject: check.title,
            emailHtml: check.emailHtml,
          });
          recordEmail(stats.email, dispatched.email);
          stats.lowCashAlerts += 1;
        }
      }

      /* ---- Invoice reminders ---- */
      if (
        invoicePrimary &&
        prefs.invoiceReminders &&
        isDailyAlertDue(prefs.lastInvoiceRemindAt, now)
      ) {
        const check = await checkInvoiceReminders(invoicePrimary.id, invoicePrimary.currency);
        if (check.triggered) {
          await prisma.notificationPreference.update({
            where: { userId: user.userId },
            data: { lastInvoiceRemindAt: now },
          });
          const dispatched: DispatchResult = await dispatchNotification(target, prefs, {
            type: "INVOICE_REMINDER",
            title: check.title!,
            body: check.body!,
            link: "/invoices",
            chatWorkspaceId: user.ownerOf.has(invoicePrimary.id) ? invoicePrimary.id : undefined,
            emailSubject: check.title,
            emailHtml: check.emailHtml,
          });
          recordEmail(stats.email, dispatched.email);
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
