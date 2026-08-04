import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ReceiptTextIcon,
} from "lucide-react";

import {
  StatRowSkeleton,
  TableCardSkeleton,
} from "@/components/dashboard/section-skeletons";
import { StatCard } from "@/components/dashboard/stat-card";
import { InvoicesTable } from "@/components/invoices/invoices-table";
import { InvoicesToolbar } from "@/components/invoices/invoices-toolbar";
import { UploadInvoice } from "@/components/invoices/upload-invoice";
import { Card, CardContent } from "@/components/ui/card";
import type { Prisma } from "@/generated/prisma/client";
import { getInvoiceReminders } from "@/lib/invoices/reminders";
import { serializeInvoice } from "@/lib/invoices/serialize";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { getWorkspaceContext, type WorkspaceContext } from "@/lib/workspace/context";

export const metadata: Metadata = { title: "Invoices" };
export const dynamic = "force-dynamic";

interface InvoicesPageProps {
  searchParams: Promise<{ status?: string; vendor?: string; from?: string; to?: string }>;
}

type InvoiceParams = Awaited<InvoicesPageProps["searchParams"]>;

/** Streams: header and upload action paint first, stats and table follow. */
export default async function InvoicesPage({ searchParams }: InvoicesPageProps) {
  const ctx = await getWorkspaceContext();
  if (!ctx) redirect("/login");
  if (!ctx.permissions.has("view_invoices")) redirect("/dashboard");
  const canEdit = ctx.permissions.has("edit_invoices");

  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          <p className="text-muted-foreground text-sm">
            Upload documents, review extracted data and track what needs to be paid.
          </p>
        </div>
        {canEdit && <UploadInvoice />}
      </div>

      <Suspense
        fallback={
          <>
            <StatRowSkeleton />
            <TableCardSkeleton />
          </>
        }
      >
        <InvoicesContent ctx={ctx} params={params} />
      </Suspense>
    </div>
  );
}

async function InvoicesContent({ ctx, params }: { ctx: WorkspaceContext; params: InvoiceParams }) {
  const where: Prisma.InvoiceWhereInput = { workspaceId: ctx.workspace.id };
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
      where: { workspaceId: ctx.workspace.id, status: "UNPAID" },
      _sum: { total: true },
      _count: true,
    }),
    prisma.invoice.aggregate({
      where: { workspaceId: ctx.workspace.id, status: "PAID", updatedAt: { gte: monthStart } },
      _sum: { total: true },
      _count: true,
    }),
    getInvoiceReminders(ctx.workspace.id),
  ]);

  const hasFilters = Boolean(params.status || params.vendor || params.from || params.to);
  const outstanding = Number(unpaidAggregate._sum.total ?? 0);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Outstanding"
          value={formatCurrency(outstanding, ctx.workspace.currency)}
          hint={`${unpaidAggregate._count} unpaid invoice${unpaidAggregate._count === 1 ? "" : "s"}`}
          icon={ReceiptTextIcon}
        />
        <StatCard
          title="Overdue"
          value={formatCurrency(reminders.overdueTotal, ctx.workspace.currency)}
          hint={`${reminders.overdue.length} invoice${reminders.overdue.length === 1 ? "" : "s"} past due`}
          icon={AlertTriangleIcon}
          tone={reminders.overdue.length > 0 ? "negative" : "default"}
        />
        <StatCard
          title="Due in 7 days"
          value={formatCurrency(reminders.dueSoonTotal, ctx.workspace.currency)}
          hint={`${reminders.dueSoon.length} invoice${reminders.dueSoon.length === 1 ? "" : "s"} coming up`}
          icon={CalendarClockIcon}
        />
        <StatCard
          title="Paid this month"
          value={formatCurrency(Number(paidThisMonth._sum.total ?? 0), ctx.workspace.currency)}
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
    </>
  );
}
