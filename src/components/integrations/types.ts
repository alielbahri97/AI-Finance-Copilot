/** One account inside a bank connection, as shown in the detail sheet. */
export interface BankAccountData {
  id: string;
  /** Masked identifier or provider name, e.g. "…1234". */
  label: string;
  currency: string | null;
  balance: number | null;
  balanceAt: string | null;
  includeInTotals: boolean;
}

/** One connection to a provider. A workspace can have several (one per bank). */
export interface ConnectionData {
  id: string;
  status: "CONNECTED" | "ERROR" | "EXPIRED";
  /** User-chosen label, when they renamed it. */
  displayName: string | null;
  /** Bank/organisation name and logo from the provider. */
  institutionName: string | null;
  institutionLogo: string | null;
  /** What to show as the row heading: displayName, institution, or provider. */
  title: string;
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
  accounts: BankAccountData[];
  /** Sum of the accounts counted towards the totals, when they share a currency. */
  includedBalance: number | null;
  balanceCurrency: string | null;
}

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
  /** Every env var the provider needs (for the admin setup guide). */
  requiredEnvVars: string[];
  /** Whether the provider has something to sync (vs. outgoing-only). */
  syncable: boolean;
  /** Whether a second connection to this provider is allowed. */
  multiInstance: boolean;
  /** Default country for the GoCardless bank picker (from the profile). */
  bankPickerCountry?: string;
  /** Workspace currency, used when an account's own currency is unknown. */
  currency: string;
  /** Every connection this workspace has to the provider, oldest first. */
  connections: ConnectionData[];
}

export const CAPABILITY_LABELS: Record<string, string> = {
  transactions: "Transactions",
  invoices: "Invoices",
  email: "Email invoices",
  notifications: "Notifications",
  calendar: "Calendar",
};
