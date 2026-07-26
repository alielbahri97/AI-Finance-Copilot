import { parseDateWithFormat, parseLocalizedNumber } from "./detect";
import type { ColumnMapping, NormalizedRow, RowError } from "./types";

const MAX_AMOUNT = 1_000_000_000;

/**
 * Applies a column mapping to raw CSV rows, producing normalized transaction
 * rows plus per-row errors for anything that could not be interpreted.
 */
export function normalizeRows(
  rows: string[][],
  mapping: ColumnMapping
): { ok: NormalizedRow[]; errors: RowError[] } {
  const ok: NormalizedRow[] = [];
  const errors: RowError[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const cell = (columnIndex: number | null): string =>
      columnIndex === null ? "" : (row[columnIndex] ?? "").trim();

    const date = parseDateWithFormat(cell(mapping.date), mapping.dateFormat);
    if (!date) {
      errors.push({ rowNumber, message: `Unreadable date "${cell(mapping.date)}"` });
      return;
    }

    let signedAmount: number | null = null;
    if (mapping.amount !== null) {
      signedAmount = parseLocalizedNumber(cell(mapping.amount), mapping.numberFormat);
    } else if (mapping.debit !== null || mapping.credit !== null) {
      const debit = parseLocalizedNumber(cell(mapping.debit), mapping.numberFormat);
      const credit = parseLocalizedNumber(cell(mapping.credit), mapping.numberFormat);
      if (debit !== null && debit !== 0) {
        signedAmount = -Math.abs(debit);
      } else if (credit !== null) {
        signedAmount = Math.abs(credit);
      }
    }

    if (signedAmount === null || Number.isNaN(signedAmount)) {
      errors.push({ rowNumber, message: "Missing or unreadable amount" });
      return;
    }
    if (signedAmount === 0) {
      errors.push({ rowNumber, message: "Zero amount" });
      return;
    }
    if (Math.abs(signedAmount) > MAX_AMOUNT) {
      errors.push({ rowNumber, message: "Amount out of range" });
      return;
    }

    const counterparty = cell(mapping.counterparty);
    let description = cell(mapping.description);
    if (description === "") description = counterparty;
    if (description === "") {
      errors.push({ rowNumber, message: "Missing description" });
      return;
    }

    const balanceRaw = cell(mapping.balance);
    const balance =
      balanceRaw === "" ? null : parseLocalizedNumber(balanceRaw, mapping.numberFormat);

    ok.push({
      date,
      description: description.slice(0, 500),
      counterparty: counterparty === "" ? null : counterparty.slice(0, 200),
      amount: Math.round(Math.abs(signedAmount) * 100) / 100,
      type: signedAmount < 0 ? "EXPENSE" : "INCOME",
      balance,
    });
  });

  return { ok, errors };
}
