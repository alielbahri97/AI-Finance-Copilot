import { z } from "zod";

export const TRANSACTION_CATEGORIES = [
  "Salary",
  "Freelance",
  "Investments",
  "Housing",
  "Groceries",
  "Transport",
  "Dining",
  "Entertainment",
  "Health",
  "Shopping",
  "Utilities",
  "Travel",
  "Education",
  "Subscriptions",
  "Other",
] as const;

export const INCOME_CATEGORIES = ["Salary", "Freelance", "Investments", "Other"] as const;

/** Server-side schema: validates the JSON payload sent to the API. */
export const transactionSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  amount: z.coerce
    .number({ error: "Enter an amount" })
    .positive("Amount must be greater than zero")
    .max(1_000_000_000, "Amount is too large"),
  category: z.enum(TRANSACTION_CATEGORIES, { error: "Pick a category" }),
  description: z.string().min(1, "Add a short description").max(200),
  date: z.coerce.date({ error: "Pick a date" }),
});

export type TransactionValues = z.infer<typeof transactionSchema>;

/** Client-side schema: works on raw form input (strings) before submission. */
export const transactionFormSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  amount: z
    .string()
    .min(1, "Enter an amount")
    .refine((value) => !Number.isNaN(Number(value)), "Enter a valid number")
    .refine((value) => Number(value) > 0, "Amount must be greater than zero"),
  category: z.enum(TRANSACTION_CATEGORIES, { error: "Pick a category" }),
  description: z.string().min(1, "Add a short description").max(200),
  date: z.string().min(1, "Pick a date"),
});

export type TransactionFormValues = z.infer<typeof transactionFormSchema>;
