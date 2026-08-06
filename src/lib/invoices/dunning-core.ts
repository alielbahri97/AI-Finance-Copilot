/**
 * The decision layer of customer-facing payment reminders (dunning): which
 * rung of the escalation ladder an invoice is on, whether it may be climbed,
 * and what the reminder says. Pure functions only — no database, no network,
 * no AI — so every rule here is directly testable, which matters more than
 * usual for a feature that emails other people's customers.
 *
 * The one design rule: a reminder may only repeat facts it was given. The AI
 * writes the prose, this module supplies the numbers, and nothing downstream
 * lets the model introduce a payment detail of its own.
 */

import type { DunningStep } from "@/generated/prisma/client";
import { extractFirstJsonBlock } from "@/lib/ai/categorize-core";
import { formatCurrency } from "@/lib/utils";

export type { DunningStep };

/** The ladder, in the order it is climbed. */
export const DUNNING_STEPS: readonly DunningStep[] = [
  "DUE_SOON",
  "OVERDUE_1",
  "OVERDUE_2",
  "FINAL",
];

/** How early a heads-up goes out before the due date. */
export const DUE_SOON_LEAD_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const STEP_LABELS: Record<DunningStep, string> = {
  DUE_SOON: "Due soon",
  OVERDUE_1: "First reminder",
  OVERDUE_2: "Second reminder",
  FINAL: "Final reminder",
};

/**
 * Whole days between the due date and now, counted from calendar day to
 * calendar day in UTC so an invoice does not become "1 day late" at 00:01
 * because of the hour a cron happened to run. Positive = late.
 */
export function daysPastDue(dueDate: Date, now: Date): number {
  const due = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((today - due) / MS_PER_DAY);
}

/**
 * The one rung an invoice is on today, from how late it is:
 *
 *   due within 7 days (0 or fewer days late) → DUE_SOON
 *   1-14 late                                → OVERDUE_1
 *   15-30 late                               → OVERDUE_2
 *   more than 30 late                        → FINAL
 *
 * Returns null for an invoice that is not due for more than a week yet:
 * chasing money nobody owes yet is how a reminder becomes spam.
 *
 * Exactly one step comes back, which is also what stops a cron catching up
 * after downtime from firing a whole ladder at one customer in one run: a
 * 40-day-old invoice is on FINAL, and the steps it never reached stay unsent.
 */
export function selectDunningStep(daysLate: number): DunningStep | null {
  if (daysLate < -DUE_SOON_LEAD_DAYS) return null;
  if (daysLate <= 0) return "DUE_SOON";
  if (daysLate <= 14) return "OVERDUE_1";
  if (daysLate <= 30) return "OVERDUE_2";
  return "FINAL";
}

/** The invoice fields eligibility is decided from. */
export interface DunnableInvoice {
  direction: "PAYABLE" | "RECEIVABLE";
  status: "DRAFT" | "UNPAID" | "PAID";
  dueDate: Date | null;
  customerEmail: string | null;
}

/**
 * Whether an invoice could ever be dunned. A payable is somebody else's
 * receivable — reminding a vendor to collect from us is not a feature — and
 * an invoice with no customer address has nobody to remind.
 */
export function isDunnable(invoice: DunnableInvoice): boolean {
  return (
    invoice.direction === "RECEIVABLE" &&
    invoice.status === "UNPAID" &&
    invoice.dueDate !== null &&
    normalizeEmail(invoice.customerEmail) !== null
  );
}

/** Trims and rejects anything that is not plausibly an address. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (value.length === 0 || value.length > 320) return null;
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value) ? value : null;
}

/**
 * The step to send now, or null. Everything the caller needs to know sits in
 * this one answer: not a receivable, not unpaid, no address, not due yet, or
 * this rung was already climbed all collapse to "nothing to send".
 */
export function nextDunningStep(
  invoice: DunnableInvoice,
  alreadySent: Iterable<DunningStep>,
  now: Date
): DunningStep | null {
  if (!isDunnable(invoice)) return null;
  const step = selectDunningStep(daysPastDue(invoice.dueDate!, now));
  if (step === null) return null;
  return new Set(alreadySent).has(step) ? null : step;
}

/* ------------------------------------------------------------------ */
/* Drafting                                                            */
/* ------------------------------------------------------------------ */

/** Everything a reminder is allowed to mention. */
export interface ReminderFacts {
  step: DunningStep;
  /** The workspace sending the reminder, as it should sign off. */
  companyName: string;
  /** The customer being reminded, i.e. the invoice's counterparty. */
  customerName: string;
  invoiceNumber: string | null;
  amount: number;
  currency: string;
  /** ISO day (YYYY-MM-DD). */
  dueDate: string;
  /** Positive when late, negative when the invoice is not due yet. */
  daysLate: number;
}

export interface ReminderDraft {
  subject: string;
  body: string;
}

export const MAX_SUBJECT_LENGTH = 200;
export const MAX_BODY_LENGTH = 4000;

/** "invoice INV-0042" or just "the invoice" when it was never numbered. */
function invoiceLabel(facts: ReminderFacts): string {
  return facts.invoiceNumber ? `invoice ${facts.invoiceNumber}` : "the invoice";
}

