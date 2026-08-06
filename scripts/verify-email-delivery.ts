/**
 * Proves that a DEPLOYED instance really delivers notification email.
 *
 * Local runs cannot answer this: `sendEmail()` needs RESEND_API_KEY and
 * EMAIL_FROM plus a route to api.resend.com, and a dev machine usually has
 * neither. This script asks the deployment instead, over three GETs:
 *
 *   1. GET /api/health                 — does the running server see both vars?
 *   2. GET /api/health?probe=email     — does Resend accept the key, and is the
 *                                        EMAIL_FROM domain actually verified?
 *   3. GET /api/cron/notifications     — run the sweep and read back what the
 *                                        email channel did, including Resend's
 *                                        message ids for accepted sends.
 *
 * A message id is the point: it is the receipt you can look up in Resend's
 * dashboard, and the only outcome that distinguishes a real send from a
 * skipped one. Nothing here writes to the database directly and no request
 * uses a verb other than GET; the cron itself only adds notification rows and
 * last-sent stamps, exactly as a scheduled run would, and re-running it inside
 * the same UTC day is a no-op.
 *
 * Usage:
 *   npm run verify:email -- --url https://app.example.com
 *   npm run verify:email -- --url https://app.example.com --dry-run
 *
 * The base URL comes from --url or VERIFY_BASE_URL; the bearer token from
 * CRON_SECRET (or --secret, which a shell history will remember — prefer the
 * environment). The token is never printed, not even partially.
 */
import "dotenv/config";

interface EmailHealth {
  configured?: boolean;
  apiKeyPresent?: boolean;
  fromPresent?: boolean;
  fromValid?: boolean;
  fromDomain?: string | null;
  keyAuthenticates?: boolean;
  domains?: { name?: string; status?: string }[];
  fromDomainVerified?: boolean;
  probeError?: string;
}

interface Health {
  status?: string;
  db?: string;
  storage?: string;
  storageNote?: string;
  schema?: string;
  email?: EmailHealth;
  emailProbe?: string;
}

interface CronEmailStats {
  sent?: number;
  notConfigured?: number;
  failed?: number;
  domainRestricted?: number;
  messageIds?: string[];
}

/**
 * Only the parts of the cron response this script reads, all optional: the
 * route reports more than email (it also returns the customer-reminder pass),
 * and an older deployment reports less. Unknown keys are ignored either way.
 */
interface CronResponse {
  ok?: boolean;
  error?: string;
  stats?: {
    users?: number;
    /** Users the run had no budget left to start; the next run picks them up. */
    usersSkipped?: number;
    summariesSent?: number;
    lowCashAlerts?: number;
    invoiceReminders?: number;
    errors?: number;
    email?: CronEmailStats;
  };
}

const REQUEST_TIMEOUT_MS = 30_000;
/** Long enough for a cron sweep over a small user base; below Vercel's 300s ceiling. */
const CRON_TIMEOUT_MS = 290_000;

/** A failure the operator can act on: the message says what to change. */
class VerificationError extends Error {
  constructor(
    message: string,
    readonly fix: string
  ) {
    super(message);
    this.name = "VerificationError";
  }
}

function ok(line: string): void {
  console.log(`     \u2713 ${line}`);
}

function warn(line: string): void {
  console.log(`     ! ${line}`);
}

function step(label: string): void {
  console.log(`\n${label}`);
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index >= 0 && index + 1 < process.argv.length) return process.argv[index + 1];
  return process.argv.find((arg) => arg.startsWith(`${flag}=`))?.slice(flag.length + 1);
}

function resolveBaseUrl(): string {
  const raw = argValue("--url") ?? process.env.VERIFY_BASE_URL;
  if (!raw) {
    throw new VerificationError(
      "No deployment URL given.",
      "Pass --url https://your-app.example.com, or set VERIFY_BASE_URL. " +
        "This must be the deployed origin: a local dev server cannot reach Resend."
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new VerificationError(`"${raw}" is not a valid URL.`, "Expected e.g. https://app.example.com.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new VerificationError(
      `"${raw}" must be an http:// or https:// URL.`,
      "Expected e.g. https://app.example.com."
    );
  }
  return parsed.origin;
}

function resolveSecret(): string {
  const secret = argValue("--secret") ?? process.env.CRON_SECRET;
  if (!secret) {
    throw new VerificationError(
      "CRON_SECRET is not set locally.",
      "Export the same value the deployment uses: " +
        '$env:CRON_SECRET = "<the token>" (PowerShell) or export CRON_SECRET=... (bash). ' +
        "The script sends it as a bearer token and never prints it."
    );
  }
  return secret;
}

/**
 * One GET, with the bearer header only when a secret is passed. Returns the
 * status alongside the parsed body so callers can tell 401 from 503 without a
 * throw, and never echoes the token into an error message.
 */
async function getJson<T>(
  url: string,
  { secret, timeoutMs = REQUEST_TIMEOUT_MS }: { secret?: string; timeoutMs?: number } = {}
): Promise<{ status: number; body: T | null }> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown error";
    throw new VerificationError(
      `Could not reach ${url} (${name}).`,
      "Check the URL, that the deployment is live, and that this machine has " +
        "outbound HTTPS to it. A corporate network that blocks egress will fail here."
    );
  }
  const body = (await response.json().catch(() => null)) as T | null;
  return { status: response.status, body };
}

