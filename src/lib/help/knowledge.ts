import { getProviderGuide } from "@/components/integrations/provider-guide";
import { PLANS, type PlanId } from "@/lib/billing/plans";

/**
 * The help agent's knowledge base: concise how-to topics written from the
 * actual UI (page names, button labels and flows as they exist today).
 * Content is markdown; relative links point at app pages so the chat can
 * navigate the user directly. Integration steps are imported from the
 * per-provider guides (provider-guide.ts) rather than duplicated, and plan
 * facts are generated from the billing plans module.
 */

export interface HelpTopic {
  id: string;
  title: string;
  /** Retrieval hints: words users are likely to use for this topic. */
  keywords: string[];
  /** Markdown with numbered steps matching the real UI. */
  content: string;
}

function numbered(steps: string[]): string {
  return steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
}

// ------------------------------------------------------------ bank connect

function bankConnectionContent(): string {
  const gc = getProviderGuide("gocardless");
  const plaid = getProviderGuide("plaid");
  const tink = getProviderGuide("tink");
  return `Bank connections live on the [Integrations](/integrations) page (sidebar → Integrations) and need the Business plan or higher.

**GoCardless (2,000+ European and UK banks)** — open [Integrations](/integrations), click the GoCardless tile, then:
${numbered(gc.userSteps)}

**Plaid (US and European banks)** — click the Plaid tile, then:
${numbered(plaid.userSteps)}

**Tink (European banks)** — click the Tink tile, then:
${numbered(tink.userSteps)}

Notes:
- A tile marked **Needs setup** means an administrator has not configured that provider on the server yet — the tile's detail view has a "Setup for administrators" section with the exact steps.
- Connections are read-only: the app can see transactions and balances but can never move money.
- Connected banks sync automatically every 6 hours; use **Sync now** in the tile's detail view for an immediate sync.
- Bank consent (GoCardless) lasts up to 180 days; a renewal warning appears on the tile before it expires.
- If you can't use a bank connection, importing a CSV bank statement on the [Import](/import) page achieves the same result manually.`;
}

// ------------------------------------------------------------------- plans

function planLine(planId: PlanId): string {
  const plan = PLANS[planId];
  const limits = plan.limits;
  const parts = [
    limits.csvImportsPerMonth === null
      ? "unlimited CSV imports"
      : `${limits.csvImportsPerMonth} CSV import/month`,
    limits.aiMessagesPerMonth === null
      ? "unlimited AI messages"
      : `${limits.aiMessagesPerMonth} AI messages/month`,
    limits.invoiceExtractionsPerMonth === null
      ? "unlimited invoice extractions"
      : `${limits.invoiceExtractionsPerMonth} invoice extractions/month`,
    limits.exportsEnabled ? "report exports" : "no report exports",
    limits.assumptionsEnabled ? "forecast assumptions" : "no forecast assumptions",
    limits.integrationsEnabled ? "integrations" : "no integrations",
  ];
  return `- **${plan.name}**: ${parts.join(", ")}.`;
}

function billingContent(): string {
  return `Plans and billing are managed on the [Billing](/billing) page (sidebar → Billing).

What each plan includes:
${(["FREE", "PRO", "BUSINESS", "ENTERPRISE"] as PlanId[]).map(planLine).join("\n")}

Key things to know:
- New accounts start with a **14-day Pro trial** (no card required); after it ends you're on Free unless you upgrade.
- To upgrade: open [Billing](/billing) and click the upgrade button on the plan you want — payment goes through Stripe Checkout.
- To change or cancel a paid plan: use **Manage billing** on the same page (opens the Stripe billing portal with invoices and payment methods).
- Usage meters on the Billing page show how much of your monthly quota (AI messages, imports, extractions) you've used.
- **Referrals**: your personal referral link is on the Billing page — each friend who signs up and converts earns you +1 month of Pro credit.
- Help-agent messages (this chat) never count against your AI message quota.`;
}

