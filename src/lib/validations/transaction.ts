import { z } from "zod";

/** Server-side schema: validates the JSON payload sent to the API. */
export const transactionSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  amount: z.coerce
    .number({ error: "Enter an amount" })
    .positive("Amount must be greater than zero")
    .max(1_000_000_000, "Amount is too large"),
  categoryId: z.string().min(1).nullable().optional(),
  description: z.string().min(1, "Add a short description").max(500),
  counterparty: z.string().max(200).nullable().optional(),
  date: z.coerce.date({ error: "Pick a date" }),
});

export type TransactionValues = z.infer<typeof transactionSchema>;

/** Partial update used by inline edits. */
export const transactionUpdateSchema = z
  .object({
    type: z.enum(["INCOME", "EXPENSE"]).optional(),
    amount: z.coerce.number().positive().max(1_000_000_000).optional(),
    categoryId: z.string().min(1).nullable().optional(),
    description: z.string().min(1).max(500).optional(),
    counterparty: z.string().max(200).nullable().optional(),
    date: z.coerce.date().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update" });

export const bulkActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("setCategory"),
    ids: z.array(z.string().min(1)).min(1).max(1000),
    categoryId: z.string().min(1).nullable(),
  }),
  z.object({
    action: z.literal("delete"),
    ids: z.array(z.string().min(1)).min(1).max(1000),
  }),
]);

/** Client-side schema: works on raw form input (strings) before submission. */
export const transactionFormSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  amount: z
    .string()
    .min(1, "Enter an amount")
    .refine((value) => !Number.isNaN(Number(value)), "Enter a valid number")
    .refine((value) => Number(value) > 0, "Amount must be greater than zero"),
  categoryId: z.string(),
  description: z.string().min(1, "Add a short description").max(500),
  date: z.string().min(1, "Pick a date"),
});

export type TransactionFormValues = z.infer<typeof transactionFormSchema>;