function formatDay(isoDay: string): string {
  const parsed = new Date(`${isoDay}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDay;
  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function amountText(facts: ReminderFacts): string {
  return formatCurrency(facts.amount, facts.currency);
}

/**
 * The reminder Ballast sends when no AI provider is configured, the call
 * fails, or the model answers with something unusable. It is a real reminder,
 * not a placeholder: an unconfigured key must cost the user polish, never the
 * payment. Tone climbs with the step exactly as the prompt asks the model to.
 */
export function buildFallbackDraft(facts: ReminderFacts): ReminderDraft {
  const label = invoiceLabel(facts);
  const amount = amountText(facts);
  const due = formatDay(facts.dueDate);
  const late = Math.max(0, facts.daysLate);
  const greeting = `Hi ${facts.customerName || "there"},`;
  const signOff = `Thank you,\n${facts.companyName}`;

  switch (facts.step) {
    case "DUE_SOON":
      return {
        subject: `${capitalize(label)} is due on ${due}`,
        body: [
          greeting,
          `A friendly reminder that ${label} for ${amount} is due on ${due}.`,
          "If it is already on its way, please ignore this message.",
          signOff,
        ].join("\n\n"),
      };
    case "OVERDUE_1":
      return {
        subject: `Reminder: ${label} is past due`,
        body: [
          greeting,
          `${capitalize(label)} for ${amount} was due on ${due} and is now ${dayCount(late)} past due.`,
          "Could you let us know when we can expect payment? If you have already paid, please disregard this message.",
          signOff,
        ].join("\n\n"),
      };
    case "OVERDUE_2":
      return {
        subject: `Second reminder: ${label} is ${dayCount(late)} overdue`,
        body: [
          greeting,
          `${capitalize(label)} for ${amount}, due on ${due}, is now ${dayCount(late)} overdue and remains unpaid.`,
          "Please arrange payment, or reply to this email if something is holding it up so we can sort it out together.",
          signOff,
        ].join("\n\n"),
      };
    case "FINAL":
      return {
        subject: `Final reminder: ${label} is ${dayCount(late)} overdue`,
        body: [
          greeting,
          `Despite our earlier reminders, ${label} for ${amount} — due on ${due} — is still unpaid, ${dayCount(late)} after the due date.`,
          "Please settle the outstanding amount, or reply to this email so we can agree how to resolve it.",
          signOff,
        ].join("\n\n"),
      };
  }
}

function dayCount(days: number): string {
  return `${days} day${days === 1 ? "" : "s"}`;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

/** How the model is told to sound at each rung. */
const STEP_TONE: Record<DunningStep, string> = {
  DUE_SOON: "warm and low-pressure — nothing is late yet, this is a courtesy heads-up",
  OVERDUE_1: "polite and matter-of-fact, assuming an oversight rather than a refusal",
  OVERDUE_2: "firmer and more direct, asking for a payment date and offering to help if something is wrong",
  FINAL: "serious and final in tone but still professional — never threatening, never mentioning fees, lawyers or collections",
};

export interface ReminderPrompt {
  system: string;
  user: string;
}

/**
 * The prompt is deliberately closed-world: the model gets the facts, is told
 * to use nothing else, and is explicitly forbidden the details it would
 * otherwise be happy to invent — bank accounts, payment links, late fees,
 * discounts, or a legal deadline nobody agreed to.
 */
export function buildReminderPrompt(facts: ReminderFacts, brandName: string): ReminderPrompt {
  const status =
    facts.daysLate > 0
      ? `${dayCount(facts.daysLate)} past due`
      : facts.daysLate === 0
        ? "due today"
        : `due in ${dayCount(-facts.daysLate)}`;

  const system = [
    `You are writing on behalf of ${facts.companyName}, a business using ${brandName}.`,
    "Write one payment-reminder email to a customer about a single unpaid invoice.",
    `Tone: ${STEP_TONE[facts.step]}.`,
    "Rules you must not break:",
    "- Use ONLY the facts listed below. Never invent bank details, IBANs, payment links, portals, phone numbers, contract clauses, late fees, interest, discounts or deadlines.",
    "- Do not claim anything about previous conversations, promises or payments you were not told about.",
    "- Do not threaten legal action, debt collection or service suspension.",
    "- Plain text only: no markdown, no headings, no bullet lists, no placeholders such as [Your name].",
    `- Sign off as ${facts.companyName}.`,
    `Answer with JSON only: {"subject": "...", "body": "..."} — subject under 90 characters, body under 180 words.`,
  ].join("\n");

  const user = [
    "INVOICE FACTS",
    `Customer: ${facts.customerName || "(name unknown)"}`,
    `Invoice number: ${facts.invoiceNumber ?? "(not numbered)"}`,
    `Amount outstanding: ${amountText(facts)}`,
    `Due date: ${formatDay(facts.dueDate)}`,
    `Status: ${status}`,
    `Sender: ${facts.companyName}`,
  ].join("\n");

  return { system, user };
}

/**
 * Reads a draft out of whatever the model replied with. Anything malformed,
 * empty or over-long is rejected rather than patched up, because the caller
 * has a perfectly good deterministic reminder to fall back to.
 */
export function parseReminderDraft(raw: string): ReminderDraft | null {
  const block = extractFirstJsonBlock(raw);
  if (!block) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const subject = typeof record.subject === "string" ? cleanLine(record.subject) : "";
  const body = typeof record.body === "string" ? cleanBody(record.body) : "";
  if (subject.length === 0 || body.length === 0) return null;
  if (subject.length > MAX_SUBJECT_LENGTH || body.length > MAX_BODY_LENGTH) return null;

  return { subject, body };
}

function cleanLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanBody(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
