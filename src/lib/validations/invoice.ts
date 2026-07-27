import { z } from "zod";

const money = z.coerce.number().min(0).max(1_000_000_000);

export const invoiceLineItemSchema = z.object({
  description: z.string().trim().min(1, "Describe the item").max(300),
  quantity: z.coerce.number().min(0).max(1_000_000),
  unitPrice: money,
  total: money,
});

/**
 * PATCH payload for an invoice. Everything is optional so the same schema
 * covers the full review-form save and quick actions like "mark paid".
 * When `lineItems` is present the invoice's items are replaced.
 */
export const invoiceUpdateSchema = z
  .object({
    vendor: z.string().trim().max(200),
    invoiceNumber: z.string().trim().max(100).nullable(),
    invoiceDate: z.coerce.date().nullable(),
    dueDate: z.coerce.date().nullable(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code"),
    subtotal: money.nullable(),
    vatAmount: money.nullable(),
    vatRate: z.coerce.number().min(0).max(100).nullable(),
    total: money,
    status: z.enum(["DRAFT", "UNPAID", "PAID"]),
    notes: z.string().trim().max(2000).nullable(),
    lineItems: z.array(invoiceLineItemSchema).max(100),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update" });

export type InvoiceUpdateValues = z.infer<typeof invoiceUpdateSchema>;

export const invoiceLinkSchema = z.object({
  transactionId: z.string().min(1, "Pick a transaction"),
});

export const invoiceListQuerySchema = z.object({
  status: z.enum(["DRAFT", "UNPAID", "PAID", "OVERDUE"]).optional(),
  vendor: z.string().trim().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
