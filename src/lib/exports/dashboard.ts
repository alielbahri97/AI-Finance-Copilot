import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { BRAND } from "@/lib/branding";
import type { DashboardData } from "@/lib/data";

/** Compact PDF snapshot of the current dashboard KPIs (tables only — no chart pixels). */
export async function buildDashboardPdf(
  data: DashboardData,
  currency: string,
  workspaceName: string
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  let y = 800;
  const ink = rgb(0.12, 0.16, 0.23);
  const muted = rgb(0.45, 0.5, 0.59);

  const line = (
    text: string,
    options: { bold?: boolean; size?: number; color?: ReturnType<typeof rgb> } = {}
  ) => {
    page.drawText(text.slice(0, 95), {
      x: 48,
      y,
      size: options.size ?? 11,
      font: options.bold ? bold : font,
      color: options.color ?? ink,
    });
    y -= (options.size ?? 11) + 8;
  };

  line(`${BRAND.name} — Dashboard snapshot`, { bold: true, size: 16 });
  line(workspaceName, { color: muted, size: 10 });
  line(`Generated ${new Date().toISOString().slice(0, 10)}`, { color: muted, size: 9 });
  y -= 10;
  line("This month", { bold: true, size: 13 });
  line(`Income: ${data.monthIncome} ${currency}`);
  line(`Expenses: ${data.monthExpenses} ${currency}`);
  line(`Savings rate: ${data.savingsRate}%`);
  line(`Cash total (${data.cash.source}): ${data.cash.total} ${currency}`);
  line(`All-time net: ${data.totalBalance} ${currency}`);
  y -= 10;
  line("Top expense categories", { bold: true, size: 12 });
  for (const category of data.categoryBreakdown.slice(0, 8)) {
    if (y < 60) break;
    line(`${category.category}: ${category.amount}`, { size: 9 });
  }
  y -= 8;
  line("Largest expenses", { bold: true, size: 12 });
  for (const tx of data.largestExpenses.slice(0, 8)) {
    if (y < 60) break;
    line(`${tx.date.slice(0, 10)}  ${tx.description}  ${tx.amount}`, { size: 9 });
  }

  return doc.save();
}
