import JSZip from "jszip";

import { BRAND_SLUG } from "@/lib/branding";
import { prisma } from "@/lib/prisma";

import { buildAuditLogCsv } from "./audit";
import { buildBankBalancesCsv } from "./banks";
import { csvLines } from "./csv";
import { buildInvoicesCsv, loadExportInvoices } from "./invoices";
import { buildFilteredTransactionsCsv, loadExportTransactions } from "./transactions";

const TX_CAP = 20_000;

/**
 * GDPR-style portability archive: JSON manifest + CSV dumps.
 * Always free per HANDOFF — not gated by exportsEnabled.
 */
export async function buildFullDataZip(
  workspaceId: string,
  currency: string,
  workspaceName: string
): Promise<Uint8Array> {
  const zip = new JSZip();
  const generatedAt = new Date().toISOString();

  const [transactions, invoices, categories, members] = await Promise.all([
    loadExportTransactions(workspaceId, {}),
    loadExportInvoices(workspaceId, { includeLines: true }),
    prisma.category.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { profile: { select: { email: true, fullName: true } } },
    }),
  ]);

  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        product: BRAND_SLUG,
        workspaceId,
        workspaceName,
        currency,
        generatedAt,
        counts: {
          transactions: transactions.length,
          invoices: invoices.length,
          categories: categories.length,
          members: members.length,
          cappedAt: TX_CAP,
        },
      },
      null,
      2
    )
  );

  zip.file("transactions.csv", buildFilteredTransactionsCsv(transactions));
  zip.file("invoices.csv", buildInvoicesCsv(invoices, true));
  zip.file("bank-balances.csv", await buildBankBalancesCsv(workspaceId, currency));
  zip.file("audit-log.csv", await buildAuditLogCsv(workspaceId));
  zip.file(
    "categories.csv",
    csvLines([
      ["Id", "Name", "Type", "Color"],
      ...categories.map((category) => [category.id, category.name, category.type, category.color]),
    ])
  );
  zip.file(
    "members.csv",
    csvLines([
      ["Email", "Name", "Role", "Joined at"],
      ...members.map((member) => [
        member.profile.email,
        member.profile.fullName,
        member.role,
        member.joinedAt.toISOString(),
      ]),
    ])
  );
  zip.file(
    "workspace.json",
    JSON.stringify(
      {
        id: workspaceId,
        name: workspaceName,
        currency,
        exportedAt: generatedAt,
      },
      null,
      2
    )
  );

  const buffer = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return buffer;
}
