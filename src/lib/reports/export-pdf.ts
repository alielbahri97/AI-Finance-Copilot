import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { BRAND } from "@/lib/branding";

import type { ReportData } from "./data";

/**
 * Server-side PDF report built with pdf-lib (no headless browser available).
 * Text/table layout with a simple cursor-based writer and page breaks.
 */

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = rgb(0.12, 0.16, 0.23);
const MUTED = rgb(0.45, 0.5, 0.59);
const RULE = rgb(0.85, 0.87, 0.91);
const HEADER_BG = rgb(0.95, 0.96, 0.98);

interface TableColumn {
  header: string;
  width: number;
  align?: "left" | "right";
}

class PdfWriter {
  page: PDFPage;
  y: number;

  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont
  ) {
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN) {
      this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      this.y = PAGE_HEIGHT - MARGIN;
    }
  }

  text(value: string, options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number } = {}) {
    const size = options.size ?? 10;
    this.ensure(size + 6);
    this.page.drawText(value, {
      x: options.x ?? MARGIN,
      y: this.y - size,
      size,
      font: options.bold ? this.bold : this.font,
      color: options.color ?? INK,
    });
    this.y -= size + 6;
  }

  gap(height: number) {
    this.y -= height;
  }

  rule() {
    this.ensure(8);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.75,
      color: RULE,
    });
    this.y -= 8;
  }

  sectionTitle(title: string) {
    this.ensure(34);
    this.gap(10);
    this.text(title, { size: 13, bold: true });
    this.rule();
  }

  /** Two-column label/value grid for KPI blocks. */
  kpiGrid(entries: { label: string; value: string }[]) {
    const columnWidth = CONTENT_WIDTH / 2;
    for (let index = 0; index < entries.length; index += 2) {
      this.ensure(30);
      const rowTop = this.y;
      for (let column = 0; column < 2; column += 1) {
        const entry = entries[index + column];
        if (!entry) continue;
        const x = MARGIN + column * columnWidth;
        this.page.drawText(entry.label, { x, y: rowTop - 9, size: 8.5, font: this.font, color: MUTED });
        this.page.drawText(entry.value, { x, y: rowTop - 23, size: 12, font: this.bold, color: INK });
      }
      this.y = rowTop - 32;
    }
  }

  table(columns: TableColumn[], rows: string[][]) {
    const rowHeight = 17;
    const drawRow = (cells: string[], options: { header?: boolean }) => {
      this.ensure(rowHeight + 2);
      if (options.header) {
        this.page.drawRectangle({
          x: MARGIN,
          y: this.y - rowHeight + 4,
          width: CONTENT_WIDTH,
          height: rowHeight,
          color: HEADER_BG,
        });
      }
      let x = MARGIN;
      const font = options.header ? this.bold : this.font;
      for (let index = 0; index < columns.length; index += 1) {
        const column = columns[index];
        const raw = cells[index] ?? "";
        const size = 9;
        let cell = raw;
        while (cell.length > 1 && font.widthOfTextAtSize(cell, size) > column.width - 10) {
          cell = cell.slice(0, -2) + "…";
        }
        const textWidth = font.widthOfTextAtSize(cell, size);
        const textX = column.align === "right" ? x + column.width - 4 - textWidth : x + 4;
        this.page.drawText(cell, { x: textX, y: this.y - rowHeight + 9, size, font, color: INK });
        x += column.width;
      }
      this.y -= rowHeight;
      this.page.drawLine({
        start: { x: MARGIN, y: this.y + 4 },
        end: { x: PAGE_WIDTH - MARGIN, y: this.y + 4 },
        thickness: 0.5,
        color: RULE,
      });
    };

    drawRow(columns.map((column) => column.header), { header: true });
    for (const row of rows) drawRow(row, {});
    this.gap(4);
  }
}

function sanitize(value: string): string {
  // Helvetica is WinAnsi-encoded; strip narrow/no-break spaces from Intl output.
  return value.replace(/[\u00A0\u202F\u2009]/g, " ");
}

function money(value: number, currency: string): string {
  return sanitize(
    new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "code" }).format(
      value
    )
  );
}

function pct(value: number | null): string {
  if (value === null) return "";
  return `${value > 0 ? "+" : ""}${value}%`;
}

