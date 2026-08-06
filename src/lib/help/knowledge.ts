import { getProviderGuide } from "@/components/integrations/provider-guide";
import {
  formatPlanPrice,
  getPlan,
  planOrder,
  referralRewardPlan,
  REFERRAL_REWARD_DAYS,
  trialPlan,
  type Plan,
  type PlanLimits,
} from "@/lib/billing/plans";
import { BRAND, DEFAULT_EDITION, editionBranding, type Edition } from "@/lib/branding";
import { MAX_IMPORT_FILE_MB } from "@/lib/validations/import";

/**
 * The help agent's knowledge base: concise how-to topics written from the
 * actual UI (page names, button labels and flows as they exist today).
 * Content is markdown; relative links point at app pages so the chat can
 * navigate the user directly. Integration steps are imported from the
 * per-provider guides (provider-guide.ts) rather than duplicated, and plan
 * facts are generated from the billing plans module.
 *
 * Topics are edition-scoped. A Personal workspace must never be told how to
 * extract VAT from an invoice or invite a colleague — those surfaces do not
 * exist for it — and a Business workspace has no budgets or savings goals to
 * explain. `getHelpTopics(edition)` returns only what that edition can do, so
 * the retrieved articles cannot describe a page the user is blocked from.
 */

export interface HelpTopic {
  id: string;
  title: string;
  /** Retrieval hints: words users are likely to use for this topic. */
  keywords: string[];
  /** Markdown with numbered steps matching the real UI. */
  content: string;
}

/** A topic plus the editions it belongs to; `editions` omitted means both. */
interface EditionTopic extends HelpTopic {
  editions?: readonly Edition[];
}

function numbered(steps: string[]): string {
  return steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
}

/* ------------------------------------------------------------------ */
/* Plan facts                                                          */
/* ------------------------------------------------------------------ */

/** The cheapest tier in an edition that turns a limit on, for "needs X" copy. */
function cheapestPlanWith(
  edition: Edition,
  predicate: (limits: PlanLimits) => boolean
): Plan | null {
  for (const id of planOrder(edition)) {
    const plan = getPlan(id, edition);
    if (predicate(plan.limits)) return plan;
  }
  return null;
}

/** "the Pro plan or higher", or a plain fallback if no tier offers it. */
function planGate(edition: Edition, predicate: (limits: PlanLimits) => boolean): string {
  const plan = cheapestPlanWith(edition, predicate);
  if (!plan) return "a paid plan";
  if (plan.monthlyPriceEur === 0) return "every plan, including Free";
  return `the ${plan.name} plan or higher`;
}

function freePlanOf(edition: Edition): Plan {
  return getPlan("FREE", edition);
}

function planLine(plan: Plan, edition: Edition): string {
  const limits = plan.limits;
  const parts: string[] = [];

  parts.push(
    limits.csvImportsPerMonth === null
      ? "unlimited statement imports"
      : `${limits.csvImportsPerMonth} statement import${limits.csvImportsPerMonth === 1 ? "" : "s"}/month`
  );
  parts.push(
    limits.aiMessagesPerMonth === null
      ? "unlimited AI messages"
      : `${limits.aiMessagesPerMonth} AI messages/month`
  );

  if (edition === "personal") {
    parts.push(
      limits.bankConnections === null
        ? "unlimited bank connections"
        : `${limits.bankConnections} bank connection${limits.bankConnections === 1 ? "" : "s"}`
    );
    parts.push("budgets");
    if (limits.goalsEnabled) parts.push("savings goals");
    if (limits.subscriptionInsightsEnabled) parts.push("subscription insights");
  } else {
    parts.push(
      limits.invoiceExtractionsPerMonth === null
        ? "unlimited invoice extractions"
        : `${limits.invoiceExtractionsPerMonth} invoice extractions/month`
    );
    parts.push(limits.integrationsEnabled ? "integrations" : "no integrations");
  }

  parts.push(
    limits.exportsEnabled
      ? "Excel/PDF exports (CSV free on every plan)"
      : "CSV exports (Excel/PDF on paid plans)"
  );
  parts.push(limits.assumptionsEnabled ? "forecast assumptions" : "no forecast assumptions");

  const price = formatPlanPrice(plan);
  const priceLabel = price === null ? "custom pricing" : price === "Free" ? "€0" : `${price}/month`;
  return `- **${plan.name}** (${priceLabel}): ${parts.join(", ")}.`;
}

