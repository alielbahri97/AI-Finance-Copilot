import "server-only";

import type { DunningStep, Invoice } from "@/generated/prisma/client";
import { getAiClient, providerFromProfile } from "@/lib/ai";
import { BRAND } from "@/lib/branding";
import { getEntitlements } from "@/lib/billing/entitlements";
import { logger, serializeError } from "@/lib/logger";
import { dispatchNotification } from "@/lib/notifications/dispatch";
import {
  renderCustomerReminderEmail,
  sendEmail,
  type EmailDeliveryResult,
} from "@/lib/notifications/email";
import { getOrCreatePreferences } from "@/lib/notifications/preferences";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";

import {
  buildFallbackDraft,
  buildReminderPrompt,
  daysPastDue,
  DUE_SOON_LEAD_DAYS,
  isDunnable,
  nextDunningStep,
  normalizeEmail,
  parseReminderDraft,
  selectDunningStep,
  STEP_LABELS,
  type DunnableInvoice,
  type ReminderDraft,
  type ReminderFacts,
} from "./dunning-core";

/**
 * Customer-facing payment reminders: drafting them, sending them, and the
 * hourly automatic pass. The rules about *whether* and *what* live in
 * ./dunning-core.ts; this module is the part that touches the database, the
 * model and the mail provider.
 */

/**
 * How long the model gets to write one reminder before the deterministic
 * draft is used instead. The automatic pass writes several inside the cron's
 * single 300s budget, so an unbounded call here does not delay one reminder,
 * it spends everybody else's time — the same reasoning as the digests.
 */
export const DUNNING_AI_TIMEOUT_MS = 8_000;

/** Invoices considered by one automatic pass, per workspace. */
const AUTO_CANDIDATE_LIMIT = 200;

/** Reminders one workspace may send in a single automatic pass. */
const AUTO_SEND_LIMIT_PER_RUN = 25;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ReminderDraftResult extends ReminderDraft {
  /** Whether the model wrote this, or the deterministic template did. */
  source: "ai" | "template";
}

/**
 * Drafts one reminder. Never throws and never returns nothing: a missing API
 * key, a provider outage, a slow model or an unparseable reply all land on
 * the deterministic draft, because the user's problem is an unpaid invoice
 * and "the AI is down" is not an answer to it.
 */