/* ------------------------------------------------------------------ */
/* 1. Configuration as the running server sees it                      */
/* ------------------------------------------------------------------ */

async function checkHealth(baseUrl: string): Promise<Health> {
  step("1/4  GET /api/health");
  const { status, body } = await getJson<Health>(`${baseUrl}/api/health`);
  if (!body) {
    throw new VerificationError(
      `/api/health returned HTTP ${status} with no JSON body.`,
      "That is not this app answering. Check the URL and any proxy in front of it."
    );
  }

  if (body.db === "up") {
    ok(`database up, schema ${body.schema ?? "unknown"}, storage ${body.storage ?? "unknown"}`);
  } else {
    warn(`database ${body.db ?? "unknown"} (HTTP ${status}) — digests will fail before any send`);
  }
  if (body.storage === "not_applicable") {
    ok("storage bucket not checkable from this database (self-hosted Postgres) — not a fault");
  }

  const email = body.email;
  if (!email) {
    throw new VerificationError(
      "/api/health has no `email` section.",
      "The deployment predates the email diagnostics. Redeploy from this revision."
    );
  }
  if (!email.configured) {
    const missing = [
      email.apiKeyPresent ? null : "RESEND_API_KEY",
      email.fromPresent ? null : "EMAIL_FROM",
    ].filter(Boolean);
    throw new VerificationError(
      `email.configured is false — the running server cannot see ${missing.join(" and ")}.`,
      "Set both in the hosting platform's Production environment and REDEPLOY: " +
        "Vercel only applies environment changes to new builds. For Docker Compose, " +
        "put them in .env and `docker compose up -d`."
    );
  }
  ok("email.configured = true (RESEND_API_KEY and EMAIL_FROM both visible to the server)");

  if (email.fromValid === false) {
    throw new VerificationError(
      "EMAIL_FROM is set but does not parse as an address.",
      'Use `user@domain` or `Name <user@domain>`, e.g. EMAIL_FROM="Ballast <notifications@send.example.com>".'
    );
  }
  ok(`EMAIL_FROM parses; sending domain is ${email.fromDomain}`);
  if (email.fromDomain === "resend.dev") {
    warn(
      "the from-domain is Resend's shared sandbox: it can only ever reach the address " +
        "your Resend account is registered with"
    );
  }
  if (email.fromDomain?.includes("yourdomain")) {
    warn("the from-domain still looks like the .env.example placeholder");
  }
  return body;
}

/* ------------------------------------------------------------------ */
/* 2. The one precondition checkable without sending                   */
/* ------------------------------------------------------------------ */

async function probeResend(baseUrl: string, secret: string, fromDomain: string | null): Promise<void> {
  step("2/4  GET /api/health?probe=email  (authenticated)");
  const { status, body } = await getJson<Health>(`${baseUrl}/api/health?probe=email`, { secret });
  const email = body?.email;
  if (!email) {
    throw new VerificationError(
      `The email probe returned HTTP ${status} with no email section.`,
      "Re-run without the probe to see whether /api/health answers at all."
    );
  }
  if (body?.emailProbe) {
    throw new VerificationError(
      "The deployment refused the probe: the bearer token did not match.",
      "CRON_SECRET here differs from the deployment's. Copy the value from the " +
        "hosting platform, or rotate both to the same new value and redeploy."
    );
  }
  if (email.keyAuthenticates === false) {
    throw new VerificationError(
      `Resend rejected the API key (${email.probeError ?? "no detail"}).`,
      "RESEND_API_KEY is wrong, revoked, or lacks permission. Mint a new key at " +
        "https://resend.com/api-keys, set it, and redeploy."
    );
  }
  ok("Resend accepted the API key");

  if (email.fromDomainVerified) {
    ok(`${fromDomain} is verified with Resend — it may send to any recipient`);
    return;
  }
  const known = (email.domains ?? [])
    .map((domain) => `${domain.name} (${domain.status})`)
    .join(", ");
  throw new VerificationError(
    `${fromDomain} is not a verified sending domain on this Resend account.`,
    `Resend will answer 403 for every recipient except your own account address. ` +
      `Verify it under https://resend.com/domains and publish the DNS records${
        known ? `. Currently known: ${known}` : ", then point EMAIL_FROM at it"
      }.`
  );
}

/* ------------------------------------------------------------------ */
/* 3. The real send                                                    */
/* ------------------------------------------------------------------ */