function billingContent(edition: Edition): string {
  const lines = planOrder(edition)
    .map((id) => planLine(getPlan(id, edition), edition))
    .join("\n");
  const trialName = getPlan(trialPlan(edition), edition).name;
  const rewardName = referralRewardPlan(edition).name;
  const seatNote =
    edition === "personal"
      ? "- A personal workspace is just you, so there is nothing to share and nobody to add."
      : "- Members plus pending invitations use up your plan's seats; the Billing page shows how many you have left.";

  return `Plans and billing are managed on the [Billing](/billing) page (sidebar → Billing).

What each plan includes:
${lines}

Key things to know:
- New accounts start with a **14-day ${trialName} trial** (no card required); after it ends you're on Free unless you upgrade.
- To upgrade: open [Billing](/billing) and click the upgrade button on the plan you want — payment goes through Stripe Checkout.
- To change or cancel a paid plan: use **Manage billing** on the same page (opens the Stripe billing portal with invoices and payment methods).
- Usage meters on the Billing page show how much of your monthly quota you've used.
${seatNote}
- **Referrals**: your personal referral link is on the Billing page — each friend who signs up and upgrades to a paid plan earns you ${REFERRAL_REWARD_DAYS} days of ${rewardName}, applied automatically.
- Help-agent messages (this chat) never count against your AI message quota.`;
}

/* ------------------------------------------------------------------ */
/* Bank connections                                                    */
/* ------------------------------------------------------------------ */

function bankConnectionContent(edition: Edition): string {
  const gc = getProviderGuide("gocardless");
  const plaid = getProviderGuide("plaid");
  const tink = getProviderGuide("tink");
  const free = freePlanOf(edition);
  const gate =
    edition === "personal"
      ? `Free includes ${free.limits.bankConnections === 1 ? "1 bank connection" : `${free.limits.bankConnections} bank connections`}; ${planGate(edition, (limits) => limits.bankConnections === null)} removes the limit.`
      : `They need ${planGate(edition, (limits) => limits.integrationsEnabled)}.`;

  return `Bank connections live on the [Integrations](/integrations) page (sidebar → Integrations). ${gate}

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

/* ------------------------------------------------------------------ */
/* Topics                                                              */
/* ------------------------------------------------------------------ */

function gettingStartedContent(edition: Edition): string {
  if (edition === "personal") {
    return `The fastest way to get value out of ${editionBranding("personal").name}:

1. Get your transactions in: connect a bank on the [Integrations](/integrations) page, or import a CSV bank statement on the [Import](/import) page.
2. Check the [Dashboard](/dashboard): money in vs out, what you spent by category, your balance over time, upcoming bills and how you're tracking against your budgets.
3. Set a monthly budget for the categories you care about on the [Budgets](/budgets) page — it takes a minute and makes the dashboard far more useful.
4. Add what you're saving for on the [Goals](/goals) page, review what's on repeat under [Subscriptions](/subscriptions), and ask the [Copilot](/copilot) anything about your numbers.`;
  }
  return `The fastest way to get value out of ${BRAND.name}:

1. After signup, the onboarding wizard asks about your business — it tailors benchmarks and recommendations; you can skip it and revisit later.
2. Get your transactions in: either import a CSV bank statement on the [Import](/import) page or connect a bank on the [Integrations](/integrations) page (Business plan).
3. Check the [Dashboard](/dashboard): income vs expenses, monthly cashflow, spending by category, largest expenses and cash balance history all populate from your transactions.
4. Open the [Forecast](/forecast) page for cash runway and projections, and ask the [Copilot](/copilot) questions about your numbers.`;
}

function copilotContent(edition: Edition): string {
  const examples =
    edition === "personal"
      ? '("Where did my money go this month?", "How much do I spend on eating out?", "Can I afford a €2,000 holiday?")'
      : '("What did I spend on software last month?", "Can I afford a new hire?")';
  return `The [Copilot](/copilot) (sidebar → Copilot) answers questions about **your financial data** — it sees your transactions, categories, balances, trends, forecasts and assumptions:

1. Open [Copilot](/copilot) and type a question ${examples}, or tap a suggestion chip.
2. Answers stream in with your real numbers; conversations are saved in the sidebar where you can rename or delete them.
3. Copilot messages count against your plan's monthly AI message quota (see [Billing](/billing)).

Note: for questions about **how to use the app**, use this help assistant — it doesn't consume your AI quota.`;
}