// ------------------------------------------------------------------ topics

export function getHelpTopics(): HelpTopic[] {
  return [
    {
      id: "getting-started",
      title: "Getting started",
      keywords: [
        "start", "begin", "new", "setup", "onboarding", "first", "empty", "demo",
        "tour", "overview", "welcome",
      ],
      content: `The fastest way to get value out of FinPilot:

1. After signup, the onboarding wizard asks about your business — it tailors benchmarks and recommendations; you can skip it and revisit later.
2. Get your transactions in: either import a CSV bank statement on the [Import](/import) page or connect a bank on the [Integrations](/integrations) page (Business plan).
3. Check the [Dashboard](/dashboard): income vs expenses, monthly cashflow, spending by category, largest expenses and cash balance history all populate from your transactions.
4. Open the [Forecast](/forecast) page for cash runway and projections, and ask the [Copilot](/copilot) questions about your numbers.`,
    },
    {
      id: "csv-import",
      title: "Importing a CSV bank statement",
      keywords: [
        "csv", "import", "upload", "statement", "file", "excel", "bank statement",
        "mapping", "columns", "delimiter", "undo", "duplicate",
      ],
      content: `To import a bank statement, open the [Import](/import) page (sidebar → Import):

1. Drag your CSV file onto the upload area (or click to browse).
2. The app auto-detects the delimiter (comma/semicolon/tab), encoding, and US/European number and date formats.
3. Review the **column mapping preview**: check that date, description and amount (or debit/credit) columns were detected correctly, and fix any column with the dropdowns.
4. Click to commit the import. Duplicates of transactions you already have are skipped automatically.
5. New transactions are auto-categorized by your category rules; anything unmatched stays uncategorized for you to fill in.

Good to know:
- Every import is tracked as a batch — the **import history** list on the Import page has an **Undo** button per batch that removes exactly those transactions.
- On the Free plan you get 1 CSV import per month (see [Billing](/billing)); Pro and up are unlimited.
- If a file won't parse, check it's a real CSV/TSV (not XLSX) — exporting as "CSV" from your bank or Excel usually fixes it.`,
    },
    {
      id: "categories-rules",
      title: "Categories and auto-categorization rules",
      keywords: [
        "category", "categories", "categorize", "rule", "rules", "tag", "label",
        "auto", "uncategorized", "organize",
      ],
      content: `Categories live on the [Categories](/categories) page (sidebar → Categories):

1. A default set of income and expense categories is created for you; add your own with the new-category button.
2. Create **auto-categorization rules** that match text in a transaction's description or counterparty (e.g. "spotify" → Subscriptions). Rules apply to future CSV imports and bank syncs automatically.
3. To recategorize existing transactions, use the [Transactions](/transactions) page: change the category inline on a row, or select multiple rows and set the category in bulk.`,
    },
    {
      id: "transactions",
      title: "Searching, filtering and editing transactions",
      keywords: [
        "transaction", "transactions", "search", "filter", "edit", "delete",
        "bulk", "select", "find", "list", "date range", "amount",
      ],
      content: `Everything is on the [Transactions](/transactions) page (sidebar → Transactions):

1. **Search** the free-text box to match descriptions and counterparties.
2. **Filter** by date range, category, type (income/expense), amount range, or import batch using the toolbar.
3. **Edit inline**: click a row's category to change it on the spot.
4. **Bulk edit**: tick the checkboxes on multiple rows, then set a category or delete them in one action.
5. Deleting is permanent; to remove an entire mis-imported file at once, prefer **Undo** on that batch from the [Import](/import) page.`,
    },
    {
      id: "copilot",
      title: "Using the Finance Copilot",
      keywords: [
        "copilot", "ai", "chat", "ask", "question", "assistant", "finance",
        "analysis", "insight", "numbers",
      ],
      content: `The [Copilot](/copilot) (sidebar → Copilot) answers questions about **your financial data** — it sees your transactions, categories, balances, trends, forecasts and assumptions:

1. Open [Copilot](/copilot) and type a question ("What did I spend on software last month?", "Can I afford a new hire?"), or tap a suggestion chip.
2. Answers stream in with your real numbers; conversations are saved in the sidebar where you can rename or delete them.
3. Copilot messages count against your plan's monthly AI message quota (see [Billing](/billing)).

Note: for questions about **how to use the app**, use this help assistant — it doesn't consume your AI quota.`,
    },
    {
      id: "forecast",
      title: "Forecasts, runway and assumptions",
      keywords: [
        "forecast", "runway", "burn", "projection", "predict", "cash", "future",
        "assumption", "assumptions", "scenario", "growth",
      ],
      content: `Open the [Forecast](/forecast) page (sidebar → Forecast):

1. Toggle between **30-day, 90-day and 12-month** horizons; the chart shows projected balance with your historical actuals and a confidence band.
2. Stat cards show **cash runway** (months until cash hits zero at the current burn), net and gross **burn rate**, and recurring income/expenses detected from your history.
3. **Upcoming bills** lists the projected next dates of recurring expenses.
4. **Assumptions** (Pro plan and up) let you adjust the forecast: add one-off future income/expenses, monthly recurring adjustments with start/end dates, or a % growth adjustment. The forecast recomputes immediately.
5. Click **Explain this forecast** for an AI walkthrough of the drivers and risks.

The forecast is deterministic: trend projection + scheduled recurring items + your assumptions — no black-box model, so it's fully explainable.`,
    },
    {
      id: "invoices",
      title: "Invoices: upload, extraction and linking",
      keywords: [
        "invoice", "invoices", "receipt", "pdf", "scan", "extract", "vendor",
        "due", "paid", "unpaid", "overdue", "bill", "link",
      ],
      content: `Invoice management lives on the [Invoices](/invoices) page (sidebar → Invoices):

1. Drag a PDF or image (jpg/png/webp) onto the upload area.
2. The AI extracts vendor, invoice number, dates, VAT, line items and total — you always get an **editable review form** before anything is saved, so correct any field and confirm.
3. If extraction fails (e.g. a scanned PDF with no text), the document is kept attached and you can fill the fields in manually.
4. Statuses: **Draft** (not yet confirmed), **Unpaid**, **Paid** — overdue is derived from the due date. Use the quick action on a row to mark paid/unpaid.
5. **Link to transactions**: the invoice detail view suggests matching transactions (by amount, date and vendor similarity); linking a payment auto-marks the invoice paid.
6. Invoices due soon or overdue appear on the invoice dashboard and the main [Dashboard](/dashboard), and can trigger reminders (see notification settings).

Each plan includes a monthly extraction quota (see [Billing](/billing)).`,
    },
    {
      id: "reports-exports",
      title: "Reports and exports (PDF, Excel, CSV)",
      keywords: [
        "report", "reports", "export", "pdf", "excel", "xlsx", "download",
        "kpi", "margin", "revenue", "profit", "vendor", "customer", "aging",
      ],
      content: `Executive reporting is on the [Reports](/reports) page (sidebar → Reports):

1. Pick a **period** (this month, last month, quarter, YTD, last 12 months, or a custom range) — every figure follows it.
2. You get KPI cards (revenue, expenses, profit, margins, cash, AR/AP) with period-over-period deltas, monthly and yearly trend charts, category breakdowns, top vendors/customers and an AR/AP aging summary.
3. **Export** buttons produce a PDF report, a multi-sheet Excel workbook, or CSV files for the selected period.

Exports require the Pro plan or higher (see [Billing](/billing)).`,
    },
    {
      id: "notifications",
      title: "Setting up notifications and alerts",
      keywords: [
        "notification", "notifications", "alert", "alerts", "email", "push",
        "digest", "summary", "reminder", "bell", "warn", "threshold",
      ],
      content: `Notifications are configured on the [Settings](/settings) page (sidebar → Settings), in the **Notifications** section:

1. Choose your **summaries**: daily, weekly and/or monthly AI digests of what happened in your finances.
2. Configure **alerts**: large-transaction alerts (set your threshold amount), low-cash warnings (set a balance floor and how many days ahead the forecast should look), and invoice due/overdue reminders.
3. Pick **channels** per type: in-app (always available), email, and browser push notifications (click enable and accept the browser prompt).
4. In-app notifications arrive at the **bell icon** in the header — open it to read or mark all read.

If email or push options appear disabled, that channel hasn't been configured on the server (administrator: set RESEND_API_KEY for email, VAPID keys for push).`,
    },
    {
      id: "bank-connections",
      title: "Connecting your bank",
      keywords: [
        "bank", "connect", "connection", "gocardless", "plaid", "tink", "sync",
        "account", "psd2", "open banking", "link", "institution", "automatic",
      ],
      content: bankConnectionContent(),
    },
    {
      id: "integrations-other",
      title: "Accounting, email, messaging and calendar integrations",
      keywords: [
        "integration", "integrations", "quickbooks", "xero", "exact", "gmail",
        "outlook", "slack", "teams", "calendar", "google", "microsoft",
        "webhook", "accounting", "mailbox",
      ],
      content: `All integrations are on the [Integrations](/integrations) page (sidebar → Integrations, Business plan and up). Click any tile to see what it does, the privacy details, and tailored connect steps. In short:

- **QuickBooks, Xero, Exact Online**: connect with your accounting login; bills and invoices are pulled into the [Invoices](/invoices) module automatically every 6 hours.
- **Gmail / Outlook**: read-only mailbox access; PDF invoices found in your email are imported into the extraction pipeline for your review.
- **Slack / Microsoft Teams**: send your finance alerts and digests to a channel. Slack connects via sign-in; for Teams you paste an incoming webhook URL for the channel (created via the channel's Workflows/Connectors option).
- **Google Calendar**: creates calendar events for upcoming bills and invoice due dates — toggle it on in the tile's detail view after connecting.

Tiles marked **Needs setup** require an administrator to add the provider's credentials on the server — the tile's detail view lists the exact steps and environment variables. Disconnecting is always available in the tile's detail view and revokes access where the provider supports it.`,
    },
    {
      id: "billing-plans",
      title: "Plans, billing and referrals",
      keywords: [
        "plan", "plans", "billing", "price", "pricing", "upgrade", "downgrade",
        "cancel", "trial", "subscription", "pay", "stripe", "quota", "limit",
        "referral", "invoice history", "free", "pro", "business", "enterprise",
      ],
      content: billingContent(),
    },
    {
      id: "settings-profile",
      title: "Profile, currency, AI provider and appearance",
      keywords: [
        "profile", "settings", "currency", "dark", "theme", "mode", "password",
        "email", "avatar", "account", "provider", "language", "delete account",
      ],
      content: `Personal settings are split across two pages:

- The [Profile](/profile) page (sidebar → Profile): your name, avatar and account email, plus password changes.
- The [Settings](/settings) page (sidebar → Settings): your **display currency** (used everywhere in the app), the **AI provider** used for the copilot and extractions, theme (light/dark/system), and the notification preferences.

Changing the currency changes how amounts are displayed and interpreted for new data — it doesn't convert historical amounts between currencies.`,
    },
    {
      id: "help-escalation",
      title: "Getting more help / reporting a problem",
      keywords: [
        "bug", "problem", "issue", "broken", "error", "support", "contact",
        "human", "report", "feedback", "stuck", "crash", "wrong",
      ],
      content: `If something looks broken or you're stuck:

1. Use the **Report issue** button at the bottom of the sidebar (or in your avatar menu, top right). It pre-fills the page URL and browser details.
2. Describe what you did and what you expected — the report goes straight to the team.
3. For questions about your own numbers, ask the [Copilot](/copilot); for how-to questions, this help assistant is the right place.`,
    },
  ];
}