async function triggerCron(baseUrl: string, secret: string): Promise<CronResponse> {
  step("3/4  GET /api/cron/notifications  (authenticated)");
  const { status, body } = await getJson<CronResponse>(`${baseUrl}/api/cron/notifications`, {
    secret,
    timeoutMs: CRON_TIMEOUT_MS,
  });

  if (status === 503) {
    throw new VerificationError(
      "The cron endpoint answered 503: CRON_SECRET is not set on the deployment.",
      "Set CRON_SECRET in the hosting platform and redeploy. Without it the endpoint " +
        "refuses to run at all, and Vercel Cron cannot authenticate either."
    );
  }
  if (status === 401) {
    throw new VerificationError(
      "The cron endpoint answered 401: the bearer token did not match.",
      "The local CRON_SECRET differs from the deployment's. Copy it from the hosting platform."
    );
  }
  if (status !== 200 || !body?.ok || !body.stats) {
    throw new VerificationError(
      `The cron run failed with HTTP ${status}${body?.error ? ` (${body.error})` : ""}.`,
      "Check the deployment's logs for `cron_notifications_completed` or the error above it."
    );
  }

  const stats = body.stats;
  ok(
    `200 — users ${stats.users ?? 0}, summaries ${stats.summariesSent ?? 0}, ` +
      `low cash ${stats.lowCashAlerts ?? 0}, invoice reminders ${stats.invoiceReminders ?? 0}, ` +
      `errors ${stats.errors ?? 0}`
  );
  if ((stats.errors ?? 0) > 0) {
    warn(`${stats.errors} user(s) failed mid-run — the deployment's logs name them`);
  }
  if ((stats.usersSkipped ?? 0) > 0) {
    warn(
      `${stats.usersSkipped} user(s) were not started: the run hit its time budget. ` +
        "Nothing was claimed for them, so the next run picks them up."
    );
  }
  return body;
}

/* ------------------------------------------------------------------ */
/* 4. What the email channel actually did                              */
/* ------------------------------------------------------------------ */

function reportDelivery(response: CronResponse): void {
  step("4/4  Delivery outcome");
  const stats = response.stats!;
  const email = stats.email;

  if (!email) {
    throw new VerificationError(
      "The cron response carries no email breakdown.",
      "The deployment predates per-send reporting. Redeploy from this revision, " +
        "otherwise a skipped send is indistinguishable from a delivered one."
    );
  }

  if ((email.notConfigured ?? 0) > 0) {
    throw new VerificationError(
      `${email.notConfigured} send(s) reported NOT_CONFIGURED.`,
      "The server reached the email channel but RESEND_API_KEY/EMAIL_FROM were not both " +
        "set at send time. /api/health disagreeing means the variables changed between " +
        "the two requests — redeploy and re-run."
    );
  }
  if ((email.domainRestricted ?? 0) > 0) {
    throw new VerificationError(
      `${email.domainRestricted} send(s) were refused as DOMAIN_RESTRICTED (Resend 403).`,
      "This is a setup step, not a bad key: the EMAIL_FROM domain is not verified, so " +
        "Resend only delivers to your own account address. Verify it at " +
        "https://resend.com/domains."
    );
  }
  if ((email.failed ?? 0) > 0) {
    throw new VerificationError(
      `${email.failed} send(s) FAILED at the provider.`,
      "The deployment logs the sanitized provider message under " +
        "`[email] provider rejected the send`. Read it there."
    );
  }

  if ((email.sent ?? 0) === 0) {
    const dueNothing = (stats.summariesSent ?? 0) + (stats.lowCashAlerts ?? 0) + (stats.invoiceReminders ?? 0);
    throw new VerificationError(
      dueNothing === 0
        ? "The run was clean but nothing was due, so no email was sent."
        : `${dueNothing} notification(s) fired but none reached the email channel.`,
      dueNothing === 0
        ? "Put an account into a sendable state first: enable the daily summary and the " +
          "email channel in Settings > Notifications, and make sure the digest has not " +
          "already gone out today (last_daily_sent_at must be NULL or from an earlier " +
          "UTC day). See the runbook in DEPLOYMENT.md."
        : "channelEmail is off for those users, or the events carried no rendered HTML. " +
          "Turn on the email channel in Settings > Notifications."
    );
  }

  ok(`SENT — Resend accepted ${email.sent} message(s)`);
  for (const id of email.messageIds ?? []) {
    console.log(`       message id: ${id}`);
  }
  if ((email.messageIds ?? []).length === 0) {
    warn("Resend returned no message id; the send was accepted but there is no receipt to quote");
  } else {
    console.log("       look them up at https://resend.com/emails");
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run") || process.argv.includes("-n");
  const baseUrl = resolveBaseUrl();
  const secret = resolveSecret();

  console.log(`Verifying notification email delivery for ${baseUrl}`);
  console.log("Read-only: every request is a GET, and no user data is created or deleted here.");

  const health = await checkHealth(baseUrl);
  await probeResend(baseUrl, secret, health.email?.fromDomain ?? null);

  if (dryRun) {
    step("3/4  Skipped (--dry-run)");
    ok("configuration is complete; re-run without --dry-run to send for real");
    return;
  }

  reportDelivery(await triggerCron(baseUrl, secret));
  console.log("\nEmail delivery verified end to end.");
}

main().catch((error) => {
  if (error instanceof VerificationError) {
    console.error(`\n     \u2717 ${error.message}`);
    console.error(`       Fix: ${error.fix}`);
  } else {
    console.error(`\nError: ${error instanceof Error ? error.message : error}`);
  }
  process.exit(1);
});
