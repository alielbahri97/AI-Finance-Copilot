import "server-only";

import { BRAND } from "@/lib/branding";
import { getAppUrl } from "@/lib/env-url";
import { logger, serializeError } from "@/lib/logger";

/**
 * Email channel via Resend's REST API (plain fetch, no SDK). Every send goes
 * through sendEmail() so callers get the same three-way answer — delivered,
 * not configured, or failed — instead of a silent no-op.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** What actually happened to a send, so the UI can say something true. */
export type EmailDeliveryStatus = "sent" | "not_configured" | "failed";

export interface EmailDeliveryResult {
  status: EmailDeliveryStatus;
  /**
   * Resend's id for the accepted message. Only set when status is "sent", and
   * the one piece of evidence that a send really left the building: it can be
   * looked up in Resend's dashboard or via their API. Not a secret.
   */
  id?: string;
  /** Provider message, sanitized for display. Only set when status is "failed". */
  error?: string;
  /**
   * Resend refuses to deliver to anyone but the account owner until a sending
   * domain is verified. That is a setup step, not an outage, so it gets its
   * own flag and its own guidance in the UI.
   */
  domainRestricted?: boolean;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

const DOMAIN_RESTRICTION_HINTS = [
  /verify a domain/i,
  /domain is not verified/i,
  /testing emails/i,
  /your own email address/i,
  /resend\.com\/domains/i,
];

/** Pulls the human-readable part out of a provider error body. */
function extractProviderMessage(body: string, status: number): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) return `Resend returned HTTP ${status}`;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      for (const key of ["message", "error"]) {
        if (typeof record[key] === "string" && record[key].trim().length > 0) {
          return record[key] as string;
        }
      }
    }
  } catch {
    // Not JSON — fall through to the raw body.
  }
  return trimmed;
}

/**
 * Strips anything credential-shaped before the message reaches a client, and
 * keeps it short enough for a toast.
 */
function sanitizeProviderMessage(message: string): string {
  return message
    .replace(/re_[A-Za-z0-9_-]{6,}/g, "re_***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * Turns a Resend HTTP error into a displayable result. Exported for tests and
 * for any caller that talks to the API directly.
 */
export function classifyEmailFailure(status: number, body: string): EmailDeliveryResult {
  const message = sanitizeProviderMessage(extractProviderMessage(body, status));
  const domainRestricted =
    DOMAIN_RESTRICTION_HINTS.some((hint) => hint.test(message)) ||
    // A rejected key comes back as 401; a 403 from Resend is the sandbox rule.
    (status === 403 && !/api key/i.test(message));
  return { status: "failed", error: message, domainRestricted };
}

/**
 * Reads the message id out of an accepted send. A body that does not parse
 * costs nothing: the send was still accepted, there is just no receipt to
 * quote back.
 */
async function readMessageId(response: Response): Promise<{ id?: string }> {
  const body: unknown = await response.json().catch(() => null);
  const id = (body as { id?: unknown } | null)?.id;
  return typeof id === "string" && id.length > 0 ? { id } : {};
}

/**
 * Sends one email and reports what happened. Never throws: callers treat email
 * as best-effort, but they are expected to surface or log the result.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  channel = "notifications",
  options: { replyTo?: string } = {}
): Promise<EmailDeliveryResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    logger.info("[email] send skipped — RESEND_API_KEY/EMAIL_FROM not set", { channel, subject });
    return { status: "not_configured" };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        // Mail sent on a customer's behalf comes from our domain, so without a
        // reply-to their customer's answer lands in a mailbox nobody reads.
        ...(options.replyTo ? { reply_to: options.replyTo } : {}),
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const result = classifyEmailFailure(response.status, detail);
      logger.error("[email] provider rejected the send", {
        channel,
        subject,
        httpStatus: response.status,
        domainRestricted: result.domainRestricted,
        providerError: result.error,
      });
      return result;
    }
    return { status: "sent", ...(await readMessageId(response)) };
  } catch (error) {
    const serialized = serializeError(error);
    logger.error("[email] send failed", { channel, subject, error: serialized });
    return {
      status: "failed",
      error: sanitizeProviderMessage(serialized.message),
      domainRestricted: false,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export function appUrl(path = ""): string {
  return `${getAppUrl()}${path}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Renders plain text (paragraphs + "- " bullet lines) as simple HTML. */
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n").filter((line) => line.trim().length > 0);
      const isList = lines.length > 0 && lines.every((line) => /^\s*[-•]\s+/.test(line));
      if (isList) {
        const items = lines
          .map((line) => `<li style="margin:0 0 6px;">${escapeHtml(line.replace(/^\s*[-•]\s+/, ""))}</li>`)
          .join("");
        return `<ul style="margin:0 0 16px;padding-left:20px;color:#334155;font-size:14px;line-height:1.6;">${items}</ul>`;
      }
      return `<p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:1.6;">${lines
        .map(escapeHtml)
        .join("<br />")}</p>`;
    })
    .join("");
}

