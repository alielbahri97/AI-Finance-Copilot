import ExcelJS from "exceljs";

import type { ReportData, ReportTransaction } from "./data";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E293B" },
};

function addTable(
  sheet: ExcelJS.Worksheet,
  columns: { header: string; key: string; width?: number; money?: boolean }[],
  rows: Record<string, string | number | null>[],
  currency: string
) {
  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width ?? 18,
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = HEADER_FILL;

  for (const row of rows) sheet.addRow(row);

  for (const column of columns) {
    if (column.money) {
      sheet.getColumn(column.key).numFmt = `#,##0.00 "${currency}"`;
    }
  }
}

/** Builds a multi-sheet .xlsx report and returns the file bytes. */
export async function buildExcelReport(
  report: ReportData,
  transactions: ReportTransaction[]
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "FinPilot";
  workbook.created = new Date();
  const currency = report.currency;

  const kpiSheet = workbook.addWorksheet("KPIs");
  addTable(
    kpiSheet,
    [
      { header: "Metric", key: "metric", width: 30 },
      { header: "Value", key: "value", width: 22 },
    ],
    [
      { metric: "Period", value: report.period.label },
      { metric: "From", value: report.period.from },
      { metric: "To", value: report.period.to },
      { metric: "Currency", value: currency },
      { metric: "Revenue", value: report.kpis.revenue },
      { metric: "Expenses", value: report.kpis.expenses },
      { metric: "Profit (net)", value: report.kpis.profit },
      { metric: "Profit margin %", value: report.kpis.marginPct },
      { metric: "Cash at period end", value: report.kpis.cash },
      { metric: "Accounts receivable", value: report.kpis.accountsReceivable },
      { metric: "Accounts payable", value: report.kpis.accountsPayable },
      { metric: "Revenue change % vs previous period", value: report.kpis.revenueChangePct },
      { metric: "Expenses change % vs previous period", value: report.kpis.expensesChangePct },
      { metric: "Profit change % vs previous period", value: report.kpis.profitChangePct },
    ],
    currency
  );

  addTable(
    workbook.addWorksheet("Monthly trends"),
    [
      { header: "Month", key: "key", width: 12 },
      { header: "Revenue", key: "revenue", money: true },
      { header: "Expenses", key: "expenses", money: true },
      { header: "Profit", key: "profit", money: true },
    ],
    report.monthly.map((month) => ({ ...month })),
    currency
  );

  addTable(
    workbook.addWorksheet("Transactions"),
    [
      { header: "Date", key: "date", width: 12 },
      { header: "Type", key: "type", width: 10 },
      { header: "Description", key: "description", width: 44 },
      { header: "Counterparty", key: "counterparty", width: 28 },
      { header: "Category", key: "category", width: 20 },
      { header: "Amount", key: "amount", money: true },
    ],
    transactions.map((tx) => ({
      ...tx,
      amount: tx.type === "EXPENSE" ? -tx.amount : tx.amount,
    })),
    currency
  );

  addTable(
    workbook.addWorksheet("Category breakdown"),
    [
      { header: "Flow", key: "flow", width: 10 },
      { header: "Category", key: "name", width: 26 },
      { header: "Total", key: "total", money: true },
    ],
    [
      ...report.incomeCategories.map((entry) => ({ flow: "Income", ...entry })),
      ...report.expenseCategories.map((entry) => ({ flow: "Expense", ...entry })),
    ].map(({ flow, name, total }) => ({ flow, name, total })),
    currency
  );

  addTable(
    workbook.addWorksheet("Top vendors & customers"),
    [
      { header: "Kind", key: "kind", width: 12 },
      { header: "Name", key: "name", width: 30 },
      { header: "Transactions", key: "count", width: 14 },
      { header: "Total", key: "total", money: true },
    ],
    [
      ...report.topVendors.map((entry) => ({ kind: "Vendor", ...entry })),
      ...report.topCustomers.map((entry) => ({ kind: "Customer", ...entry })),
    ],
    currency
  );

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
