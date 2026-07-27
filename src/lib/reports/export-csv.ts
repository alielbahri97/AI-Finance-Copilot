import type { ReportData, ReportTransaction } from "./data";

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvLines(rows: (string | number | null)[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function buildTransactionsCsv(transactions: ReportTransaction[]): string {
  return csvLines([
    ["Date", "Type", "Description", "Counterparty", "Category", "Amount"],
    ...transactions.map((tx) => [
      tx.date,
      tx.type,
      tx.description,
      tx.counterparty,
      tx.category,
      tx.type === "EXPENSE" ? -tx.amount : tx.amount,
    ]),
  ]);
}

export function buildMonthlySummaryCsv(report: ReportData): string {
  return csvLines([
    ["Month", "Revenue", "Expenses", "Profit"],
    ...report.monthly.map((month) => [month.key, month.revenue, month.expenses, month.profit]),
    [],
    ["Period", report.period.label],
    ["Currency", report.currency],
    ["Revenue", report.kpis.revenue],
    ["Expenses", report.kpis.expenses],
    ["Profit", report.kpis.profit],
    ["Profit margin %", report.kpis.marginPct],
    ["Cash at period end", report.kpis.cash],
    ["Accounts receivable", report.kpis.accountsReceivable],
    ["Accounts payable", report.kpis.accountsPayable],
  ]);
}
