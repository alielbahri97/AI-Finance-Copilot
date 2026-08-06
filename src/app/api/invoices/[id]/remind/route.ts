import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import { getEntitlements, upgradeError } from "@/lib/billing/entitlements";
import {
  buildReminderFacts,
  draftReminder,
  sendInvoiceReminder,
  type SendReminderRefusal,
} from "@/lib/invoices/dunning";
import {
  daysPastDue,
  nextDunningStep,
  normalizeEmail,
  selectDunningStep,
  STEP_LABELS,
} from "@/lib/invoices/dunning-core";
import { isEmailConfigured } from "@/lib/notifications/email";
import { prisma } from "@/lib/prisma";
import { invoiceReminderSchema } from "@/lib/validations/invoice";
import { recordAudit } from "@/lib/workspace/audit";
import { requireEditionFeature } from "@/lib/workspace/context";

/**
 * Customer-facing payment reminders for one invoice.
 *
 *   GET   the draft the dialog opens with, plus what has already been sent
 *   POST  send the (possibly edited) reminder and record it
 *
 * Both are Business-edition only — `requireEditionFeature` answers 404 in a
 * Personal workspace, where invoices do not exist — and both are plan-gated
 * with the shared 402 upgrade hint.
 */

type RouteContext = { params: Promise<{ id: string }> };

const INVOICE_SELECT = {
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
  reminderLogs: {
    orderBy: { sentAt: "desc" },
    select: { id: true, kind: true, sentAt: true, toEmail: true, subject: true, sentBy: true },
  },
} as const;

/** Why there is nothing to send, in the same words the dialog shows. */
type IneligibleReason =
  | "not_receivable"
  | "not_unpaid"
  | "no_due_date"
  | "no_recipient"
  | "not_due_yet"
  | "already_sent";

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireEditionFeature("invoices", "edit_invoices");
    if (!auth.ok) return auth.response;
    const { user, workspace } = auth.ctx;

    const entitlements = await getEntitlements(workspace.id);
    if (!entitlements.plan.limits.dunningEnabled) {
      return NextResponse.json(
        upgradeError("Customer payment reminders", entitlements.planId, entitlements.edition),
        { status: 402 }
      );
    }

    const { id } = await context.params;
    const invoice = await prisma.invoice.findFirst({
      where: { id, workspaceId: workspace.id },
      select: INVOICE_SELECT,
    });
    if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    const now = new Date();
    const history = invoice.reminderLogs.map((log) => ({
      id: log.id,
      kind: log.kind,
      label: STEP_LABELS[log.kind],
      sentAt: log.sentAt.toISOString(),
      toEmail: log.toEmail,
      subject: log.subject,
      automatic: log.sentBy === null,
    }));

    const profile = await prisma.profile.findUnique({
      where: { id: user.id },
      select: { aiProvider: true, email: true },
    });
    const recipient = normalizeEmail(invoice.customerEmail);
    const base = {
      invoiceId: invoice.id,
      customerName: invoice.vendor,
      recipient,
      emailConfigured: isEmailConfigured(),
      replyTo: profile?.email ?? null,
      history,
    };

    const reason = ineligibleReason(invoice, now);
    if (reason !== null) {
      return NextResponse.json({ ...base, eligible: false, reason });
    }

    const step = nextDunningStep(
      {
        direction: invoice.direction,
        status: invoice.status,
        dueDate: invoice.dueDate,
        // The dialog can supply an address the invoice does not have yet, so
        // eligibility is judged on the ladder, not on the missing recipient.
        customerEmail: recipient ?? "customer@example.com",
      },
      invoice.reminderLogs.map((log) => log.kind),
      now
    )!;

    const facts = buildReminderFacts(invoice, invoice.workspace.name, step, now);
    const draft = await draftReminder(facts, { aiProvider: profile?.aiProvider });

    return NextResponse.json({
      ...base,
      eligible: true,
      step,
      stepLabel: STEP_LABELS[step],
      daysLate: invoice.dueDate ? daysPastDue(invoice.dueDate, now) : 0,
      subject: draft.subject,
      body: draft.body,
      source: draft.source,
    });
  } catch (error) {
    return apiError("GET /api/invoices/[id]/remind", "Failed to draft the reminder", error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireEditionFeature("invoices", "edit_invoices");
    if (!auth.ok) return auth.response;
    const { user, workspace } = auth.ctx;

    const entitlements = await getEntitlements(workspace.id);
    if (!entitlements.plan.limits.dunningEnabled) {
      return NextResponse.json(
        upgradeError("Customer payment reminders", entitlements.planId, entitlements.edition),
        { status: 402 }
      );
    }

    const { id } = await context.params;
    const parsed = invoiceReminderSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message, issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const profile = await prisma.profile.findUnique({
      where: { id: user.id },
      select: { email: true },
    });

    const result = await sendInvoiceReminder({
      workspaceId: workspace.id,
      invoiceId: id,
      toEmail: parsed.data.toEmail,
      subject: parsed.data.subject,
      body: parsed.data.body,
      sentBy: user.id,
      replyTo: profile?.email ?? null,
    });

    if (!result.ok) {
      if (result.reason === "not_found") {
        return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
      }
      return NextResponse.json(
        {
          error: REFUSAL_MESSAGES[result.reason],
          code: result.reason.toUpperCase(),
          sentAt: result.sentAt?.toISOString(),
        },
        { status: 409 }
      );
    }

    if (result.delivery.status === "sent") {
      await recordAudit(workspace.id, user.id, "data.invoice_reminder_sent", {
        invoiceId: id,
        step: result.step,
        toEmail: parsed.data.toEmail,
      });
    }

    return NextResponse.json({
      step: result.step,
      stepLabel: STEP_LABELS[result.step],
      delivery: result.delivery,
      recorded: result.logged,
    });
  } catch (error) {
    return apiError("POST /api/invoices/[id]/remind", "Failed to send the reminder", error);
  }
}

const REFUSAL_MESSAGES: Record<Exclude<SendReminderRefusal, "not_found">, string> = {
  not_dunnable: "Only unpaid invoices you issued, with a due date, can be reminded about.",
  not_unpaid: "This invoice is no longer unpaid, so no reminder was sent.",
  already_sent: "That reminder has already been sent for this invoice.",
};

/** The first reason this invoice has nothing to send, or null when it does. */
function ineligibleReason(
  invoice: {
    direction: "PAYABLE" | "RECEIVABLE";
    status: "DRAFT" | "UNPAID" | "PAID";
    dueDate: Date | null;
    reminderLogs: { kind: "DUE_SOON" | "OVERDUE_1" | "OVERDUE_2" | "FINAL" }[];
  },
  now: Date
): IneligibleReason | null {
  if (invoice.direction !== "RECEIVABLE") return "not_receivable";
  if (invoice.status !== "UNPAID") return "not_unpaid";
  if (!invoice.dueDate) return "no_due_date";
  const step = selectDunningStep(daysPastDue(invoice.dueDate, now));
  if (step === null) return "not_due_yet";
  if (invoice.reminderLogs.some((log) => log.kind === step)) return "already_sent";
  return null;
}
