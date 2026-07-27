import "server-only";

import { logger, serializeError } from "@/lib/logger";

/**
 * Email channel via Resend's REST API (plain fetch, no SDK). When the
 * RESEND_API_KEY / EMAIL_FROM env vars are missing the send is logged and
 * skipped gracefully — in-app notifications still work.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    logger.info(`[notifications] email skipped (RESEND_API_KEY/EMAIL_FROM not set): "${subject}"`);
    return false;
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      logger.error(`[notifications] Resend returned ${response.status}: ${detail.slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (error) {
    logger.error("[notifications] email send", { error: serializeError(error) });
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export function appUrl(path = ""): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
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

function emailShell(title: string, contentHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr>
              <td style="background-color:#0f172a;padding:20px 32px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;">FinPilot</span>
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
                  You are receiving this because email notifications are enabled in your
                  <a href="${appUrl("/settings")}" style="color:#64748b;">FinPilot settings</a>.
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
