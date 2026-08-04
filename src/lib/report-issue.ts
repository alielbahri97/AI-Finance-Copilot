import { BRAND } from "@/lib/branding";

export interface ReportIssueContext {
  pageUrl?: string;
  userAgent?: string;
  errorMessage?: string;
  errorDigest?: string;
  userNotes?: string;
}

/** Builds a markdown-ish body users can paste into GitHub Issues or email. */
export function buildReportIssueBody(context: ReportIssueContext = {}): string {
  const lines = [
    "## What happened",
    context.userNotes?.trim() || "_Describe what you were doing and what went wrong._",
    "",
    "## Context",
    `- **Page:** ${context.pageUrl ?? "unknown"}`,
    `- **Time:** ${new Date().toISOString()}`,
  ];

  if (context.errorMessage) {
    lines.push(`- **Error:** ${context.errorMessage}`);
  }
  if (context.errorDigest) {
    lines.push(`- **Reference:** ${context.errorDigest}`);
  }
  if (context.userAgent) {
    lines.push(`- **Browser:** ${context.userAgent}`);
  }

  lines.push("", "## Steps to reproduce", "1. ", "2. ", "3. ");

  return lines.join("\n");
}

/** Opens GitHub Issues, a custom URL, or mailto with the report prefilled. */
export function openReportIssue(context: ReportIssueContext = {}): void {
  const body = buildReportIssueBody(context);
  const title = context.errorMessage
    ? `Bug: ${context.errorMessage.slice(0, 80)}`
    : `${BRAND.name} issue report`;

  const issuesUrl = process.env.NEXT_PUBLIC_ISSUES_URL?.trim();
  if (issuesUrl) {
    const url = new URL(issuesUrl);
    if (!url.searchParams.has("title")) {
      url.searchParams.set("title", title);
    }
    if (!url.searchParams.has("body")) {
      url.searchParams.set("body", body);
    }
    window.open(url.toString(), "_blank", "noopener,noreferrer");
    return;
  }

  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || BRAND.supportEmail;
  const mailto = new URL(`mailto:${supportEmail}`);
  mailto.searchParams.set("subject", title);
  mailto.searchParams.set("body", body);
  window.location.href = mailto.toString();
}
