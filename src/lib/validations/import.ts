import { z } from "zod";

const columnIndex = z.number().int().min(0).max(200);

export const columnMappingSchema = z
  .object({
    date: columnIndex,
    description: columnIndex,
    amount: columnIndex.nullable(),
    debit: columnIndex.nullable(),
    credit: columnIndex.nullable(),
    balance: columnIndex.nullable(),
    counterparty: columnIndex.nullable(),
    currency: columnIndex.nullable().optional().default(null),
    numberFormat: z.enum(["us", "eu"]),
    dateFormat: z.enum(["ymd", "dmy", "mdy", "compact"]),
  })
  .refine((mapping) => mapping.amount !== null || mapping.debit !== null || mapping.credit !== null, {
    message: "Map either an amount column or debit/credit columns",
  });

export type ColumnMappingValues = z.infer<typeof columnMappingSchema>;

/** Excel and PDF statements are an order of magnitude heavier than CSV. */
export const MAX_IMPORT_FILE_MB = 20;
export const MAX_IMPORT_FILE_BYTES = MAX_IMPORT_FILE_MB * 1024 * 1024;
export const MAX_IMPORT_ROWS = 10_000;