function forecastContent(edition: Edition): string {
  const assumptionsGate = planGate(edition, (limits) => limits.assumptionsEnabled);
  if (edition === "personal") {
    return `Open the [Forecast](/forecast) page (sidebar → Forecast):

1. Toggle between **30-day, 90-day and 12-month** horizons; the chart projects your balance forward from your history, with a confidence band.
2. Stat cards show how long your money would last at your current rate, what you're spending on average, and the recurring income and payments detected from your history.
3. **Upcoming bills** lists the projected next dates and amounts of your recurring payments — the rent, the phone bill, the subscriptions.
4. **Assumptions** (${assumptionsGate}) let you model changes: a raise, a move, a one-off purchase, or a % change in spending. The forecast recomputes immediately.
5. Click **Explain this forecast** for an AI walkthrough of what's driving it.

The forecast is deterministic: trend projection + scheduled recurring items + your assumptions — no black-box model, so it's fully explainable.`;
  }
  return `Open the [Forecast](/forecast) page (sidebar → Forecast):

1. Toggle between **30-day, 90-day and 12-month** horizons; the chart shows projected balance with your historical actuals and a confidence band.
2. Stat cards show **cash runway** (months until cash hits zero at the current burn), net and gross **burn rate**, and recurring income/expenses detected from your history.
3. **Upcoming bills** lists the projected next dates of recurring expenses.
4. **Assumptions** (${assumptionsGate}) let you adjust the forecast: add one-off future income/expenses, monthly recurring adjustments with start/end dates, or a % growth adjustment. The forecast recomputes immediately.
5. Click **Explain this forecast** for an AI walkthrough of the drivers and risks.

The forecast is deterministic: trend projection + scheduled recurring items + your assumptions — no black-box model, so it's fully explainable.`;
}

function reportsContent(edition: Edition): string {
  const exportGate = planGate(edition, (limits) => limits.exportsEnabled);
  if (edition === "personal") {
    return `Reporting is on the [Reports](/reports) page (sidebar → Reports):

1. Pick a **period** (this month, last month, quarter, YTD, last 12 months, or a custom range) — every figure follows it.
2. You get money in, money out, what you kept and your balance, each with a change versus the previous period, plus monthly and yearly trends and a full category breakdown.
3. **Export** buttons produce a PDF report, a multi-sheet Excel workbook, or CSV files for the selected period.

Exports require ${exportGate} (see [Billing](/billing)).`;
  }
  return `Executive reporting is on the [Reports](/reports) page (sidebar → Reports):

1. Pick a **period** (this month, last month, quarter, YTD, last 12 months, or a custom range) — every figure follows it.
2. You get KPI cards (revenue, expenses, profit, margins, cash, AR/AP) with period-over-period deltas, monthly and yearly trend charts, category breakdowns, top vendors/customers and an AR/AP aging summary.
3. **Export** buttons produce a PDF report, a multi-sheet Excel workbook, or CSV files for the selected period.

Exports require ${exportGate} (see [Billing](/billing)).`;
}