export async function draftReminder(
  facts: ReminderFacts,
  options: { aiProvider?: "OPENAI" | "ANTHROPIC" | "GROQ" | null; timeoutMs?: number } = {}
): Promise<ReminderDraftResult> {
  const fallback = buildFallbackDraft(facts);
  try {
    const client = getAiClient(providerFromProfile(options.aiProvider));
    const prompt = buildReminderPrompt(facts, BRAND.name);
    const text = await client.chat(
      [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      {
        maxTokens: 500,
        signal: AbortSignal.timeout(options.timeoutMs ?? DUNNING_AI_TIMEOUT_MS),
      }
    );
    const draft = parseReminderDraft(text);
    if (draft) return { ...draft, source: "ai" };
    logger.info("[dunning] model reply was not a usable draft, using the template", {
      step: facts.step,
    });
  } catch (error) {
    logger.info("[dunning] AI draft unavailable, using the template", {
      step: facts.step,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  return { ...fallback, source: "template" };
}

/** The invoice fields drafting and sending need. */
type ReminderInvoice = Pick<
  Invoice,
  | "id"
  | "vendor"
  | "customerEmail"
  | "invoiceNumber"
  | "dueDate"
  | "currency"
  | "total"
  | "direction"
  | "status"
>;

/** Turns an invoice row plus its sender into the facts a reminder may cite. */
export function buildReminderFacts(
  invoice: ReminderInvoice,
  companyName: string,
  step: DunningStep,
  now: Date
): ReminderFacts {
  const dueDate = invoice.dueDate ?? now;
  return {
    step,
    companyName,
    customerName: invoice.vendor,
    invoiceNumber: invoice.invoiceNumber,
    amount: Number(invoice.total),
    currency: invoice.currency,
    dueDate: dueDate.toISOString().slice(0, 10),
    daysLate: daysPastDue(dueDate, now),
  };
}

/** The detail rows shown under the message in the customer's email. */
function reminderDetails(invoice: ReminderInvoice): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (invoice.invoiceNumber) rows.push({ label: "Invoice", value: invoice.invoiceNumber });
  rows.push({ label: "Amount due", value: formatCurrency(Number(invoice.total), invoice.currency) });
  if (invoice.dueDate) {
    rows.push({ label: "Due date", value: invoice.dueDate.toISOString().slice(0, 10) });
  }
  return rows;
}

export type SendReminderRefusal =
  | "not_found"
  /* Payable, no due date, or no recipient: nothing to chase. */
  | "not_dunnable"
  /* Paid (or back to draft) between opening the dialog and pressing send. */
  | "not_unpaid"
  /* This rung of the ladder has already been climbed for this invoice. */
  | "already_sent";

export type SendReminderResult =
  | { ok: false; reason: SendReminderRefusal; step?: DunningStep; sentAt?: Date }
  | { ok: true; step: DunningStep; delivery: EmailDeliveryResult; logged: boolean };

export interface SendReminderInput {
  workspaceId: string;
  invoiceId: string;
  toEmail: string;
  subject: string;
  body: string;
  /** The member who pressed send; null for the automatic pass. */
  sentBy: string | null;
  /** Reply-to for the customer's answer, when there is a mailbox to use. */
  replyTo?: string | null;
  now?: Date;
}

/**
 * Sends one reminder and records it.
 *
 * The invoice is re-read here rather than trusted from the caller, because
 * minutes can pass between a draft appearing on screen and somebody pressing
 * send, and in that window the invoice may well have been paid. The log row
 * is written *before* the email goes out — that claim is what makes a second
 * cron run, or a double-clicked button, a no-op instead of a second email —
 * and rolled back if the send did not happen, so a provider outage never
 * costs the invoice a rung of the ladder.
 */
export async function sendInvoiceReminder(input: SendReminderInput): Promise<SendReminderResult> {
  const now = input.now ?? new Date();
  const invoice = await prisma.invoice.findFirst({
    where: { id: input.invoiceId, workspaceId: input.workspaceId },
    select: {
      id: true,
      vendor: true,
      customerEmail: true,
      invoiceNumber: true,
      dueDate: true,
      currency: true,
      total: true,
      direction: true,
      status: true,
      workspace: { select: { name: true } },
      reminderLogs: { select: { kind: true, sentAt: true } },
    },
  });
  if (!invoice) return { ok: false, reason: "not_found" };
  if (invoice.status !== "UNPAID") return { ok: false, reason: "not_unpaid" };

  const candidate: DunnableInvoice = {
    direction: invoice.direction,
    status: invoice.status,
    dueDate: invoice.dueDate,
    customerEmail: input.toEmail,
  };
  if (!isDunnable(candidate)) return { ok: false, reason: "not_dunnable" };

  const step = nextDunningStep(
    candidate,
    invoice.reminderLogs.map((log) => log.kind),
    now
  );
  if (step === null) {
    const current = invoice.dueDate
      ? selectDunningStep(daysPastDue(invoice.dueDate, now))
      : null;
    const log = invoice.reminderLogs.find((entry) => entry.kind === current);
    return { ok: false, reason: "already_sent", step: log?.kind, sentAt: log?.sentAt };
  }

  const details = reminderDetails(invoice);
  const html = renderCustomerReminderEmail({
    senderName: invoice.workspace.name,
    subject: input.subject,
    bodyText: input.body,
    details,
    replyTo: input.replyTo ?? undefined,
  });

  // Claim the rung first: two people pressing "Send" at once, or a cron
  // overlapping itself, then collide on the unique key instead of on the
  // customer's inbox.
  let logId: string | null = null;
  try {
    const log = await prisma.reminderLog.create({
      data: {
        invoiceId: invoice.id,
        kind: step,
        toEmail: input.toEmail,
        subject: input.subject,
        body: input.body,
        sentBy: input.sentBy,
        sentAt: now,
      },
      select: { id: true },
    });
    logId = log.id;
  } catch (error) {
    logger.info("[dunning] reminder step was already claimed", {
      invoiceId: invoice.id,
      step,
      detail: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "already_sent", step };
  }

  const delivery = await sendEmail(input.toEmail, input.subject, html, "invoice:dunning", {
    replyTo: input.replyTo ?? undefined,
  });

  if (delivery.status !== "sent") {
    // Nothing left the building, so the rung is free again.
    await prisma.reminderLog.delete({ where: { id: logId } }).catch(() => undefined);
    return { ok: true, step, delivery, logged: false };
  }

  // A working address is worth keeping: it is what makes this invoice, and
  // the next one for the same customer, eligible for the automatic pass.
  await prisma.invoice
    .update({ where: { id: invoice.id }, data: { customerEmail: input.toEmail } })
    .catch((error) =>
      logger.error("[dunning] could not store the customer address", {
        invoiceId: invoice.id,
        error: serializeError(error),
      })
    );

  return { ok: true, step, delivery, logged: true };
}

/* ------------------------------------------------------------------ */
/* Automatic pass                                                      */
/* ------------------------------------------------------------------ */

export interface AutoDunningStats {
  /** Workspaces that had the setting on and a plan that allows it. */
  workspaces: number;
  /** Invoices that were on an unsent rung of the ladder. */
  eligible: number;
  sent: number;
  /** Drafted and claimed, but the provider did not deliver. */
  undelivered: number;
  errors: number;
}

/**
 * The opt-in automatic pass, run once per hour by the notifications cron.
 *
 * Idempotent by construction: eligibility is a function of the due date and
 * the reminder log, and every send claims its rung before the email leaves,
 * so re-running within the hour sends nothing. At most one step per invoice
 * per run, which is what stops a cron catching up after a night of downtime
 * from delivering an entire escalation ladder in one go.
 */
export async function runAutoDunning(now = new Date()): Promise<AutoDunningStats> {
  const stats: AutoDunningStats = {
    workspaces: 0,
    eligible: 0,
    sent: 0,
    undelivered: 0,
    errors: 0,
  };

  const workspaces = await prisma.workspace.findMany({
    where: { autoDunningEnabled: true, type: "BUSINESS" },
    select: { id: true, name: true },
  });

  for (const workspace of workspaces) {
    try {
      const entitlements = await getEntitlements(workspace.id);
      if (!entitlements.plan.limits.dunningEnabled) continue;
      stats.workspaces += 1;
      await runWorkspaceDunning(workspace, now, stats);
    } catch (error) {
      stats.errors += 1;
      logger.error("[dunning] automatic pass failed for a workspace", {
        workspaceId: workspace.id,
        error: serializeError(error),
      });
    }
  }

  return stats;
}

async function runWorkspaceDunning(
  workspace: { id: string; name: string },
  now: Date,
  stats: AutoDunningStats
): Promise<void> {
  const owner = await prisma.workspaceMember.findFirst({
    where: { workspaceId: workspace.id, role: "OWNER" },
    orderBy: { joinedAt: "asc" },
    select: { userId: true, profile: { select: { email: true, aiProvider: true } } },
  });
  // Without an owner there is nobody to send on behalf of, and nobody to tell.
  if (!owner) return;

  const horizon = new Date(now.getTime() + DUE_SOON_LEAD_DAYS * MS_PER_DAY);
  const invoices = await prisma.invoice.findMany({
    where: {
      workspaceId: workspace.id,
      direction: "RECEIVABLE",
      status: "UNPAID",
      customerEmail: { not: null },
      dueDate: { not: null, lte: horizon },
    },
    orderBy: { dueDate: "asc" },
    take: AUTO_CANDIDATE_LIMIT,
    select: {
      id: true,
      vendor: true,
      customerEmail: true,
      invoiceNumber: true,
      dueDate: true,
      currency: true,
      total: true,
      direction: true,
      status: true,
      reminderLogs: { select: { kind: true } },
    },
  });

  let sentThisRun = 0;
  for (const invoice of invoices) {
    if (sentThisRun >= AUTO_SEND_LIMIT_PER_RUN) break;

    const toEmail = normalizeEmail(invoice.customerEmail);
    if (!toEmail) continue;
    const step = nextDunningStep(
      {
        direction: invoice.direction,
        status: invoice.status,
        dueDate: invoice.dueDate,
        customerEmail: toEmail,
      },
      invoice.reminderLogs.map((log) => log.kind),
      now
    );
    if (step === null) continue;
    stats.eligible += 1;

    const facts = buildReminderFacts(invoice, workspace.name, step, now);
    const draft = await draftReminder(facts, { aiProvider: owner.profile.aiProvider });
    const result = await sendInvoiceReminder({
      workspaceId: workspace.id,
      invoiceId: invoice.id,
      toEmail,
      subject: draft.subject,
      body: draft.body,
      sentBy: null,
      replyTo: owner.profile.email,
      now,
    });

    if (!result.ok || !result.logged) {
      if (result.ok) stats.undelivered += 1;
      continue;
    }

    sentThisRun += 1;
    stats.sent += 1;
    await notifyOwnerOfAutoSend(owner.userId, owner.profile.email, invoice, result.step).catch(
      (error) =>
        logger.error("[dunning] could not notify the owner of an automatic reminder", {
          invoiceId: invoice.id,
          error: serializeError(error),
        })
    );
  }
}

/**
 * Tells the owner what went out under their name. In-app only by design: the
 * notification exists so nobody is surprised by a customer replying to an
 * email they never saw, not to generate a second inbox to clear.
 */
async function notifyOwnerOfAutoSend(
  userId: string,
  email: string,
  invoice: { id: string; vendor: string; invoiceNumber: string | null },
  step: DunningStep
): Promise<void> {
  const prefs = await getOrCreatePreferences(userId);
  const label = invoice.invoiceNumber ? `invoice ${invoice.invoiceNumber}` : "an invoice";
  await dispatchNotification(
    { id: userId, email },
    prefs,
    {
      type: "INVOICE_REMINDER",
      title: `Reminder sent to ${invoice.vendor || "your customer"}`,
      body: `${STEP_LABELS[step]} for ${label} was emailed automatically.`,
      link: `/invoices/${invoice.id}`,
    }
  );
}
