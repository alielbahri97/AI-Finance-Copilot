import { isEmailConfigured } from "./email";

/**
 * Diagnostic view of the email configuration for /api/health. Answers the one
 * question you cannot answer from outside a deployment — does the running
 * server see RESEND_API_KEY and EMAIL_FROM, and does the from-address sit on
 * the domain that was actually verified with Resend?
 *
 * Nothing secret is reported: the key is a boolean, and EMAIL_FROM is reduced
 * to its domain (the part needed to spot a verified-domain mismatch), never
 * the local part or the display name.
 */

const RESEND_DOMAINS_ENDPOINT = "https://api.resend.com/domains";
const PROBE_TIMEOUT_MS = 3_000;

export interface EmailDomainHealth {
  /** Domain name as registered with Resend — not secret. */
  name: string;
  /** Resend's own wording: "verified", "pending", "failed", ... */
  status: string;
}

export interface EmailHealth {
  /**
   * Exactly the condition sendEmail() applies before talking to Resend, taken
   * from isEmailConfigured() so this can never disagree with real behaviour.
   * Email is optional, so `false` is a setup gap, not an outage.
   */
  configured: boolean;
  /** Whether RESEND_API_KEY is set. Never its value, prefix or length. */
  apiKeyPresent: boolean;
  apiKeyEnvVar: "RESEND_API_KEY";
  fromPresent: boolean;
  fromEnvVar: "EMAIL_FROM";
  /** Whether EMAIL_FROM parses as `user@domain` or `Name <user@domain>`. */
  fromValid?: boolean;
  /** Domain of EMAIL_FROM, lowercased. Null when it does not parse. */
  fromDomain?: string | null;
  /** Whether the key authenticated against Resend; probe only. */
  keyAuthenticates?: boolean;
  /** Domains Resend knows about and their status; probe only. */
  domains?: EmailDomainHealth[];
  /** Whether fromDomain appears in Resend's verified domains; probe only. */
  fromDomainVerified?: boolean;
  /** Status code or error name from the probe, never a response body. */
  probeError?: string;
}

/**
 * "Present" has to mean exactly what isEmailConfigured() means, or the booleans
 * could contradict `configured`: a set-but-empty var counts as missing, and
 * nothing else is normalized away.
 */
function envValue(name: string): string | undefined {
  return process.env[name] || undefined;
}

const ADDRESS_PATTERN =
  /^[^\s@,;:"'<>()[\]\\]+@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+)$/;

/**
 * Reduces EMAIL_FROM to what is safe and useful to report. Accepts the two
 * forms Resend accepts — a bare address, or a display name with the address in
 * angle brackets — and returns the domain only.
 */
export function parseFromAddress(value: string | undefined): {
  valid: boolean;
  domain: string | null;
} {
  if (!value) return { valid: false, domain: null };
  const trimmed = value.trim();
  const bracketed = /^[^<>]*<([^<>]+)>$/.exec(trimmed);
  const address = (bracketed ? bracketed[1] : trimmed).trim();
  const match = ADDRESS_PATTERN.exec(address);
  if (!match) return { valid: false, domain: null };
  return { valid: true, domain: match[1].toLowerCase() };
}

/**
 * Lists the sending domains on the Resend account. A GET, so it validates the
 * key without sending mail, and it is the only way to confirm from the outside
 * that EMAIL_FROM sits on a verified domain.
 */
async function probeResend(apiKey: string): Promise<Partial<EmailHealth>> {
  try {
    const response = await fetch(RESEND_DOMAINS_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { keyAuthenticates: false, probeError: `HTTP ${response.status}` };
    }
    const body: unknown = await response.json().catch(() => null);
    const data = (body as { data?: unknown } | null)?.data;
    const rows: unknown[] = Array.isArray(data) ? data : [];
    const domains = rows.flatMap((row): EmailDomainHealth[] => {
      if (!row || typeof row !== "object") return [];
      const record = row as Record<string, unknown>;
      if (typeof record.name !== "string") return [];
      return [
        {
          name: record.name.toLowerCase(),
          status: typeof record.status === "string" ? record.status : "unknown",
        },
      ];
    });
    return { keyAuthenticates: true, domains };
  } catch (error) {
    return {
      keyAuthenticates: false,
      probeError: error instanceof Error ? error.name : "unknown error",
    };
  }
}

/**
 * Describes the email configuration. `probe` additionally calls Resend's
 * domains endpoint, so keep it opt-in and behind the CRON_SECRET.
 */
export async function getEmailHealth({ probe = false } = {}): Promise<EmailHealth> {
  const apiKey = envValue("RESEND_API_KEY");
  const from = envValue("EMAIL_FROM");
  const parsed = parseFromAddress(from);

  const health: EmailHealth = {
    configured: isEmailConfigured(),
    apiKeyPresent: Boolean(apiKey),
    apiKeyEnvVar: "RESEND_API_KEY",
    fromPresent: Boolean(from),
    fromEnvVar: "EMAIL_FROM",
    ...(from ? { fromValid: parsed.valid, fromDomain: parsed.domain } : {}),
  };

  if (!probe || !apiKey) return health;

  const probed = await probeResend(apiKey);
  return {
    ...health,
    ...probed,
    ...(probed.domains && parsed.domain
      ? {
          fromDomainVerified: probed.domains.some(
            (domain) => domain.name === parsed.domain && domain.status === "verified"
          ),
        }
      : {}),
  };
}
