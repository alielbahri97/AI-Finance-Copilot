import "server-only";

import { BRAND } from "@/lib/branding";

import { IntegrationError } from "../oauth";

import type { ProviderHooks } from "./types";

/**
 * Microsoft Teams: connected by pasting an incoming webhook URL (created via
 * the channel's Connectors/Workflows setup). The URL is stored encrypted in
 * the accessToken slot; no OAuth involved.
 */

export function validateTeamsWebhookUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "The webhook URL must use https";
    return null;
  } catch {
    return "Enter a valid webhook URL";
  }
}

/** Posts a notification message to a Teams incoming webhook. */
export async function sendTeamsMessage(
  webhookUrl: string,
  message: { title: string; body: string; link?: string }
): Promise<void> {
  const payload = {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    summary: message.title,
    title: message.title,
    text: message.body,
    ...(message.link
      ? {
          potentialAction: [
            {
              "@type": "OpenUri",
              name: `Open in ${BRAND.name}`,
              targets: [{ os: "default", uri: message.link }],
            },
          ],
        }
      : {}),
  };
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new IntegrationError(`Teams webhook post failed: HTTP ${response.status}`);
  }
}

export const teamsHooks: ProviderHooks = {};
