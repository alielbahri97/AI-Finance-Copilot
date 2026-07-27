import "server-only";

import type { NotificationPreference, NotificationType } from "@/generated/prisma/client";
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
      (error) => console.error("[notifications] email channel failed:", error)
    );
  }

  if (prefs.channelPush) {
    await sendPushToUser(user.id, {
      title: event.title,
      body: event.body.length > 180 ? `${event.body.slice(0, 177)}...` : event.body,
      link: event.link,
    }).catch((error) => console.error("[notifications] push channel failed:", error));
  }
}