export async function buildPdfReport(report: ReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${BRAND.name} report — ${report.period.label}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const writer = new PdfWriter(doc, font, bold);
  const currency = report.currency;

  /* Header */
  writer.text(BRAND.name, { size: 20, bold: true });
  writer.text("Executive financial report", { size: 11, color: MUTED });
  writer.gap(2);
  writer.text(
    sanitize(
      `Period: ${report.period.label}  (${report.period.from} to ${report.period.to})  ·  Generated ${report.generatedAt}`
    ),
    { size: 9, color: MUTED }
  );
  writer.rule();

  /* KPIs */
  writer.sectionTitle("Key performance indicators");
  writer.kpiGrid([
    { label: "REVENUE", value: `${money(report.kpis.revenue, currency)}  ${pct(report.kpis.revenueChangePct)} vs prev.` },
    { label: "EXPENSES", value: `${money(report.kpis.expenses, currency)}  ${pct(report.kpis.expensesChangePct)} vs prev.` },
    { label: "PROFIT (NET)", value: `${money(report.kpis.profit, currency)}  ${pct(report.kpis.profitChangePct)} vs prev.` },
    { label: "PROFIT MARGIN", value: report.kpis.marginPct === null ? "n/a" : `${report.kpis.marginPct}%` },
    { label: "CASH AT PERIOD END", value: money(report.kpis.cash, currency) },
    { label: "ACCOUNTS RECEIVABLE / PAYABLE", value: `${money(report.kpis.accountsReceivable, currency)} / ${money(report.kpis.accountsPayable, currency)}` },
  ]);

  /* Monthly trend */
  writer.sectionTitle("Monthly trend");
  writer.table(
    [
      { header: "Month", width: 120 },
      { header: "Revenue", width: 127, align: "right" },
      { header: "Expenses", width: 127, align: "right" },
      { header: "Profit", width: 125, align: "right" },
    ],
    report.monthly.map((month) => [
      month.label,
      money(month.revenue, currency),
      money(month.expenses, currency),
      money(month.profit, currency),
    ])
  );

  /* Yearly comparison */
  if (report.yearly.length > 1) {
    writer.sectionTitle("Year over year");
    writer.table(
      [
        { header: "Year", width: 120 },
        { header: "Revenue", width: 127, align: "right" },
        { header: "Expenses", width: 127, align: "right" },
        { header: "Profit", width: 125, align: "right" },
      ],
      report.yearly.map((year) => [
        String(year.year),
        money(year.revenue, currency),
        money(year.expenses, currency),
        money(year.profit, currency),
      ])
    );
  }

  /* Category breakdown */
  writer.sectionTitle("Category breakdown");
  if (report.expenseCategories.length === 0 && report.incomeCategories.length === 0) {
    writer.text("No categorized activity in this period.", { color: MUTED });
  } else {
    writer.table(
      [
        { header: "Flow", width: 90 },
        { header: "Category", width: 260 },
        { header: "Total", width: 149, align: "right" },
      ],
      [
        ...report.incomeCategories.map((entry) => ["Income", entry.name, money(entry.total, currency)]),
        ...report.expenseCategories.map((entry) => ["Expense", entry.name, money(entry.total, currency)]),
      ]
    );
  }

  /* Top vendors / customers */
  writer.sectionTitle("Top vendors (by spend)");
  if (report.topVendors.length === 0) {
    writer.text("No vendor spend in this period.", { color: MUTED });
  } else {
    writer.table(
      [
        { header: "Vendor", width: 280 },
        { header: "Transactions", width: 100, align: "right" },
        { header: "Total", width: 119, align: "right" },
      ],
      report.topVendors.map((entry) => [entry.name, String(entry.count), money(entry.total, currency)])
    );
  }

  writer.sectionTitle("Top customers (by income)");
  if (report.topCustomers.length === 0) {
    writer.text("No customer income in this period.", { color: MUTED });
  } else {
    writer.table(
      [
        { header: "Customer", width: 280 },
        { header: "Transactions", width: 100, align: "right" },
        { header: "Total", width: 119, align: "right" },
      ],
      report.topCustomers.map((entry) => [entry.name, String(entry.count), money(entry.total, currency)])
    );
  }

  /* AR / AP aging */
  writer.sectionTitle("Receivables & payables aging");
  writer.table(
    [
      { header: "Age", width: 139 },
      { header: "AR invoices", width: 90, align: "right" },
      { header: "AR amount", width: 90, align: "right" },
      { header: "AP invoices", width: 90, align: "right" },
      { header: "AP amount", width: 90, align: "right" },
    ],
    report.arAging.map((bucket, index) => [
      bucket.label.replace("–", "-"),
      String(bucket.count),
      money(bucket.total, currency),
      String(report.apAging[index].count),
      money(report.apAging[index].total, currency),
    ])
  );

  return doc.save();
}
