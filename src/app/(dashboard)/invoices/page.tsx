import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ReceiptTextIcon,
} from "lucide-react";

import { StatCard } from "@/components/dashboard/stat-card";
import { InvoicesTable } from "@/components/invoices/invoices-table";
import { InvoicesToolbar } from "@/components/invoices/invoices-toolbar";
import { UploadInvoice } from "@/components/invoices/upload-invoice";
import { Card, CardContent } from "@/components/ui/card";
import type { Prisma } from "@/generated/prisma/client";
import { getOrCreateProfile } from "@/lib/data";
import { getInvoiceReminders } from "@/lib/invoices/reminders";
import { serializeInvoice } from "@/lib/invoices/serialize";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";

export const metadata: Metadata = { title: "Invoices" };
export const dynamic = "force-dynamic";

interface InvoicesPageProps {
  searchParams: Promise<{ status?: string; vendor?: string; from?: string; to?: string }>;
}

export default async function InvoicesPage({ searchParams }: InvoicesPageProps) {
  const user = await getUser();
  if (!user) redirect("/login");

  const profile = await getOrCreateProfile(user);
  const params = await searchParams;

  const where: Prisma.InvoiceWhereInput = { userId: user.id };
  if (params.status === "OVERDUE") {
    where.status = "UNPAID";
    where.dueDate = { lt: new Date() };
  } else if (params.status && ["DRAFT", "UNPAID", "PAID"].includes(params.status)) {
    where.status = params.status as "DRAFT" | "UNPAID" | "PAID";
  }
  if (params.vendor) {
    where.vendor = { contains: params.vendor, mode: "insensitive" };
  }
  const from = params.from ? new Date(params.from) : null;
  const to = params.to ? new Date(params.to) : null;
  if ((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))) {
    where.invoiceDate = {
      ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
      ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
    };
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [invoices, unpaidAggregate, paidThisMonth, reminders] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { lineItems: true, transaction: true },
      take: 200,
    }),
    prisma.invoice.aggregate({
      where: { userId: user.id, status: "UNPAID" },
      _sum: { total: true },
      _count: true,
    }),
    prisma.invoice.aggregate({
      where: { userId: user.id, status: "PAID", updatedAt: { gte: monthStart } },
      _sum: { total: true },
      _count: true,
    }),
    getInvoiceReminders(user.id),
  ]);

  const hasFilters = Boolean(params.status || params.vendor || params.from || params.to);
  const outstanding = Number(unpaidAggregate._sum.total ?? 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          <p className="text-muted-foreground text-sm">
            Upload documents, review extracted data and track what needs to be paid.
          </p>
        </div>
        <UploadInvoice />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Outstanding"
          value={formatCurrency(outstanding, profile.currency)}
          hint={`${unpaidAggregate._count} unpaid invoice${unpaidAggregate._count === 1 ? "" : "s"}`}
          icon={ReceiptTextIcon}
        />
        <StatCard
          title="Overdue"
          value={formatCurrency(reminders.overdueTotal, profile.currency)}
          hint={`${reminders.overdue.length} invoice${reminders.overdue.length === 1 ? "" : "s"} past due`}
          icon={AlertTriangleIcon}
          tone={reminders.overdue.length > 0 ? "negative" : "default"}
        />
        <StatCard
          title="Due in 7 days"
          value={formatCurrency(reminders.dueSoonTotal, profile.currency)}
          hint={`${reminders.dueSoon.length} invoice${reminders.dueSoon.length === 1 ? "" : "s"} coming up`}
          icon={CalendarClockIcon}
        />
        <StatCard
          title="Paid this month"
          value={formatCurrency(Number(paidThisMonth._sum.total ?? 0), profile.currency)}
          hint={`${paidThisMonth._count} invoice${paidThisMonth._count === 1 ? "" : "s"} settled`}
          icon={CheckCircle2Icon}
          tone="positive"
        />
      </div>

      {reminders.overdue.length > 0 && params.status !== "OVERDUE" && (
        <Link href="/invoices?status=OVERDUE">
          <div className="border-destructive/30 bg-destructive/5 text-destructive flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors hover:bg-destructive/10">
            <AlertTriangleIcon className="size-4 shrink-0" />
            {reminders.overdue.length === 1
              ? "1 invoice is overdue"
              : `${reminders.overdue.length} invoices are overdue`}{" "}
            — view them now
          </div>
        </Link>
      )}

      <Card>
        <CardContent className="flex flex-col gap-4">
          <InvoicesToolbar />
          <InvoicesTable invoices={invoices.map(serializeInvoice)} hasFilters={hasFilters} />
        </CardContent>
      </Card>
    </div>
  );
}