function importContent(edition: Edition): string {
  const free = freePlanOf(edition);
  const freeLimit = free.limits.csvImportsPerMonth;
  const freeLine =
    freeLimit === null
      ? "- Statement imports are unlimited on every plan."
      : `- On the Free plan you get ${freeLimit} statement import${freeLimit === 1 ? "" : "s"} per month (see [Billing](/billing)); paid plans are unlimited.`;

  return `To import a bank statement, open the [Import](/import) page (sidebar → Import):

1. Drag your file onto the upload area (or click to browse). **CSV/TSV, Excel (.xlsx/.xls), PDF and MT940 (.mt940/.940/.sta)** statements are all accepted, up to ${MAX_IMPORT_FILE_MB} MB.
2. The format is detected from the file itself. For text exports the app auto-detects the delimiter (comma/semicolon/tab), encoding, and US/European number and date formats.
3. Review the **column mapping preview**: check that date, description and amount (or debit/credit) columns were detected correctly, and fix any column with the dropdowns.
4. Click to commit the import. Duplicates of transactions you already have are skipped automatically.
5. New transactions are auto-categorized by your category rules; anything unmatched stays uncategorized for you to fill in.

Good to know:
- Every import is tracked as a batch — the **import history** list on the Import page has an **Undo** button per batch that removes exactly those transactions.
${freeLine}
- PDF statements are read from the printed layout, so they are best-effort: always check the preview before importing. A scanned or photographed PDF has no text to read and will be rejected.
- Legacy Excel 97-2003 workbooks and password-protected files cannot be opened — re-save them as .xlsx or CSV first.`;
}

function integrationsContent(edition: Edition): string {
  const accounting =
    edition === "personal"
      ? ""
      : "\n- **QuickBooks, Xero, Exact Online**: connect with your accounting login; bills and invoices are pulled into the [Invoices](/invoices) module automatically every 6 hours.";
  const mailbox =
    edition === "personal"
      ? ""
      : "\n- **Gmail / Outlook**: read-only mailbox access; PDF invoices found in your email are imported into the extraction pipeline for your review.";
  const gate = edition === "personal" ? "" : ", Business plan and up";

  return `All integrations are on the [Integrations](/integrations) page (sidebar → Integrations${gate}). Click any tile to see what it does, the privacy details, and tailored connect steps. In short:
${accounting}${mailbox}
- **Slack / Microsoft Teams**: send your finance alerts and digests to a channel. Slack connects via sign-in; for Teams you paste an incoming webhook URL for the channel (created via the channel's Workflows/Connectors option).
- **Google Calendar**: creates calendar events for upcoming bills${edition === "personal" ? "" : " and invoice due dates"} — toggle it on in the tile's detail view after connecting.

Tiles marked **Needs setup** require an administrator to add the provider's credentials on the server — the tile's detail view lists the exact steps and environment variables. Disconnecting is always available in the tile's detail view and revokes access where the provider supports it.`;
}

