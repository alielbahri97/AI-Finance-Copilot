import "server-only";

import { logger, serializeError } from "@/lib/logger";

import type { NotificationPreference, NotificationType } from "@/generated/prisma/client";
import { decryptSecret, isEncryptionConfigured } from "@/lib/integrations/crypto";
import { sendSlackMessage } from "@/lib/integrations/providers/slack";
import { sendTeamsMessage } from "@/lib/integrations/providers/teams";
import { prisma } from "@/lib/prisma";

import { sendEmail } from "./email";
import { sendPushToUser } from "./push";

export interface NotificationEvent {
  type: NotificationType;
  title: string;
  /** Plain text body shown in the notification center and push message. */
  body: string;
  /** In-app deep link, e.g. "/invoices". */
  link?: string;
  /** Pre-rendered HTML for the email channel; skipped when absent. */
  emailHtml?: string;
  emailSubject?: string;
}

export interface DispatchTarget {
  id: string;
  email: string;
}

/**
 * Fans one event out to the channels the user has enabled. The in-app
 * notification is the primary record; email and push are best-effort and
 * never throw.
 */
export async function dispatchNotification(
  user: DispatchTarget,
  prefs: NotificationPreference,
  event: NotificationEvent
): Promise<void> {
  if (prefs.channelInApp) {
    await prisma.notification.create({
      data: {
        userId: user.id,
        type: event.type,
        title: event.title,
        body: event.body,
        link: event.link ?? null,
      },
    });
  }

  if (prefs.channelEmail && event.emailHtml) {
    await sendEmail(user.email, event.emailSubject ?? event.title, event.emailHtml).catch(
      (error) => logger.error("[notifications] email channel", { error: serializeError(error) })
    );
  }

  if (prefs.channelPush) {
    await sendPushToUser(user.id, {
      title: event.title,
      body: event.body.length > 180 ? `${event.body.slice(0, 177)}...` : event.body,
      link: event.link,
    }).catch((error) => logger.error("[notifications] push channel", { error: serializeError(error) }));
  }

  await sendToChatIntegrations(user.id, event).catch((error) =>
    logger.error("[notifications] chat channel", { error: serializeError(error) })
  );
}

const APP_URL = () => (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/**
 * Slack/Teams act as additional outgoing channels: being connected on the
 * integrations page is the opt-in. Each webhook post is best-effort.
 */
async function sendToChatIntegrations(
  userId: string,
  event: NotificationEvent
): Promise<void> {
  if (!isEncryptionConfigured()) return;

  const connections = await prisma.integrationConnection.findMany({
    where: {
      userId,
      provider: { in: ["slack", "teams"] },
      status: "CONNECTED",
      accessToken: { not: null },
    },
    select: { id: true, provider: true, accessToken: true },
  });

  const message = {
    title: event.title,
    body: event.body,
    link: event.link ? `${APP_URL()}${event.link}` : undefined,
  };

  for (const connection of connections) {
    try {
      const webhookUrl = decryptSecret(connection.accessToken!);
      if (connection.provider === "slack") {
        await sendSlackMessage(webhookUrl, message);
      } else {
        await sendTeamsMessage(webhookUrl, message);
      }
    } catch (error) {
      logger.error(`[notifications] ${connection.provider} post`, { error: serializeError(error) });
      await prisma.integrationConnection
        .update({
          where: { id: connection.id },
          data: {
            status: "ERROR",
            lastError: error instanceof Error ? error.message.slice(0, 500) : "Webhook post failed",
          },
        })
        .catch(() => undefined);
    }
  }
}
