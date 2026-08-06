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
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  DEFAULT_SORT_DIRECTION,
  PAGE_SIZE_OPTIONS,
  type InvoiceSortKey,
  type SortDirection,
} from "@/components/invoices/types";
import { UploadInvoice } from "@/components/invoices/upload-invoice";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeading } from "@/components/ui/page-heading";
import type { Prisma } from "@/generated/prisma/client";
import { getInvoiceReminders } from "@/lib/invoices/reminders";
import { serializeInvoice } from "@/lib/invoices/serialize";
import { prisma } from "@/lib/prisma";
import { formatCurrency, localeForCurrency } from "@/lib/utils";
import { getWorkspaceContext, type WorkspaceContext } from "@/lib/workspace/context";

export const metadata: Metadata = { title: "Invoices" };
export const dynamic = "force-dynamic";

interface InvoicesPageProps {
  searchParams: Promise<{
    status?: string;
    vendor?: string;
    from?: string;
    to?: string;
    page?: string;
    size?: string;
    sort?: string;
    dir?: string;
  }>;
}

type InvoiceParams = Awaited<InvoicesPageProps["searchParams"]>;

function parsePageSize(value: string | undefined): number {
  const size = Number(value);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE;
}

function parseSort(value: string | undefined): InvoiceSortKey {
  const keys: InvoiceSortKey[] = ["due", "date", "vendor", "amount"];
  return keys.find((key) => key === value) ?? DEFAULT_SORT;
}

function parseDirection(value: string | undefined): SortDirection {
  return value === "asc" || value === "desc" ? value : DEFAULT_SORT_DIRECTION;
}

/**
 * Undated invoices sort last whichever way the date column points: an invoice
 * with no due date is not the most urgent thing on the list.
 */
function buildOrderBy(
  sort: InvoiceSortKey,
  direction: SortDirection
): Prisma.InvoiceOrderByWithRelationInput[] {
  switch (sort) {
    case "amount":
      return [{ total: direction }, { createdAt: "desc" }];
    case "vendor":
      return [{ vendor: direction }, { createdAt: "desc" }];
    case "date":
      return [{ invoiceDate: { sort: direction, nulls: "last" } }, { createdAt: "desc" }];
    default:
      return [{ dueDate: { sort: direction, nulls: "last" } }, { createdAt: "desc" }];
  }
}

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
          <PageHeading>Invoices</PageHeading>
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
  const requestedPage = Math.max(1, Number(params.page ?? "1") || 1);
  const pageSize = parsePageSize(params.size);
  const sort = parseSort(params.sort);
  const direction = parseDirection(params.dir);

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

  const [totalCount, unpaidAggregate, paidThisMonth, reminders] = await Promise.all([
    prisma.invoice.count({ where }),
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

  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(requestedPage, pageCount);

  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: buildOrderBy(sort, direction),
    include: { lineItems: true, transaction: true },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  const hasFilters = Boolean(params.status || params.vendor || params.from || params.to);
  const outstanding = Number(unpaidAggregate._sum.total ?? 0);
  const currency = ctx.workspace.currency;
  const locale = localeForCurrency(currency);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Outstanding"
          value={formatCurrency(outstanding, currency, locale)}
          hint={`${unpaidAggregate._count} unpaid invoice${unpaidAggregate._count === 1 ? "" : "s"}`}
          icon={ReceiptTextIcon}
        />
        <StatCard
          title="Overdue"
          value={formatCurrency(reminders.overdueTotal, currency, locale)}
          hint={`${reminders.overdue.length} invoice${reminders.overdue.length === 1 ? "" : "s"} past due`}
          icon={AlertTriangleIcon}
          tone={reminders.overdue.length > 0 ? "negative" : "default"}
        />
        <StatCard
          title="Due in 7 days"
          value={formatCurrency(reminders.dueSoonTotal, currency, locale)}
          hint={`${reminders.dueSoon.length} invoice${reminders.dueSoon.length === 1 ? "" : "s"} coming up`}
          icon={CalendarClockIcon}
        />
        <StatCard
          title="Paid this month"
          value={formatCurrency(Number(paidThisMonth._sum.total ?? 0), currency, locale)}
          hint={`${paidThisMonth._count} invoice${paidThisMonth._count === 1 ? "" : "s"} settled`}
          icon={CheckCircle2Icon}
          tone="positive"
        />
      </div>

      {reminders.overdue.length > 0 && params.status !== "OVERDUE" && (
        <Link href="/invoices?status=OVERDUE">
          <div className="border-destructive/30 bg-destructive/5 text-destructive-tinted flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors hover:bg-destructive/10">
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
          <InvoicesTable
            invoices={invoices.map(serializeInvoice)}
            hasFilters={hasFilters}
            page={page}
            pageCount={pageCount}
            pageSize={pageSize}
            totalCount={totalCount}
            sort={sort}
            direction={direction}
            canEdit={ctx.permissions.has("edit_invoices")}
            locale={locale}
          />
        </CardContent>
      </Card>
    </>
  );
}