const SHARED_AND_BUSINESS_TOPICS = (edition: Edition): EditionTopic[] => [
  {
    id: "getting-started",
    title: "Getting started",
    keywords: [
      "start", "begin", "new", "setup", "onboarding", "first", "empty", "demo",
      "tour", "overview", "welcome",
    ],
    content: gettingStartedContent(edition),
  },
  {
    id: "csv-import",
    title: "Importing a bank statement (CSV, Excel, PDF, MT940)",
    keywords: [
      "csv", "import", "upload", "statement", "file", "excel", "xls", "xlsx",
      "pdf", "mt940", "940", "sta", "bank statement", "mapping", "columns",
      "delimiter", "undo", "duplicate",
    ],
    content: importContent(edition),
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
    content: copilotContent(edition),
  },
  {
    id: "forecast",
    title: "Forecasts, runway and assumptions",
    keywords: [
      "forecast", "runway", "burn", "projection", "predict", "cash", "future",
      "assumption", "assumptions", "scenario", "growth",
    ],
    content: forecastContent(edition),
  },
  {
    id: "invoices",
    title: "Invoices: upload, extraction and linking",
    editions: ["business"],
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
      "kpi", "margin", "revenue", "profit", "trend", "breakdown",
    ],
    content: reportsContent(edition),
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
2. Configure **alerts**: large-transaction alerts (set your threshold amount), low-balance warnings (set a floor and how many days ahead the forecast should look)${
      edition === "personal" ? "" : ", and invoice due/overdue reminders"
    }.
3. Pick **channels** per type: in-app (always available), email, and browser push notifications (click enable and accept the browser prompt).
4. In-app notifications arrive at the **bell icon** in the header — open it to read or mark all read.

If email or push options appear disabled, that channel hasn't been configured on the server (administrator: set RESEND_API_KEY and EMAIL_FROM for email, VAPID keys for push).`,
  },
  {
    id: "team-invitations",
    title: "Inviting people and invite links",
    editions: ["business"],
    keywords: [
      "invite", "invitation", "invited", "team", "member", "members", "colleague",
      "partner", "accountant", "seat", "seats", "role", "permission", "workspace",
      "not received", "didn't arrive", "link",
    ],
    content: `Invite people in [Settings](/settings) → **Team** → *Invite member*: enter their email, pick a role (Admin, Member or Viewer), and send.

**The invite link is what actually gets them in.** After inviting, the dialog shows the link with a Copy button — send it to them however you like (chat, SMS, your own email). They open it, sign in or sign up **with the invited email address**, and join the workspace. The link is single-use and expires after 7 days.

**If no email arrives**, the dialog tells you why underneath the link:
- *Email delivery isn't set up* — an administrator has to set RESEND_API_KEY and EMAIL_FROM on the server. Share the link instead; nothing else is needed.
- *Resend only delivers to your own address until you verify a domain* — the email provider is in testing mode. Share the link, or verify a sending domain in Resend.

An invite link can't be shown twice (only a hashed copy is stored), so for an invitation already in the **Pending invitations** list use **Get link**: it issues a fresh link and the previous one stops working. **Revoke** cancels the invitation entirely.

Members plus pending invitations use up your plan's seats — see [Billing](/billing) if you run out.`,
  },
  {
    id: "bank-connections",
    title: "Connecting your bank",
    keywords: [
      "bank", "connect", "connection", "gocardless", "plaid", "tink", "sync",
      "account", "psd2", "open banking", "link", "institution", "automatic",
    ],
    content: bankConnectionContent(edition),
  },
  {
    id: "integrations-other",
    title:
      edition === "personal"
        ? "Messaging and calendar integrations"
        : "Accounting, email, messaging and calendar integrations",
    keywords: [
      "integration", "integrations", "quickbooks", "xero", "exact", "gmail",
      "outlook", "slack", "teams", "calendar", "google", "microsoft",
      "webhook", "accounting", "mailbox",
    ],
    content: integrationsContent(edition),
  },
  {
    id: "billing-plans",
    title: "Plans, billing and referrals",
    keywords: [
      "plan", "plans", "billing", "price", "pricing", "upgrade", "downgrade",
      "cancel", "trial", "stripe", "quota", "limit", "referral", "free",
      // In a Personal workspace "subscription" almost always means Netflix,
      // not the Stripe plan, so those words belong to the subscriptions topic.
      ...(edition === "personal"
        ? ["plus", "premium"]
        : ["subscription", "pay", "invoice history", "pro", "business", "enterprise"]),
    ],
    content: billingContent(edition),
  },
  {
    id: "workspaces",
    title: "Workspaces: business and personal",
    keywords: [
      "workspace", "workspaces", "switch", "second", "another", "separate",
      "business", "personal", "edition", "create workspace",
    ],
    content: `${BRAND.name} comes in two editions and one account can hold both:

- **${editionBranding("business").name}** — invoices, vendors and customers, executive reports and a shared team workspace.
- **${editionBranding("personal").name}** — budgets, savings goals and subscription tracking for your own money.

Use the **workspace switcher** at the top of the sidebar to move between workspaces you already own, or choose **Create workspace** in that menu. You can own only **one Personal** workspace. A company (Business) account cannot also open an individual workspace — and the reverse — unless you are on **Enterprise** or **Premium**, which unlock both editions. Each workspace has its own transactions, categories, bank connections and plan.

A workspace's kind is fixed when it's created. To have both, create the second one; to move data, export from one and import into the other.`,
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

/* ------------------------------------------------------------------ */
/* Personal-only topics                                                */
/* ------------------------------------------------------------------ */

function personalTopics(): EditionTopic[] {
  const goalsGate = planGate("personal", (limits) => limits.goalsEnabled);
  const subscriptionsGate = planGate(
    "personal",
    (limits) => limits.subscriptionInsightsEnabled
  );

  return [
    {
      id: "budgets",
      title: "Monthly budgets per category",
      editions: ["personal"],
      keywords: [
        "budget", "budgets", "budgeting", "limit", "cap", "overspend", "spend",
        "monthly", "rollover", "roll over", "envelope", "allowance", "target",
      ],
      content: `Budgets live on the [Budgets](/budgets) page (sidebar → Budgets), and every plan includes them:

1. Click **New budget**, pick a category and enter a monthly amount.
2. Turn on **rollover** if you want what you didn't spend (or overspent) to carry into next month — useful for lumpy categories like clothes or car maintenance, less so for rent.
3. Each budget shows a progress bar for the month: spent, remaining, and whether you're on track, close to the limit or over it. Rollover budgets show the carried amount separately from this month's allowance.
4. Use the month arrows to look at an earlier month; budgets you set apply from the month you created them onwards.
5. The [Dashboard](/dashboard) shows a compact version of the same thing, so overspending is visible without opening the page.

Spending is matched to a budget by category, so the numbers are only as good as your categorization — the [Categories](/categories) page and its auto-rules are what keep it accurate.`,
    },
    {
      id: "goals",
      title: "Savings goals",
      editions: ["personal"],
      keywords: [
        "goal", "goals", "saving", "savings", "save", "target", "holiday",
        "deposit", "emergency fund", "contribution", "contributions", "progress",
        "when will", "projected",
      ],
      content: `Savings goals are on the [Goals](/goals) page (sidebar → Goals) and need ${goalsGate}:

1. Click **New goal**: give it a name ("House deposit", "Japan trip"), a target amount, and optionally a target date and the account it's saved in.
2. Record what you put aside as **contributions** — each one has an amount and a date, and can be linked to a category or account so it lines up with your transactions.
3. Each goal shows how much is saved, what's left, a progress bar, and a **projected completion date** based on what you've actually been contributing per month.
4. If you set a target date, the goal tells you whether your current rate gets you there in time, and what monthly amount would.
5. The [Dashboard](/dashboard) shows your goals' combined progress.

A goal with no contributions yet can't be projected — the date appears once there's something to extrapolate from.`,
    },
    {
      id: "subscriptions",
      title: "Subscriptions and recurring payments",
      editions: ["personal"],
      keywords: [
        "subscription", "subscriptions", "recurring", "netflix", "spotify",
        "membership", "gym", "monthly payment", "cancel", "unused", "price rise",
        "price increase", "direct debit", "standing order",
      ],
      content: `The [Subscriptions](/subscriptions) page (sidebar → Subscriptions) needs ${subscriptionsGate} and is built from your transactions — nothing to set up:

1. Payments that repeat on a regular cadence are detected automatically (weekly, monthly, quarterly, yearly) and normalised to a **monthly cost**, so a €120/year subscription shows as €10/month next to a €9.99/month one.
2. The header totals what your subscriptions cost per month and per year — usually the most surprising number on the page.
3. **Upcoming charges** lists what's due next, with the expected date and amount.
4. **Price increased** flags a subscription whose latest charge is meaningfully higher than it used to be, with the old and new amounts.
5. **Possibly unused** flags one that's still charging but hasn't been touched in a while relative to its own cadence — worth a look before it renews again.
6. Cancelling happens with the provider, not here: the app is read-only and can never move or stop money. Once the charges stop, the subscription drops off the list by itself.

Detection needs a few repeats to be confident, so a subscription you started last month may not appear yet. If something is misdetected, recategorizing the transactions on the [Transactions](/transactions) page usually fixes the grouping.`,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

/** Help articles for an edition, with the other edition's surfaces removed. */
export function getHelpTopics(edition: Edition = DEFAULT_EDITION): HelpTopic[] {
  const all = [...SHARED_AND_BUSINESS_TOPICS(edition), ...personalTopics()];
  return all
    .filter((topic) => !topic.editions || topic.editions.includes(edition))
    .map((topic) => ({
      id: topic.id,
      title: topic.title,
      keywords: topic.keywords,
      content: topic.content,
    }));
}
