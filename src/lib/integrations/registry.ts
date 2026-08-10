import "server-only";

import { editionHasFeature, type WorkspaceType } from "@/lib/workspace/editions";

/**
 * The integration registry: one declaration per provider. Everything else
 * (connect routes, sync orchestrator, UI) is generic and driven by this file.
 */

export type IntegrationCategory = "banking" | "accounting" | "productivity";

export type IntegrationCapability =
  | "transactions" // pulls bank transactions into the import pipeline
  | "invoices" // pulls invoices/bills into the Invoice model
  | "email" // scans a mailbox for invoice attachments
  | "notifications" // outgoing channel for alerts/digests
  | "calendar"; // creates events for upcoming bills

/**
 * - oauth2:    standard authorization-code flow via /connect + /callback
 * - plaid:     Plaid Link (link token + public token exchange)
 * - redirect:  provider-hosted approval without code exchange (GoCardless
 *              requisitions); /connect creates the session, /callback finalizes
 * - webhook:   user pastes an incoming webhook URL (Teams)
 */
export type IntegrationFlow = "oauth2" | "plaid" | "redirect" | "webhook";

export interface OAuthConfig {
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
  /** How client credentials are sent to the token endpoint. */
  tokenAuth: "body" | "basic";
  /** Extra query params for the authorization redirect. */
  extraAuthParams?: Record<string, string>;
}

export interface IntegrationProvider {
  id: string;
  name: string;
  description: string;
  category: IntegrationCategory;
  capabilities: IntegrationCapability[];
  flow: IntegrationFlow;
  /** Env vars that must be set for this provider to be available. */
  envVars: string[];
  oauth?: OAuthConfig;
  /** Hours between automatic syncs; null = nothing to sync (outgoing only). */
  syncIntervalHours: number | null;
  /**
   * Whether a workspace may hold several connections to this provider. True
   * only where one connection means one distinct source with an identifier to
   * key it by — a bank, essentially:
   *   - gocardless: one requisition per institution
   *   - plaid:      one Item per institution
   * It is false for outgoing channels and mailboxes (a second Slack workspace
   * or Gmail account is not a second set of books), and false for the
   * accounting providers because their invoice `externalRef`s are namespaced
   * per provider, not per connection, so two companies could collide.
   */
  multiInstance: boolean;
}

function exactBase(): string {
  return `https://${process.env.EXACT_REGION || "start.exactonline.nl"}`;
}

