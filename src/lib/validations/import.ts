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

export const MAX_IMPORT_FILE_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_IMPORT_ROWS = 10_000;
