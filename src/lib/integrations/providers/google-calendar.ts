import "server-only";

import { createHash } from "node:crypto";

import { BRAND } from "@/lib/branding";
import { buildForecast } from "@/lib/finance/data";
import { prisma } from "@/lib/prisma";

import { IntegrationAuthError, IntegrationError, appUrl } from "../oauth";

import type { ProviderHooks, SyncContext, SyncStats } from "./types";

/**
 * Google Calendar: creates all-day events on the user's primary calendar for
 * upcoming recurring bills (forecast engine) and unpaid invoice due dates.
 * Events get deterministic ids (sha256 of the bill key — hex is valid
 * base32hex for the Calendar API), so re-syncs are idempotent: an existing
 * id answers 409 and is counted as already present. Off by default —
 * the user opts in with the "Create calendar events" toggle.
 */

const CALENDAR = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const WINDOW_DAYS = 30;

interface CalendarEventInput {
  key: string;
  date: string;
  title: string;
  description: string;
}

function eventId(workspaceId: string, key: string): string {
  return createHash("sha256").update(`${workspaceId}|${key}`).digest("hex");
}

async function createEvent(
  accessToken: string,
  workspaceId: string,
  event: CalendarEventInput
): Promise<"created" | "existing"> {
  const endDate = new Date(`${event.date}T00:00:00.000Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);

  const response = await fetch(CALENDAR, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: eventId(workspaceId, event.key),
      summary: event.title,
      description: `${event.description}\n\n${appUrl()}/forecast`,
      start: { date: event.date },
      end: { date: endDate.toISOString().slice(0, 10) },
      transparency: "transparent",
    }),
  });

  if (response.status === 409) return "existing";
  if (response.status === 401 || response.status === 403) {
    throw new IntegrationAuthError("Google Calendar token rejected; reconnect required");
  }
  if (!response.ok) {
    throw new IntegrationError(`Google Calendar event creation failed: HTTP ${response.status}`);
  }
  return "created";
}

async function sync(ctx: SyncContext): Promise<SyncStats> {
  if (ctx.metadata.calendarEnabled !== true) {
    return { skippedDisabled: 1 };
  }
  if (!ctx.accessToken) {
    throw new IntegrationAuthError("Google Calendar connection has no access token");
  }

  const windowEnd = new Date(Date.now() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const windowEndIso = windowEnd.toISOString().slice(0, 10);
  const todayIso = new Date().toISOString().slice(0, 10);

  const [forecast, invoices] = await Promise.all([
    buildForecast(ctx.workspaceId, ctx.currency),
    prisma.invoice.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        status: "UNPAID",
        dueDate: { gte: new Date(), lte: windowEnd },
      },
      select: { id: true, vendor: true, invoiceNumber: true, total: true, dueDate: true, currency: true },
      take: 30,
    }),
  ]);

  const events: CalendarEventInput[] = [];

  for (const bill of forecast.upcomingBills) {
    if (bill.dueDate < todayIso || bill.dueDate > windowEndIso) continue;
    events.push({
      key: `bill:${bill.label}:${bill.dueDate}`,
      date: bill.dueDate,
      title: `Bill due: ${bill.label} (${ctx.currency} ${bill.amount.toFixed(2)})`,
      description: `Recurring ${bill.cadence} payment detected by ${BRAND.name}.`,
    });
  }

  for (const invoice of invoices) {
    const date = invoice.dueDate!.toISOString().slice(0, 10);
    events.push({
      key: `invoice:${invoice.id}`,
      date,
      title: `Invoice due: ${invoice.vendor || "Unknown vendor"} (${invoice.currency} ${Number(invoice.total).toFixed(2)})`,
      description: `Invoice ${invoice.invoiceNumber ?? invoice.id} is due.`,
    });
  }

  let created = 0;
  let existing = 0;
  for (const event of events.slice(0, 40)) {
    const outcome = await createEvent(ctx.accessToken, ctx.workspaceId, event);
    if (outcome === "created") created += 1;
    else existing += 1;
  }

  return { candidates: events.length, created, existing };
}

export const googleCalendarHooks: ProviderHooks = { sync };