export function getProviders(): IntegrationProvider[] {
  return [
    // ---------------------------------------------------------- banking
    {
      id: "plaid",
      name: "Plaid",
      description: "Connect US/EU bank accounts and sync transactions automatically.",
      category: "banking",
      capabilities: ["transactions"],
      flow: "plaid",
      envVars: ["PLAID_CLIENT_ID", "PLAID_SECRET"],
      syncIntervalHours: 6,
      // One Plaid Item per bank, keyed by item id.
      multiInstance: true,
    },
    {
      id: "tink",
      name: "Tink",
      description: "European open-banking aggregation; syncs account transactions.",
      category: "banking",
      capabilities: ["transactions"],
      flow: "oauth2",
      envVars: ["TINK_CLIENT_ID", "TINK_CLIENT_SECRET"],
      oauth: {
        authUrl: "https://link.tink.com/1.0/transactions/connect-accounts",
        tokenUrl: "https://api.tink.com/api/v1/oauth/token",
        scopes: [],
        clientIdEnv: "TINK_CLIENT_ID",
        clientSecretEnv: "TINK_CLIENT_SECRET",
        tokenAuth: "body",
        extraAuthParams: { market: process.env.TINK_MARKET || "GB", locale: "en_US" },
      },
      syncIntervalHours: 6,
      // Tink aggregates several banks behind one consent and hands back no
      // stable per-bank id, so a second connection would be indistinguishable
      // from a re-authorization of the first.
      multiInstance: false,
    },
    {
      id: "gocardless",
      name: "GoCardless Bank Account Data",
      description: "PSD2 account access (ex-Nordigen); syncs bank transactions.",
      category: "banking",
      capabilities: ["transactions"],
      flow: "redirect",
      envVars: ["GOCARDLESS_SECRET_ID", "GOCARDLESS_SECRET_KEY"],
      // Banks cap account data at four successful calls per access scope per
      // 24h, and every sync spends one on /transactions/ and one on
      // /balances/. Three scheduled passes keep the fourth in reserve for
      // "Sync now" and for a retry after a transient bank error.
      syncIntervalHours: 8,
      // One requisition per institution: connect ING and Rabobank side by side.
      multiInstance: true,
    },
    // ------------------------------------------------------- accounting
    {
      id: "quickbooks",
      name: "QuickBooks",
      description: "Pulls bills and invoices from QuickBooks Online.",
      category: "accounting",
      capabilities: ["invoices"],
      flow: "oauth2",
      envVars: ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET"],
      oauth: {
        authUrl: "https://appcenter.intuit.com/connect/oauth2",
        tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
        scopes: ["com.intuit.quickbooks.accounting"],
        clientIdEnv: "QUICKBOOKS_CLIENT_ID",
        clientSecretEnv: "QUICKBOOKS_CLIENT_SECRET",
        tokenAuth: "basic",
      },
      syncIntervalHours: 6,
      multiInstance: false,
    },
    {
      id: "xero",
      name: "Xero",
      description: "Pulls receivable and payable invoices from Xero.",
      category: "accounting",
      capabilities: ["invoices"],
      flow: "oauth2",
      envVars: ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET"],
      oauth: {
        authUrl: "https://login.xero.com/identity/connect/authorize",
        tokenUrl: "https://identity.xero.com/connect/token",
        scopes: [
          "offline_access",
          "accounting.transactions.read",
          "accounting.contacts.read",
        ],
        clientIdEnv: "XERO_CLIENT_ID",
        clientSecretEnv: "XERO_CLIENT_SECRET",
        tokenAuth: "basic",
      },
      syncIntervalHours: 6,
      multiInstance: false,
    },
    {
      id: "exact",
      name: "Exact Online",
      description: "Pulls sales invoices and purchase entries from Exact Online.",
      category: "accounting",
      capabilities: ["invoices"],
      flow: "oauth2",
      envVars: ["EXACT_CLIENT_ID", "EXACT_CLIENT_SECRET"],
      oauth: {
        authUrl: `${exactBase()}/api/oauth2/auth`,
        tokenUrl: `${exactBase()}/api/oauth2/token`,
        scopes: [],
        clientIdEnv: "EXACT_CLIENT_ID",
        clientSecretEnv: "EXACT_CLIENT_SECRET",
        tokenAuth: "body",
        extraAuthParams: { force_login: "0" },
      },
      syncIntervalHours: 6,
      multiInstance: false,
    },
    // ----------------------------------------------------- productivity
    {
      id: "gmail",
      name: "Gmail",
      description: "Scans your inbox for PDF invoices and imports them for review.",
      category: "productivity",
      capabilities: ["email"],
      flow: "oauth2",
      envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SUPABASE_SERVICE_ROLE_KEY"],
      oauth: {
        authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        clientIdEnv: "GOOGLE_CLIENT_ID",
        clientSecretEnv: "GOOGLE_CLIENT_SECRET",
        tokenAuth: "body",
        extraAuthParams: { access_type: "offline", prompt: "consent" },
      },
      syncIntervalHours: 6,
      multiInstance: false,
    },
    {
      id: "outlook",
      name: "Outlook",
      description: "Scans your Microsoft 365 mailbox for PDF invoices.",
      category: "productivity",
      capabilities: ["email"],
      flow: "oauth2",
      envVars: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "SUPABASE_SERVICE_ROLE_KEY"],
      oauth: {
        authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        scopes: ["offline_access", "https://graph.microsoft.com/Mail.Read"],
        clientIdEnv: "MICROSOFT_CLIENT_ID",
        clientSecretEnv: "MICROSOFT_CLIENT_SECRET",
        tokenAuth: "body",
      },
      syncIntervalHours: 6,
      multiInstance: false,
    },
    {
      id: "slack",
      name: "Slack",
      description: "Sends finance alerts and digests to a Slack channel.",
      category: "productivity",
      capabilities: ["notifications"],
      flow: "oauth2",
      envVars: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"],
      oauth: {
        authUrl: "https://slack.com/oauth/v2/authorize",
        tokenUrl: "https://slack.com/api/oauth.v2.access",
        scopes: ["incoming-webhook"],
        clientIdEnv: "SLACK_CLIENT_ID",
        clientSecretEnv: "SLACK_CLIENT_SECRET",
        tokenAuth: "body",
      },
      syncIntervalHours: null,
      multiInstance: false,
    },
    {
      id: "teams",
      name: "Microsoft Teams",
      description: "Sends finance alerts and digests to a Teams channel via incoming webhook.",
      category: "productivity",
      capabilities: ["notifications"],
      flow: "webhook",
      envVars: [],
      syncIntervalHours: null,
      multiInstance: false,
    },
    {
      id: "google-calendar",
      name: "Google Calendar",
      description: "Creates calendar events for upcoming bills and invoice due dates.",
      category: "productivity",
      capabilities: ["calendar"],
      flow: "oauth2",
      envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      oauth: {
        authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        scopes: ["https://www.googleapis.com/auth/calendar.events"],
        clientIdEnv: "GOOGLE_CLIENT_ID",
        clientSecretEnv: "GOOGLE_CLIENT_SECRET",
        tokenAuth: "body",
        extraAuthParams: { access_type: "offline", prompt: "consent" },
      },
      syncIntervalHours: 24,
      multiInstance: false,
    },
  ];
}

export function getProvider(id: string): IntegrationProvider | null {
  return getProviders().find((provider) => provider.id === id) ?? null;
}

/**
 * Whether an edition has any use for a provider. Bank data and the outgoing
 * channels serve both; accounting systems and mailbox scanning exist to feed
 * the invoice module, which a Personal workspace does not have — offering them
 * there would promise an import that lands nowhere.
 */
export function editionAllowsProvider(
  type: WorkspaceType,
  provider: IntegrationProvider
): boolean {
  if (provider.category === "accounting") return editionHasFeature(type, "accounting");
  if (provider.capabilities.some((capability) => capability === "invoices" || capability === "email")) {
    return editionHasFeature(type, "invoices");
  }
  return true;
}

/** Providers worth showing to a workspace of this type. */
export function providersForWorkspace(type: WorkspaceType): IntegrationProvider[] {
  return getProviders().filter((provider) => editionAllowsProvider(type, provider));
}

/** All env vars set (plus the shared encryption key for token-storing flows). */
export function isProviderConfigured(provider: IntegrationProvider): boolean {
  return provider.envVars.every((envVar) => Boolean(process.env[envVar]));
}

export const CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  banking: "Bank data",
  accounting: "Accounting",
  productivity: "Productivity",
};
