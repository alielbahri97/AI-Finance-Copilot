import { z } from "zod";

export const SUPPORTED_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "CAD",
  "CHF",
  "JPY",
  "NZD",
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const profileSchema = z.object({
  fullName: z.string().min(2, "Enter your full name").max(80),
  currency: z.enum(SUPPORTED_CURRENCIES),
});

export const settingsSchema = z.object({
  aiProvider: z.enum(["OPENAI", "ANTHROPIC", "GROQ"]),
});

export const changePasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[a-z]/, "Include at least one lowercase letter")
      .regex(/[A-Z]/, "Include at least one uppercase letter")
      .regex(/[0-9]/, "Include at least one number"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ProfileValues = z.infer<typeof profileSchema>;
export type SettingsValues = z.infer<typeof settingsSchema>;
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
