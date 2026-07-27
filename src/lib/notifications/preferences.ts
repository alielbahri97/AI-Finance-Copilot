import "server-only";

import type { NotificationPreference } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/** Returns the user's notification preferences, creating defaults on first use. */
export async function getOrCreatePreferences(userId: string): Promise<NotificationPreference> {
  return prisma.notificationPreference.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

export interface NotificationPreferenceDto {
  dailySummary: boolean;
  weeklySummary: boolean;
  monthlySummary: boolean;
  largeTransaction: boolean;
  largeTransactionThreshold: number;
  lowCash: boolean;
  lowCashFloor: number;
  lowCashHorizonDays: number;
  invoiceReminders: boolean;
  channelInApp: boolean;
  channelEmail: boolean;
  channelPush: boolean;
}

export function serializePreferences(row: NotificationPreference): NotificationPreferenceDto {
  return {
    dailySummary: row.dailySummary,
    weeklySummary: row.weeklySummary,
    monthlySummary: row.monthlySummary,
    largeTransaction: row.largeTransaction,
    largeTransactionThreshold: Number(row.largeTransactionThreshold),
    lowCash: row.lowCash,
    lowCashFloor: Number(row.lowCashFloor),
    lowCashHorizonDays: row.lowCashHorizonDays,
    invoiceReminders: row.invoiceReminders,
    channelInApp: row.channelInApp,
    channelEmail: row.channelEmail,
    channelPush: row.channelPush,
  };
}