interface EmailShellOptions {
  /** Overrides the name in the header bar. Defaults to the product. */
  brandLabel?: string;
  /** Overrides the footer. Defaults to the notification-settings note. */
  footerHtml?: string;
}

function emailShell(title: string, contentHtml: string, options: EmailShellOptions = {}): string {
  const footer =
    options.footerHtml ??
    `You are receiving this because email notifications are enabled in your
                  <a href="${appUrl("/settings")}" style="color:#64748b;">${escapeHtml(BRAND.name)} settings</a>.`;
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr>
              <td style="background-color:#0f172a;padding:20px 32px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;">${escapeHtml(options.brandLabel ?? BRAND.name)}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;color:#0f172a;font-size:20px;font-weight:700;">${escapeHtml(title)}</h1>
                ${contentHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid #e2e8f0;">
                <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">
                  ${footer}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function ctaButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 0;">
    <tr>
      <td style="background-color:#0f172a;border-radius:8px;">
        <a href="${url}" style="display:inline-block;padding:10px 20px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

export interface DigestEmailOptions {
  title: string;
  periodLabel: string;
  bodyText: string;
  stats: { label: string; value: string }[];
}

/** Summary digest template: intro text, a stat grid, and a dashboard CTA. */
export function renderDigestEmail(options: DigestEmailOptions): string {
  const statCells = options.stats
    .map(
      (stat) => `<td width="50%" style="padding:12px 16px;background-color:#f8fafc;border-radius:8px;">
        <p style="margin:0;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(stat.label)}</p>
        <p style="margin:4px 0 0;color:#0f172a;font-size:16px;font-weight:700;">${escapeHtml(stat.value)}</p>
      </td>`
    )
    .reduce<string[][]>((rows, cell, index) => {
      if (index % 2 === 0) rows.push([]);
      rows[rows.length - 1].push(cell);
      return rows;
    }, [])
    .map((row) => `<tr>${row.join('<td width="12" style="font-size:0;">&nbsp;</td>')}</tr>`)
    .join('<tr><td colspan="3" height="12" style="font-size:0;">&nbsp;</td></tr>');

  const content = `
    <p style="margin:0 0 20px;color:#64748b;font-size:13px;">${escapeHtml(options.periodLabel)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">${statCells}</table>
    ${textToHtml(options.bodyText)}
    ${ctaButton("Open your dashboard", appUrl("/dashboard"))}`;
  return emailShell(options.title, content);
}

export interface CustomerReminderEmailOptions {
  /** The business chasing the invoice — this mail is theirs, not ours. */
  senderName: string;
  subject: string;
  bodyText: string;
  details: { label: string; value: string }[];
  /** Where the customer's reply lands, when one is configured. */
  replyTo?: string;
}

/**
 * A payment reminder addressed to somebody else's customer. Deliberately not
 * the alert template: the recipient has no Ballast account, so there is no
 * dashboard to link them to and no settings page the footer could send them
 * to. The header and footer name the business instead of the product.
 */
export function renderCustomerReminderEmail(options: CustomerReminderEmailOptions): string {
  const detailRows = options.details
    .map(
      (row) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:13px;">${escapeHtml(row.label)}</td>
        <td align="right" style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#0f172a;font-size:13px;font-weight:600;">${escapeHtml(row.value)}</td>
      </tr>`
    )
    .join("");

  const content = `
    ${textToHtml(options.bodyText)}
    ${detailRows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">${detailRows}</table>` : ""}`;

  const reply = options.replyTo
    ? ` Replies go to ${escapeHtml(options.replyTo)}.`
    : "";

  return emailShell(options.subject, content, {
    brandLabel: options.senderName,
    footerHtml: `This payment reminder was sent by ${escapeHtml(options.senderName)}.${reply}`,
  });
}

export interface AlertEmailOptions {
  title: string;
  bodyText: string;
  details?: { label: string; value: string }[];
  ctaLabel: string;
  ctaPath: string;
}

/** Alert template: message, optional detail rows, and a deep-link CTA. */
export function renderAlertEmail(options: AlertEmailOptions): string {
  const detailRows = (options.details ?? [])
    .map(
      (row) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:13px;">${escapeHtml(row.label)}</td>
        <td align="right" style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#0f172a;font-size:13px;font-weight:600;">${escapeHtml(row.value)}</td>
      </tr>`
    )
    .join("");

  const content = `
    ${textToHtml(options.bodyText)}
    ${detailRows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">${detailRows}</table>` : ""}
    ${ctaButton(options.ctaLabel, appUrl(options.ctaPath))}`;
  return emailShell(options.title, content);
}
