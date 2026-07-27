import "server-only";

import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

/**
 * Lightweight internal event tracking (no third-party trackers). Events are
 * plain rows in analytics_events and drive the admin dashboard charts.
 * Fire-and-forget: tracking must never break the action being tracked.
 */
export async function trackEvent(
  userId: string | null,
  name: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.analyticsEvent.create({
      data: {
        userId,
        name,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
      },
    });
  } catch (error) {
    logger.error("analytics event failed", { name, error: serializeError(error) });
  }
}
