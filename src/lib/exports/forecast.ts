import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { BRAND } from "@/lib/branding";
import type { ForecastResult } from "@/lib/finance/forecast";

import { csvLines } from "./csv";

export function buildForecastCsv(forecast: ForecastResult, horizon: "d30" | "d90" | "m12" = "m12"): string {
  const points = forecast.horizons[horizon];
  return csvLines([
    ["Generated at", forecast.generatedAt],
    ["Currency", forecast.currency],
    ["Current balance", forecast.currentBalance],
    ["Runway months", forecast.metrics.runwayMonths],
    ["Net burn rate", forecast.metrics.netBurnRate],
    ["Active assumptions", forecast.activeAssumptions],
    [],
    ["Date", "Actual", "Projected", "Band low", "Band high"],
    ...points.map((point) => [
      point.date,
      point.actual,
      point.projected,
      point.band?.[0] ?? null,
      point.band?.[1] ?? null,
    ]),
    [],
    ["Upcoming bill", "Category", "Amount", "Due date", "Cadence", "Source"],
    ...forecast.upcomingBills.map((bill) => [
      bill.label,
      bill.category,
      bill.amount,
      bill.dueDate,
      bill.cadence,
      bill.source,
    ]),
  ]);
}

export async function buildForecastExcel(forecast: ForecastResult): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = BRAND.name;
  const metrics = workbook.addWorksheet("Metrics");
  metrics.columns = [
    { header: "Metric", key: "metric", width: 28 },
    { header: "Value", key: "value", width: 18 },
  ];
  metrics.addRows([
    { metric: "Currency", value: forecast.currency },
    { metric: "Current balance", value: forecast.currentBalance },
    { metric: "Runway months", value: forecast.metrics.runwayMonths },
    { metric: "Net burn rate", value: forecast.metrics.netBurnRate },
    { metric: "Gross burn rate", value: forecast.metrics.grossBurnRate },
    { metric: "Projected balance 30d", value: forecast.metrics.projectedBalance30d },
    { metric: "Projected balance 90d", value: forecast.metrics.projectedBalance90d },
    { metric: "Projected balance 12m", value: forecast.metrics.projectedBalance12m },
    { metric: "Active assumptions", value: forecast.activeAssumptions },
  ]);

  const series = workbook.addWorksheet("Projection 12m");
  series.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Actual", key: "actual", width: 14 },
    { header: "Projected", key: "projected", width: 14 },
    { header: "Band low", key: "low", width: 12 },
    { header: "Band high", key: "high", width: 12 },
  ];
  for (const point of forecast.horizons.m12) {
    series.addRow({
      date: point.date,
      actual: point.actual,
      projected: point.projected,
      low: point.band?.[0] ?? null,
      high: point.band?.[1] ?? null,
    });
  }

  const bills = workbook.addWorksheet("Upcoming bills");
  bills.columns = [
    { header: "Label", key: "label", width: 28 },
    { header: "Category", key: "category", width: 18 },
    { header: "Amount", key: "amount", width: 12 },
    { header: "Due date", key: "dueDate", width: 12 },
    { header: "Cadence", key: "cadence", width: 12 },
    { header: "Source", key: "source", width: 12 },
  ];
  for (const bill of forecast.upcomingBills) bills.addRow(bill);

  for (const sheet of [metrics, series, bills]) {
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

/** Table-style PDF summary (chart rendering needs a browser; pdf-lib is text-only). */
export async function buildForecastPdf(forecast: ForecastResult): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  let y = 800;
  const ink = rgb(0.12, 0.16, 0.23);
  const muted = rgb(0.45, 0.5, 0.59);

  const line = (text: string, options: { bold?: boolean; size?: number; color?: ReturnType<typeof rgb> } = {}) => {
    page.drawText(text.slice(0, 90), {
      x: 48,
      y,
      size: options.size ?? 11,
      font: options.bold ? bold : font,
      color: options.color ?? ink,
    });
    y -= (options.size ?? 11) + 8;
  };

  line(`${BRAND.name} — Cash flow forecast`, { bold: true, size: 16 });
  line(`Generated ${forecast.generatedAt}`, { color: muted, size: 9 });
  y -= 8;
  line(`Currency: ${forecast.currency}`);
  line(`Current balance: ${forecast.currentBalance}`);
  line(
    `Runway: ${forecast.metrics.runwayMonths === null ? "∞ (cash-flow positive)" : `${forecast.metrics.runwayMonths} months`}`
  );
  line(`Net burn rate: ${forecast.metrics.netBurnRate} / month`);
  line(`Projected 30d / 90d / 12m: ${forecast.metrics.projectedBalance30d} / ${forecast.metrics.projectedBalance90d} / ${forecast.metrics.projectedBalance12m}`);
  line(`Active assumptions: ${forecast.activeAssumptions}`);
  y -= 12;
  line("Upcoming bills", { bold: true, size: 13 });
  for (const bill of forecast.upcomingBills.slice(0, 20)) {
    if (y < 60) break;
    line(`${bill.dueDate}  ${bill.label}  ${bill.amount}  (${bill.cadence})`, { size: 9 });
  }
  y -= 12;
  if (y > 80) {
    line("Projection sample (every ~30 days of 12m horizon)", { bold: true, size: 12 });
    const sample = forecast.horizons.m12.filter((_, i) => i % 30 === 0).slice(0, 14);
    for (const point of sample) {
      if (y < 60) break;
      line(
        `${point.date}  actual=${point.actual ?? "—"}  projected=${point.projected ?? "—"}`,
        { size: 9 }
      );
    }
  }

  return doc.save();
}
