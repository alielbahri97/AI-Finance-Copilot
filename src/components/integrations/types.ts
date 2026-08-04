/** Serialized provider + connection state passed from the server page. */
export interface IntegrationCardData {
  id: string;
  name: string;
  description: string;
  category: "banking" | "accounting" | "productivity";
  capabilities: string[];
  flow: "oauth2" | "plaid" | "redirect" | "webhook";
  configured: boolean;
  missingEnvVars: string[];
  /** Whether the provider has something to sync (vs. outgoing-only). */
  syncable: boolean;
  /** Default country for the GoCardless bank picker (from the profile). */
  bankPickerCountry?: string;
  connection: {
    status: "CONNECTED" | "ERROR" | "EXPIRED";
    lastSyncAt: string | null;
    lastError: string | null;
    /** Slack channel / Xero tenant / bank + account summary, when known. */
    accountLabel: string | null;
    calendarEnabled: boolean;
    lastRunStats: Record<string, number> | null;
    /** End-user agreement expiry (GoCardless consent), when known. */
    consentExpiresAt: string | null;
    /** Latest future per-account rate-limit window, when the bank throttled us. */
    rateLimitedUntil: string | null;
  } | null;
}

export const CAPABILITY_LABELS: Record<string, string> = {
  transactions: "Transactions",
  invoices: "Invoices",
  email: "Email invoices",
  notifications: "Notifications",
  calendar: "Calendar",
};
