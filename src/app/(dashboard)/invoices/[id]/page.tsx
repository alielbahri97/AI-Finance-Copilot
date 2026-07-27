import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon, ScanSearchIcon } from "lucide-react";

import { DocumentPreview } from "@/components/invoices/document-preview";
import { InvoiceActions } from "@/components/invoices/invoice-actions";
import { InvoiceForm } from "@/components/invoices/invoice-form";
import { InvoiceStatusBadge } from "@/components/invoices/status-badge";
import { TransactionLink } from "@/components/invoices/transaction-link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { serializeInvoice } from "@/lib/invoices/serialize";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";

interface InvoiceDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function InvoiceDetailPage({ params }: InvoiceDetailPageProps) {
  const user = await getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const invoice = await prisma.invoice.findFirst({
    where: { id, userId: user.id },
    include: { lineItems: true, transaction: true },
  });
  if (!invoice) notFound();

  const dto = serializeInvoice(invoice);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Link
            href="/invoices"
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm transition-colors"
          >
            <ArrowLeftIcon className="size-3.5" />
            Back to invoices
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              {dto.vendor || "Unknown vendor"}
            </h1>
            <InvoiceStatusBadge status={dto.derivedStatus} />
          </div>
          <p className="text-muted-foreground text-sm">
            {dto.invoiceNumber ? `Invoice ${dto.invoiceNumber}` : dto.fileName}
          </p>
        </div>
        <InvoiceActions invoice={dto} />
      </div>

      {dto.status === "DRAFT" && (
        <div className="border-chart-4/40 bg-chart-4/10 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm">
          <ScanSearchIcon className="size-4 shrink-0" />
          {dto.extractionStatus === "EXTRACTED"
            ? "Review the extracted fields below, correct anything that is off, then confirm."
            : "We could not extract this document automatically. Fill in the details manually — the original file stays attached."}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Document</CardTitle>
            <CardDescription>Original file, served through a signed URL</CardDescription>
          </CardHeader>
          <CardContent>
            <DocumentPreview invoiceId={dto.id} fileName={dto.fileName} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{dto.status === "DRAFT" ? "Review extracted data" : "Invoice details"}</CardTitle>
            <CardDescription>
              {dto.status === "DRAFT"
                ? "Confirming saves the invoice as unpaid"
                : "Edit and save any field"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InvoiceForm key={dto.id} invoice={dto} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Linked transaction</CardTitle>
          <CardDescription>
            Match this invoice with a bank transaction — linking marks it paid
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TransactionLink invoice={dto} />
        </CardContent>
      </Card>
    </div>
  );
}
