import { z } from "zod";

/** PATCH payload for notification preferences; all fields optional. */
export const notificationPreferencesSchema = z
  .object({
    dailySummary: z.boolean(),
    weeklySummary: z.boolean(),
    monthlySummary: z.boolean(),
    largeTransaction: z.boolean(),
    largeTransactionThreshold: z.coerce.number().min(0).max(1_000_000_000),
    lowCash: z.boolean(),
    lowCashFloor: z.coerce.number().min(0).max(1_000_000_000),
    lowCashHorizonDays: z.coerce.number().int().min(1).max(365),
    invoiceReminders: z.boolean(),
    channelInApp: z.boolean(),
    channelEmail: z.boolean(),
    channelPush: z.boolean(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update" });

export type NotificationPreferencesValues = z.infer<typeof notificationPreferencesSchema>;

/** Mark specific notifications read, or all of them. */
export const markReadSchema = z
  .object({
    ids: z.array(z.string().min(1)).max(200).optional(),
    all: z.boolean().optional(),
  })
  .refine((data) => data.all === true || (data.ids && data.ids.length > 0), {
    message: "Provide ids or all: true",
  });

/** A browser PushSubscription as produced by pushManager.subscribe(). */
export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
});

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().min(1).max(1000),
});
