import "server-only";

import { IntegrationError, type TokenSet } from "../oauth";

import type { ProviderHooks } from "./types";

/**
 * Slack: OAuth with the incoming-webhook scope. The token exchange response
 * includes the webhook URL of the channel the user picked during install —
 * that URL is what we store (encrypted, in the accessToken slot) and post to.
 */

async function afterConnect({ tokens }: { userId: string; tokens: TokenSet }) {
  const webhook = tokens.raw.incoming_webhook as
    | { url?: string; channel?: string; configuration_url?: string }
    | undefined;
  if (!webhook?.url) {
    throw new IntegrationError(
      "Slack did not return an incoming webhook. Reinstall the app and pick a channel."
    );
  }
  const team = tokens.raw.team as { name?: string } | undefined;
  return {
    accessToken: webhook.url,
    refreshToken: null,
    expiresAt: null,
    // externalId stays null: one Slack channel per workspace is the intent,
    // which the partial unique index enforces.
    institutionName: team?.name ?? null,
    metadata: { channel: webhook.channel ?? null, team: team?.name ?? null },
  };
}

/** Posts a notification message to a Slack incoming webhook. */
export async function sendSlackMessage(
  webhookUrl: string,
  message: { title: string; body: string; link?: string }
): Promise<void> {
  const lines = [`*${message.title}*`, message.body];
  if (message.link) {
    lines.push(`<${message.link}|Open in FinPilot>`);
  }
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: lines.join("\n") }),
  });
  if (!response.ok) {
    throw new IntegrationError(`Slack webhook post failed: HTTP ${response.status}`);
  }
}

export const slackHooks: ProviderHooks = { afterConnect };
