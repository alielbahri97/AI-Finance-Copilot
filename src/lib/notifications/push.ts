import "server-only";

import { logger, serializeError } from "@/lib/logger";

import webpush from "web-push";

import { prisma } from "@/lib/prisma";

/**
 * Web Push channel (VAPID). Skipped gracefully when the VAPID env vars are
 * missing; dead subscriptions (404/410 from the push service) are pruned.
 */

export function isPushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export interface PushPayload {
  title: string;
  body: string;
  link?: string;
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    logger.info(`[notifications] push skipped (VAPID keys not set): "${payload.title}"`);
    return 0;
  }

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subscriptions.length === 0) return 0;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:notifications@finpilot.local",
    publicKey,
    privateKey
  );

  const body = JSON.stringify(payload);
  let delivered = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        body,
        { TTL: 12 * 60 * 60 }
      );
      delivered += 1;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // Subscription expired or was revoked by the browser.
        await prisma.pushSubscription
          .delete({ where: { id: subscription.id } })
          .catch(() => undefined);
      } else {
        logger.error("[notifications] push send", { error: serializeError(error) });
      }
    }
  }

  return delivered;
}
