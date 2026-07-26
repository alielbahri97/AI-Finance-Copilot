import { z } from "zod";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(50),
  type: z.enum(["INCOME", "EXPENSE"]),
  color: z.string().regex(HEX_COLOR, "Pick a valid color"),
});

export const categoryUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    color: z.string().regex(HEX_COLOR).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update" });

export const categoryRuleSchema = z.object({
  pattern: z.string().trim().min(2, "Pattern must be at least 2 characters").max(100),
  categoryId: z.string().min(1, "Pick a category"),
});

export type CategoryValues = z.infer<typeof categorySchema>;
export type CategoryRuleValues = z.infer<typeof categoryRuleSchema>;
