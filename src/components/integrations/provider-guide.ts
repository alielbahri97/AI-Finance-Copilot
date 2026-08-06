/**
 * Plain-language content for the integration detail view: what each provider
 * does, what data flows where, and step-by-step setup for users and (when
 * server credentials are missing) administrators.
 */

export interface ProviderGuide {
  /** 2-3 "what it does" bullets, user language, no jargon. */
  bullets: string[];
  /** Data & privacy reassurance bullets. */
  privacy: string[];
  /** Numbered steps for the user once the server is configured. */
  userSteps: string[];
  /** Numbered steps for the administrator to configure the server. */
  adminSteps: string[];
  /** Developer portal to start at. */
  adminUrl?: string;
  adminUrlLabel?: string;
}

const BANK_PRIVACY = [
  "You log in at your bank — your banking credentials never touch this app.",
  "Access is read-only: transactions and balances can be seen, money can never be moved.",
  "Access tokens are stored encrypted and you can disconnect at any time.",
];

const RESTART_STEP = "Restart or redeploy the app so the new variables are picked up.";

export const PROVIDER_GUIDES: Record<string, ProviderGuide> = {
  plaid: {
    bullets: [
      "Connects US and European bank accounts through Plaid Link.",
      "Imports your bank transactions automatically every 6 hours.",
      "New transactions are deduplicated and auto-categorized like CSV imports.",
    ],
    privacy: BANK_PRIVACY,
    userSteps: [
      "Click Connect — a secure Plaid window opens.",
      "Search for your bank and sign in there.",
      "Approve read-only access; your transactions start importing right away.",
    ],
    adminSteps: [
      "Create a Plaid account and team at dashboard.plaid.com.",
      "Copy the client ID and the sandbox or production secret from the keys page.",
      "Set the environment variables below (optionally PLAID_ENV=sandbox to start).",
      RESTART_STEP,
    ],
    adminUrl: "https://dashboard.plaid.com",
    adminUrlLabel: "dashboard.plaid.com",
  },
  tink: {
    bullets: [
      "Connects European bank accounts through Tink's open-banking platform.",
      "Imports your bank transactions automatically every 6 hours.",
      "New transactions are deduplicated and auto-categorized like CSV imports.",
    ],
    privacy: BANK_PRIVACY,
    userSteps: [
      "Click Connect — you'll be taken to Tink.",
      "Pick your bank and sign in there.",
      "Approve read-only access and you'll be brought back here.",
    ],
    adminSteps: [
      "Create an app in the Tink Console at console.tink.com.",
      "Add the redirect URI <your app URL>/api/integrations/tink/callback.",
      "Set the environment variables below (TINK_MARKET defaults to GB).",
      RESTART_STEP,
    ],
    adminUrl: "https://console.tink.com",
    adminUrlLabel: "console.tink.com",
  },
  gocardless: {
    bullets: [
      "Connects 2,000+ European and UK banks (PSD2 account access).",
      "Imports transactions and balances automatically every 6 hours.",
      "Consent lasts as long as your bank allows (usually 90 days, up to 180) with a renewal reminder before it expires.",
    ],
    privacy: BANK_PRIVACY,
    userSteps: [
      "Click Connect bank and pick your country and bank.",
      "You'll be sent to your bank to log in and approve read-only access.",
      "You'll be brought back here and the first import runs automatically.",
    ],
    adminSteps: [
      "Create a free Bank Account Data account at bankaccountdata.gocardless.com and confirm the email.",
      "Open Developers → User secrets in the left-hand menu and click “+ Create new”.",
      "Leave the IP allow-list empty unless this app has a fixed outbound IP — an address that doesn't match makes every token request fail with HTTP 403.",
      "Copy or download the secret ID and secret key immediately: the key is shown only once.",
      "Set the environment variables below. No redirect URI has to be registered anywhere — it is sent with each bank request and derived from NEXT_PUBLIC_APP_URL, so make sure that variable matches how the app is actually reached.",
      "Optional: set GOCARDLESS_INSTITUTION_ID to SANDBOXFINANCE_SFIN0000 to add GoCardless's test bank to the picker and try the whole flow without a real bank.",
      RESTART_STEP,
    ],
    adminUrl: "https://bankaccountdata.gocardless.com",
    adminUrlLabel: "bankaccountdata.gocardless.com",
  },
  quickbooks: {
    bullets: [
      "Pulls bills and invoices from QuickBooks Online.",
      "Imported documents appear in the Invoices module with vendor, dates and totals.",
      "Syncs automatically every 6 hours.",
    ],
    privacy: [
      "Read access to your accounting data only — nothing is written back to QuickBooks.",
      "Access tokens are stored encrypted and you can disconnect at any time.",
    ],
    userSteps: [
      "Click Connect and sign in to Intuit.",
      "Choose the company to share and approve read access.",
      "Bills and invoices start syncing automatically.",
    ],
    adminSteps: [
      "Create an app at developer.intuit.com with the Accounting scope.",
      "Add the redirect URI <your app URL>/api/integrations/quickbooks/callback.",
      "Set the environment variables below (QUICKBOOKS_ENV=sandbox for test companies).",
      RESTART_STEP,
    ],
    adminUrl: "https://developer.intuit.com",
    adminUrlLabel: "developer.intuit.com",
  },
  xero: {
    bullets: [
      "Pulls receivable and payable invoices from Xero.",
      "Imported documents appear in the Invoices module with contact, dates and totals.",
      "Syncs automatically every 6 hours.",
    ],
    privacy: [
      "Read-only scopes: transactions and contacts can be read, never changed.",
      "Access tokens are stored encrypted and you can disconnect at any time.",
    ],
    userSteps: [
      "Click Connect and sign in to Xero.",
      "Choose the organisation to share and approve read access.",
      "Invoices start syncing automatically.",
    ],
    adminSteps: [
      "Create a web app at developer.xero.com.",
      "Add the redirect URI <your app URL>/api/integrations/xero/callback.",
      "Set the environment variables below.",
      RESTART_STEP,
    ],
    adminUrl: "https://developer.xero.com",
    adminUrlLabel: "developer.xero.com",
  },
  exact: {
    bullets: [
      "Pulls sales invoices and purchase entries from Exact Online.",
      "Imported documents appear in the Invoices module.",
      "Syncs automatically every 6 hours.",
    ],
    privacy: [
      "Read access to invoice data only — nothing is written back to Exact.",
      "Access tokens are stored encrypted and you can disconnect at any time.",
    ],
    userSteps: [
      "Click Connect and sign in to Exact Online.",
      "Approve access for your division.",
      "Invoices start syncing automatically.",
    ],
    adminSteps: [
      "Register an app at apps.exactonline.com for your region.",
      "Add the redirect URI <your app URL>/api/integrations/exact/callback.",
      "Set the environment variables below (EXACT_REGION, e.g. start.exactonline.nl).",
      RESTART_STEP,
    ],
    adminUrl: "https://apps.exactonline.com",
    adminUrlLabel: "apps.exactonline.com",
  },
  gmail: {
    bullets: [
      "Scans your Gmail inbox for PDF invoices every 6 hours.",
      "Found invoices are imported into the extraction pipeline for your review.",
      "Nothing is saved without you confirming the extracted details.",
    ],
    privacy: [
      "Read-only mailbox access — no emails are sent, changed or deleted.",
      "Only invoice-like PDF attachments are pulled in; email bodies stay in Gmail.",
      "Access tokens are stored encrypted and you can disconnect at any time.",
    ],
    userSteps: [
      "Click Connect and sign in with Google.",
      "Allow read-only access to your mailbox.",
      "Invoices found in your email appear under Invoices for review.",
    ],
    adminSteps: [
      "Create an OAuth client in the Google Cloud Console and enable the Gmail API.",
      "Add the redirect URI <your app URL>/api/integrations/gmail/callback.",
      "Set the environment variables below.",
      RESTART_STEP,
    ],
    adminUrl: "https://console.cloud.google.com/apis/credentials",
    adminUrlLabel: "Google Cloud Console",
  },
  outlook: {
    bullets: [
      "Scans your Microsoft 365 mailbox for PDF invoices every 6 hours.",
      "Found invoices are imported into the extraction pipeline for your review.",
      "Nothing is saved without you confirming the extracted details.",
    ],
    privacy: [
      "Read-only mailbox access — no emails are sent, changed or deleted.",
      "Only invoice-like PDF attachments are pulled in; email bodies stay in Outlook.",
      "Access tokens are stored encrypted and you can disconnect at any time.",
    ],
    userSteps: [
      "Click Connect and sign in with Microsoft.",
      "Allow read-only access to your mailbox.",
      "Invoices found in your email appear under Invoices for review.",
    ],
    adminSteps: [
      "Register an app in the Microsoft Entra admin center with the Mail.Read permission.",
      "Add the redirect URI <your app URL>/api/integrations/outlook/callback.",
      "Set the environment variables below.",
      RESTART_STEP,
    ],
    adminUrl: "https://entra.microsoft.com",
    adminUrlLabel: "Microsoft Entra admin center",
  },
  slack: {
    bullets: [
      "Posts your finance alerts and digests to a Slack channel of your choice.",
      "Works with the same notification settings as email and push.",
    ],
    privacy: [
      "Send-only: messages are posted to the one channel you approve — nothing is read from Slack.",
      "Access tokens are stored encrypted and you can disconnect at any time.",
    ],
    userSteps: [
      "Click Connect and sign in to your Slack workspace.",
      "Pick the channel that should receive alerts.",
      "That's it — alerts and digests are posted there from now on.",
    ],
    adminSteps: [
      "Create a Slack app at api.slack.com/apps with the incoming-webhook scope.",
      "Add the redirect URI <your app URL>/api/integrations/slack/callback.",
      "Set the environment variables below.",
      RESTART_STEP,
    ],
    adminUrl: "https://api.slack.com/apps",
    adminUrlLabel: "api.slack.com/apps",
  },
  teams: {
    bullets: [
      "Posts your finance alerts and digests to a Microsoft Teams channel.",
      "Works with the same notification settings as email and push.",
    ],
    privacy: [
      "Send-only: messages go to the one webhook URL you paste — nothing is read from Teams.",
      "The webhook URL is stored encrypted and you can disconnect at any time.",
    ],
    userSteps: [
      "In Teams, open the target channel's options (⋯) and create an incoming webhook (via Workflows or Connectors).",
      "Copy the webhook URL Teams gives you.",
      "Click Connect here, paste the URL and save — a test message confirms it works.",
    ],
    adminSteps: [],
  },
  "google-calendar": {
    bullets: [
      "Creates calendar events for upcoming bills and invoice due dates.",
      "Events update daily, so your calendar always reflects what's due.",
    ],
    privacy: [
      "Access is limited to creating and updating events — your existing calendar entries are never read.",
      "Access tokens are stored encrypted and you can disconnect at any time.",
    ],
    userSteps: [
      "Click Connect and sign in with Google.",
      "Allow access to create calendar events.",
      "Toggle event creation on, and upcoming bills appear in your calendar.",
    ],
    adminSteps: [
      "Create an OAuth client in the Google Cloud Console and enable the Calendar API.",
      "Add the redirect URI <your app URL>/api/integrations/google-calendar/callback.",
      "Set the environment variables below.",
      RESTART_STEP,
    ],
    adminUrl: "https://console.cloud.google.com/apis/credentials",
    adminUrlLabel: "Google Cloud Console",
  },
};

export function getProviderGuide(providerId: string): ProviderGuide {
  return (
    PROVIDER_GUIDES[providerId] ?? {
      bullets: [],
      privacy: [],
      userSteps: ["Click Connect and follow the provider's sign-in flow."],
      adminSteps: ["Set the environment variables below.", RESTART_STEP],
    }
  );
}
