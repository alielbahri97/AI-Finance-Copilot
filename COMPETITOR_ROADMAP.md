# Competitor roadmap — researched 2026-08-05

What competitor products offer, which of their features Ballast should adopt, and a
ready-to-paste implementation prompt for each. Research covered the personal-finance
market (Monarch Money, YNAB, Copilot Money, Rocket Money, Quicken Simplifi, PocketGuard,
Emma, Cleo) and the SMB market (QuickBooks, Xero, Agicap, Ramp, Brex, Digits, Causal,
Finmark, Pennylane), with emphasis on AI features since AI is Ballast's differentiator.

> **Do not implement from this file blindly.** Each prompt names the real files to
> extend, but the implementing agent must still read them first. Two repo-wide
> constraints apply to every prompt: (1) migrations are **hand-written SQL** in
> `prisma/migrations/NNNN_name/migration.sql` and cannot be applied from the dev
> machine — produce the SQL bundle for Supabase (see `HANDOFF.md` §6, `ops/migrations-bundle/`),
> never run `prisma migrate dev`; (2) before any push, `npm test`, `npm run lint`,
> `npx tsc --noEmit` and `npm run build` must all pass.

---

## 1. Competitor landscape

### Personal finance

| Competitor | Price | Signature features | AI angle |
| --- | --- | --- | --- |
| **Monarch Money** | $99–199/yr | **Net worth tracking** (accounts + property + vehicles + crypto), flexible budgets w/ rollover, goals, **household collaboration**, weekly recaps | 2026 AI assistant grounded in the user's own data; widely called the first AI feature that "survives daily use" |
| **YNAB** | $109/yr | Strict zero-based budgeting methodology, family sharing (6 people) | Minimal — deliberately methodology-first |
| **Copilot Money** | $95/yr | Apple-only polish, **live investment tracking**, subscription detection | Best-in-class **ML auto-categorization** (~93% first-pass, learns from corrections); proactive "Your Money Assistant" (2026) |
| **Rocket Money** | free + $7–14/mo | Subscription detection + **cancellation concierge**, **bill negotiation** (35–60% success fee), automated savings | Mostly human-ops behind an app front end |
| **Quicken Simplifi** | $6.99/mo | Cheap all-rounder: budgets, watchlists, savings goals, subscription tracking | Light |
| **PocketGuard** | $12.99/mo | **"In My Pocket" safe-to-spend number**, **debt payoff planner** (avalanche/snowball), "Pace" mid-month overspend warning | Light |
| **Emma** | freemium tiers | Subscription audit ("unused service" flags), multi-account dashboard, rent reporting | Subscription detection + cancellation recommendations |
| **Cleo** | freemium | Chat-first money coach, gamified savings, cash advances | **Autopilot** (2026): agentic AI that *acts* — moves money to savings, sets merchant spend limits, plans goals from a conversation; voice + memory |

### SMB / business finance

| Competitor | Market | Signature features | AI angle |
| --- | --- | --- | --- |
| **QuickBooks** | SMB accounting | Full accounting, payroll, payments | **Intuit Intelligence** agent suite: Payments Agent drafts personalized invoice reminders + late-fee policies ("paid 45% faster, 5 days sooner"), Accounting Agent bulk-categorizes bank feeds with confidence scores, proactive **Business Feed** on the home page |
| **Xero** | SMB accounting | Accounting, 30/60/180-day cash forecasts by plan | **JAX** conversational superagent: ask-anything over your data + external info, drafts invoices, "Cash Flow Actions" beta suggests delaying non-critical bills |
| **Agicap** | Mid-market treasury | 13-week rolling forecasts, **named scenarios cloned & compared side-by-side**, variance analysis (plan vs actual), DSO-by-client refinement, multi-entity consolidation | AI-assisted categorization and forecasting |
| **Ramp / Brex** | Spend management | Corporate cards, receipt matching, procurement | **Policy Agent** (RAG over the written expense policy, approve/reject/review per transaction), **savings insights that surface duplicate subscriptions & flag vendor price creep** |
| **Digits** | AI bookkeeping | Autonomous General Ledger: auto-books ~95% of entries, review "Inbox" for low-confidence outliers, live dashboards | AI-native categorization (claims to beat GPT-4o by 54%), anomaly flagging before human review |
| **Causal** | FP&A | Formula-based modelling, probabilistic forecasts, investor dashboards | Scenario modelling |
| **Finmark** | FP&A | Discontinued — absorbed into BILL for basic cash-flow visibility | — |
| **Pennylane** | FR/EU accounting | Accounting + **invoice creation with payment links**, e-invoicing (Factur-X, PDP-certified), payment reminders, IBAN-mismatch fraud alerts | ComptAssistant chatbot; user-built custom AI agents |

### Patterns worth internalizing

1. **AI categorization is table stakes in 2026.** Copilot Money, QuickBooks, Digits and
   Monarch all learn from corrections. Ballast's substring `CategoryRule` matching is the
   single most visible gap against every competitor in both markets.
2. **AI is moving from answering to acting.** Cleo Autopilot, Intuit's agents, Ramp's
   Policy Agent. Ballast's copilot is read-only today.
3. **Proactive beats reactive.** Intuit's Business Feed, Copilot's Money Assistant,
   Monarch's weekly recaps: surface insights on the dashboard, don't wait to be asked.
   Ballast has the ingredients (digests, anomaly detection) but only ships them as
   notifications.
4. **Getting paid faster is the #1 SMB pain.** QuickBooks' single most-marketed AI
   feature is customer-facing invoice reminders. Ballast reminds *the owner*, never the
   customer.

### Evaluated and rejected

| Feature | Who | Why not |
| --- | --- | --- |
| Bill negotiation / cancellation concierge | Rocket Money | A human-ops service, not software; success-fee billing model alien to Ballast |
| Credit score monitoring | Rocket Money, PocketGuard | US bureau APIs; Ballast is EUR/EU-centric |
| Corporate cards, bill pay, money movement | Ramp, Brex, Pennylane, Cleo | Requires payment-institution licensing; enormous regulatory scope |
| Full double-entry general ledger | Digits, Pennylane | Ballast's strategy is to *integrate* with QuickBooks/Xero/Exact, not replace them |
| PDP-certified e-invoicing (Factur-X) | Pennylane | Country-specific certification program; revisit only if invoice *creation* (P2) ships and FR demand appears |
| Live brokerage/investment sync | Copilot Money, Monarch | Data-provider heavy (holdings-level feeds); manual balances inside Net Worth (P0-2) covers 80% of the value |
| Gamification / AI personality | Cleo | Tone, not architecture; can be a copilot prompt tweak someday |

---

## 2. Recommended features

Priorities: **P0** = clear gap, high value, ship first. **P1** = strong differentiator or
cheap win. **P2** = valuable but large or dependent. Effort: S ≈ days, M ≈ 1–2 weeks,
L ≈ several weeks.

| # | Feature | Priority | Edition | Effort | Competitors |
| --- | --- | --- | --- | --- | --- |
| 1 | AI transaction categorization (learns from corrections) | P0 | Both | M | Copilot Money, QuickBooks, Digits, Monarch |
| 2 | Net worth tracking | P0 | Personal | M | Monarch (its best feature), Copilot, Emma |
| 3 | Named forecast scenarios with comparison | P0 | Both | M | Agicap, Causal, Xero |
| 4 | AI dunning — customer-facing invoice reminders | P0 | Business | M | QuickBooks Payments Agent, Pennylane, Digits |
| 5 | Safe-to-Spend daily number | P1 | Personal | S | PocketGuard, Cleo |
| 6 | Proactive AI insights feed on the dashboard | P1 | Both | M | Intuit Business Feed, Copilot Money, Monarch |
| 7 | Household sharing (partner seat) | P1 | Personal | S–M | Monarch, YNAB, Copilot Family |
| 8 | Business recurring-spend audit | P1 | Business | S | Ramp savings insights, Emma (concept) |
| 9 | Agentic copilot actions (tool calling) | P2 | Both | L | Cleo Autopilot, Xero JAX, Intuit agents |
| 10 | Business budgets & variance analysis | P2 | Business | M | Agicap, Causal, QuickBooks |
| 11 | Debt payoff planner | P2 | Personal | M | PocketGuard, YNAB |
| 12 | Invoice creation & sending | P2 | Business | L | Pennylane, QuickBooks, Xero, Digits |

---

### P0-1 · AI transaction categorization

- **What**: On CSV import and bank sync, transactions that no `CategoryRule` matches get
  batch-categorized by the AI (existing category set only, with per-transaction
  confidence). Low-confidence ones stay uncategorized. When a user corrects a category,
  the correction is remembered and offered as a one-click rule.
- **Who has it**: Copilot Money (~93% first-pass), QuickBooks Accounting Agent
  (confidence-scored bulk posting), Digits (95% auto-booked), Monarch.
- **Why it fits**: Ballast already has the category system, rules engine, import
  pipeline and an AI provider abstraction — this is the highest-leverage missing AI
  feature and it improves everything downstream (budgets, forecasts, reports, copilot).
- **Edition / gating**: Both. Counts against a new monthly limit in `PlanLimits`
  (generous on paid, small taste on Free).
- **Hooks**: `src/lib/categories.ts` (rule matching lives here), import commit at
  `src/app/api/import/commit/route.ts`, bank sync via `src/lib/integrations/bank-import.ts`,
  AI clients from `src/lib/ai/`, limits in `src/lib/billing/plans.ts` +
  `src/lib/billing/entitlements.ts`.

**Implementation prompt**

```text
In the Ballast repo (ai-finance-copilot), add AI-powered transaction categorization to
both editions. Read README.md "Architecture notes" and HANDOFF.md first — note that DB
migrations are hand-written SQL in prisma/migrations/NNNN_name/migration.sql applied by
pasting a bundle into Supabase (see HANDOFF.md §6); never use prisma migrate dev.

Current state: categories are per-workspace rows (prisma/schema.prisma, model Category)
and categorization is purely rule-based — CategoryRule substring patterns matched in
src/lib/categories.ts during CSV import (src/app/api/import/commit/route.ts) and bank
sync (src/lib/integrations/bank-import.ts).

Build:
1. src/lib/ai/categorize.ts — a batch categorizer: given up to ~50 uncategorized
   transactions (date, description, counterparty, amount, type) and the workspace's
   category list, ask the AI (use getAiClient() from src/lib/ai and the strict-JSON
   prompt style used by src/lib/invoices/extraction-core.ts) to return
   {transactionIndex, categoryId, confidence 0..1} per row. Validate with Zod; only
   apply suggestions with confidence >= 0.8; ignore hallucinated category ids. One
   retry on invalid JSON, then give up gracefully (transactions stay uncategorized —
   AI failure must never fail an import).
2. Wire it into the import commit route and bank-import sync AFTER rule matching, only
   for rows no rule matched. Run it fire-and-forget-safe: a slow/failed AI call must
   not block the import response; either await with a hard timeout or apply in a
   follow-up pass. Track how many rows were AI-categorized on the ImportBatch response
   so the UI can say "34 auto-categorized by AI".
3. Learning from corrections: when a user changes a transaction's category inline
   (src/app/api/transactions/[id]/route.ts and the bulk route), if that transaction has
   a counterparty/description that appears on other transactions, return a hint in the
   response so the UI (src/components/transactions/) can offer "Always categorize
   'SHELL' as Fuel" — one click creates a CategoryRule via the existing
   src/app/api/rules/ endpoint. Rules always take precedence over AI on future imports.
4. Gating: add aiCategorizationPerMonth (number|null) to PlanLimits in
   src/lib/billing/plans.ts — Free 100 rows/month for both editions, all paid tiers
   null (unlimited, the AI cost per row is tiny). Enforce via
   src/lib/billing/entitlements.ts UsageRecord counters like the existing
   aiMessagesPerMonth; when exhausted, skip AI silently and note it in the import
   summary with an upgrade hint.
5. A workspace-level opt-out toggle in Settings (some users won't want AI touching
   their data) — default on. Store on the Workspace or NotificationPreference-style
   settings, whichever the settings page already persists.
6. Tests in tests/ (Vitest): prompt-output parsing/validation incl. malformed JSON and
   invalid category ids; the precedence rule (CategoryRule beats AI); the quota math.
   Mock the AI client — the suite must run without keys.

Edge cases: empty category list (skip AI), workspaces with 100+ categories (cap the
list in the prompt to the 60 most-used), transfers between own accounts (respect the
existing TransactionType), and idempotence on re-import (dedupe already handles it —
don't re-categorize rows that already have a category).
```

---

### P0-2 · Net worth tracking (Personal)

- **What**: A `/net-worth` page: assets and liabilities in one place — synced bank
  balances (already exist via `BankAccount`) plus manual entries (property, vehicle,
  investments, crypto, loans, mortgages) with a valuation history and a net-worth-over-
  time chart.
- **Who has it**: Monarch (reviewers call it "the best feature"), Copilot Money, Emma,
  Rocket Money (basic). It is *the* reason people pay $99/yr for Monarch.
- **Why it fits**: Ballast Personal today only sees flows (transactions); stock (what
  you own/owe) is the natural next layer and feeds the copilot with far richer context
  ("what's my net worth trend?"). Manual valuations avoid any new data-provider
  dependency.
- **Edition / gating**: Personal. Free: synced accounts only; Plus/Premium: manual
  assets/liabilities + history.
- **Hooks**: new Prisma models; page in `src/app/(dashboard)/`; sidebar +
  edition gating in `src/lib/workspace/editions.ts`; snapshot in `src/lib/ai/context.ts`.

**Implementation prompt**

```text
In the Ballast repo (ai-finance-copilot), add net worth tracking to the Personal
edition. Read README.md ("The two editions") and src/lib/workspace/editions.ts to see
how personal-only features are gated (budgets/goals/subscriptions are the model to
copy: page 404s in a business workspace, sidebar filters itself, API routes reject).
Migrations are hand-written SQL (HANDOFF.md §6) — write prisma/migrations SQL +
schema.prisma changes, don't run prisma migrate dev.

Build:
1. Prisma models (workspace-scoped like everything else in prisma/schema.prisma):
   - Asset { id, workspaceId, name, kind enum (PROPERTY | VEHICLE | INVESTMENT |
     CRYPTO | CASH | OTHER_ASSET | LOAN | MORTGAGE | CREDIT_LINE | OTHER_LIABILITY),
     isLiability derived from kind or stored, currency, createdAt }
   - AssetValuation { id, assetId, value Decimal, asOf DateTime } — append-only
     valuation history; latest valuation is the current value.
2. src/lib/personal/net-worth.ts (+ net-worth-data.ts for queries, mirroring the
   budgets.ts / budgets-data.ts split in src/lib/personal/): compute current net worth
   = sum of latest asset valuations − liabilities + current bank/cash balance (reuse
   the cash series logic in src/lib/finance/cash-data.ts and BankAccount balances,
   respecting the existing includeInTotals toggle), and a monthly net-worth history
   series combining valuation history with the cash-balance history.
3. Pages & API: src/app/(dashboard)/net-worth/page.tsx with a net-worth-over-time area
   chart (Recharts, like existing dashboard charts), an assets table and a liabilities
   table with add/edit/delete and "update value" (creates a new AssetValuation);
   CRUD routes under src/app/api/net-worth/ following the pattern of
   src/app/api/goals/. All routes resolve requireWorkspace() and must reject business
   workspaces exactly like src/app/api/budgets/ does. Add the nav item to the sidebar
   (personal edition only) and a small net-worth card on the personal dashboard.
4. Copilot: extend buildFinancialSnapshot / renderSnapshot in src/lib/ai/context.ts
   with a compact net-worth section (current total, 3 largest assets, total
   liabilities, 6-month trend) so "how is my net worth developing?" gets a grounded
   answer. Keep it token-efficient like the existing sections.
5. Gating: add netWorthEnabled to PlanLimits in src/lib/billing/plans.ts. Personal
   Free: false for manual assets (the page still shows synced bank balances with an
   upgrade hint); Plus & Premium: true. Business tiers: the page doesn't exist for
   that edition at all (edition gate, not plan gate).
6. Tests: net-worth math (mixed currencies use the workspace's preferred currency —
   see how reports handle currency in src/lib/reports/), valuation history series
   (months with no valuation carry the last known value forward), and edition/plan
   gating following the style of the existing edition gating tests in tests/.

Edge cases: an asset with zero valuations (treat as 0, prompt for a value), deleting
an asset cascades valuations, liabilities entered as positive numbers but subtracted,
and no double-counting when a synced bank account balance would also be entered
manually (UI copy should steer users to manual entries only for what isn't synced).
```

---

### P0-3 · Named forecast scenarios with comparison

- **What**: Group what-if assumptions into named scenarios ("Base case", "Hire in Q4",
  "Lose top client"), switch between them, and overlay two or three on the forecast
  chart. Today Ballast has one flat assumption list with on/off toggles.
- **Who has it**: Agicap (clone-and-compare scenarios is its headline feature), Causal,
  Xero (Cash Flow Actions). This is the standard mental model for cash planning.
- **Why it fits**: `computeForecast(inputs)` in `src/lib/finance/forecast.ts` is already
  a pure function — running it once per scenario is trivial. The work is data model + UI,
  not engine.
- **Edition / gating**: Both (CFO framing for Business, "model a raise / a move" for
  Personal Premium). Reuses the existing `assumptionsEnabled` gate plus a per-plan
  scenario cap.
- **Hooks**: `Assumption` model in `prisma/schema.prisma`,
  `src/app/api/assumptions/route.ts`, `src/app/api/forecast/route.ts`,
  `src/components/forecast/`, `src/app/api/forecast/explain/route.ts`.

**Implementation prompt**

```text
In the Ballast repo (ai-finance-copilot), add named forecast scenarios. Read
src/lib/finance/forecast.ts (computeForecast is pure — inputs in, ForecastResult out),
the Assumption model in prisma/schema.prisma, src/app/api/assumptions/route.ts,
src/app/api/forecast/route.ts and the UI in src/components/forecast/. Migrations are
hand-written SQL (HANDOFF.md §6).

Build:
1. Prisma: new Scenario model { id, workspaceId, name, isDefault boolean, createdAt }
   and a nullable scenarioId FK on Assumption (ON DELETE CASCADE). NULL scenarioId =
   the default/base scenario, so every existing assumption keeps working with zero
   data migration — this back-compat is a hard requirement.
2. API: CRUD at src/app/api/scenarios/ (create, rename, delete, duplicate — duplicate
   copies all of a scenario's assumptions). Extend GET /api/forecast to accept
   ?scenarioId= (default scenario when absent) and a compare mode
   ?compare=id1,id2 (max 3) that returns one ForecastResult per scenario — just call
   computeForecast once per scenario with that scenario's enabled assumptions; the
   engine needs no changes. Keep every query workspace-scoped via requireWorkspace()
   like the existing routes.
3. UI on /forecast (src/app/(dashboard)/forecast/ + src/components/forecast/): a
   scenario switcher (tabs or select) above the assumptions manager; assumptions
   created while a scenario is active belong to it; a "Compare" toggle that overlays
   the projected-balance lines of the selected scenarios on the existing Recharts
   chart in distinct colors with a legend, and a small delta table (cash at 30/90/365
   days and runway, per scenario). Keep the confidence band only for the primary
   scenario to avoid visual noise.
4. AI explanation: extend src/app/api/forecast/explain/route.ts so that when comparing,
   the prompt includes both scenarios' metrics and asks the model to explain the
   difference and its drivers ("Scenario B runs out of cash 2 months earlier because…").
5. Gating: scenarios sit behind the existing assumptionsEnabled limit in
   src/lib/billing/plans.ts; additionally add maxScenarios (number|null): Business
   edition Pro = 3, Business = null; Personal Premium = 3 (Plus/Free have
   assumptionsEnabled false already and see a locked teaser). Enforce at the create
   route with the friendly 402 + upgrade-hint pattern used elsewhere (see
   src/lib/billing/entitlements.ts).
6. Tests: scenario-scoped assumption filtering feeding computeForecast, duplicate
   copies assumptions, NULL-scenario back-compat, and the plan cap. Follow the style
   of tests/forecast.test.ts.

Edge cases: deleting the active scenario falls back to default; deleting a scenario
deletes its assumptions (confirm dialog says so); "duplicate default" clones the
NULL-scenario assumptions into a new scenario; compare with 0 extra scenarios is just
the normal view.
```

---

### P0-4 · AI dunning — customer-facing invoice reminders (Business)

- **What**: For overdue/due-soon **receivable** invoices, draft a personalized,
  professional payment-reminder email with AI (tone escalating with lateness, invoice
  details included), let the user review/edit, then send it to the customer via the
  existing Resend channel. Optionally auto-send on a schedule the user approves per
  customer.
- **Who has it**: QuickBooks Payments Agent (its most-marketed AI feature: "paid 45%
  faster, 5 days sooner"), Pennylane, Digits AI Invoicing. Ballast currently reminds
  only the workspace owner (`src/lib/invoices/reminders.ts`).
- **Why it fits**: Getting paid faster is the most concrete ROI story Ballast Business
  can tell, and every ingredient exists: invoice statuses and due dates, AR direction,
  Resend email infra, AI drafting, an hourly cron.
- **Edition / gating**: Business edition, Pro+. Requires email configured
  (`isEmailConfigured()` — degrade to copy-paste drafts when not).
- **Hooks**: `src/lib/invoices/reminders.ts`, `src/lib/notifications/email.ts`
  (`sendEmail()`), `Invoice` model, `src/app/api/cron/notifications/route.ts`,
  invoice detail UI in `src/components/invoices/`.

**Implementation prompt**

```text
In the Ballast repo (ai-finance-copilot), add customer-facing AI payment reminders
(dunning) for receivable invoices in the Business edition. Read
src/lib/invoices/reminders.ts (due-soon/overdue queries — currently used to remind the
OWNER, not the customer), the Invoice model in prisma/schema.prisma (note the
payable/receivable direction enum InvoiceDirection), sendEmail() in
src/lib/notifications/email.ts (returns sent | not_configured | failed — honest
failure reporting is a house style), and the cron in
src/app/api/cron/notifications/route.ts. Migrations are hand-written SQL (HANDOFF.md §6).

Build:
1. Prisma: the Invoice model stores the vendor/counterparty name but check whether it
   has a contact email — if not, add customerEmail (nullable) plus a
   ReminderLog model { id, invoiceId, sentAt, toEmail, subject, body, kind enum
   (DUE_SOON | OVERDUE_1 | OVERDUE_2 | FINAL), sentBy userId nullable (null = auto) }
   so the history is auditable and escalation steps are never repeated.
2. src/lib/invoices/dunning.ts: given a receivable invoice (direction RECEIVABLE,
   status UNPAID, has customerEmail), pick the escalation step from days
   relative to due date (due in ≤7 days → DUE_SOON; 1–14 late → OVERDUE_1; 15–30 →
   OVERDUE_2; >30 → FINAL, each sent at most once per invoice via ReminderLog) and
   draft subject+body with the AI (getAiClient() from src/lib/ai): professional tone
   escalating with lateness, includes invoice number, amount, currency, due date, days
   overdue; the workspace/company name comes from the profile. Deterministic template
   fallback when no AI key is configured (see how digests do this in
   src/lib/notifications/summaries.ts). Never let the model invent payment details —
   the prompt must only reference data passed in.
3. Manual flow first: on the invoice detail page (src/components/invoices/, page under
   src/app/(dashboard)/invoices/) add a "Remind customer" action for unpaid
   receivables: opens a dialog with the AI draft, editable subject/body and recipient,
   sends via sendEmail(), records a ReminderLog, and surfaces the honest send status
   (sent / not configured / failed) exactly like the team-invite dialog does. If email
   isn't configured, still show the draft with a copy button.
4. Auto mode (opt-in per workspace, default OFF): a toggle in Settings ("Automatically
   remind customers of overdue invoices"). The hourly notifications cron evaluates
   eligible invoices idempotently (claim-before-send like NotificationPreference
   last-sent timestamps) and sends the next unsent escalation step. Every auto-send
   also creates an in-app notification to the owner ("Reminder sent to ACME for
   INV-0042") via src/lib/notifications/dispatch.ts.
5. Gating: Business edition only (personal workspaces have no invoices — the edition
   gate already handles this, verify). Plan-gate behind a new
   dunningEnabled flag in PlanLimits (src/lib/billing/plans.ts): Free false, Pro+
   true. Enforce in the API route with the 402 upgrade-hint pattern.
6. Tests: escalation-step selection (boundaries at 0/1/14/15/30/31 days), never-repeat
   per step, draft fallback without AI key, and that payable invoices or invoices
   without customerEmail are never eligible. Mock AI + email.

Edge cases: invoice marked paid between draft and send (re-check status at send time);
currency formatting per invoice currency; recipient edited to an empty string
(validate with Zod); cron burst after downtime must not send two escalation steps in
one run (send at most one step per invoice per run).
```

---

### P1-5 · Safe-to-Spend number (Personal)

- **What**: One number on the personal dashboard: what you can safely spend before
  month-end — current balance − upcoming recurring bills (forecast engine already knows
  them) − remaining budget commitments − a configurable savings buffer/goal
  contributions. PocketGuard built an entire product around this ("In My Pocket").
- **Why it fits**: Pure derivation from data Ballast already computes (`ForecastResult.
  metrics` upcoming bills, budget remainders in `src/lib/personal/budgets.ts`). No new
  data, no migration (or one column for the buffer). High retention value: it's the
  question every user has daily.
- **Edition / gating**: Personal, all plans (it's the hook that shows the product
  understands you).
- **Effort**: S.

**Implementation prompt**

```text
In the Ballast repo (ai-finance-copilot), add a "Safe to Spend" number to the Personal
edition dashboard. No new data sources — derive it entirely from existing engines.
Read src/lib/finance/forecast.ts (UpcomingBill + ForecastMetrics), the budget math in
src/lib/personal/budgets.ts / budgets-data.ts, and the personal dashboard composition
under src/app/(dashboard)/dashboard/.

Build:
1. src/lib/personal/safe-to-spend.ts: safeToSpend = current cash balance
   − recurring bills still due before month-end (from the forecast engine's scheduled
   recurring expenses within the current month)
   − max(0, remaining committed budget spend: for each budgeted category, remaining =
     max(0, limit − spentSoFar), summed — but don't double-count categories whose
     spend is dominated by a recurring bill already subtracted; document the chosen
     de-dup heuristic: subtract a recurring item only when its category is unbudgeted,
     otherwise let the budget line carry it)
   − a user-configurable monthly savings buffer (new nullable Decimal column, e.g.
     Profile.safetyBufferMonthly or a workspace setting — pick the place Settings
     already persists per-workspace preferences; hand-written SQL migration per
     HANDOFF.md §6). Clamp at ≥ €0 display with a "you're stretched" state when
   negative, showing the breakdown.
2. Dashboard card (src/components/dashboard/): the number, a one-line breakdown
   ("€2,140 balance − €480 bills − €610 budgets − €200 buffer"), and a sparkline of
   days remaining in the month. Personal edition only — follow how existing
   personal-only widgets (budgets/subscriptions) are conditionally rendered.
3. Copilot grounding: add safeToSpend (value + components) to the personal sections of
   buildFinancialSnapshot/renderSnapshot in src/lib/ai/context.ts so "can I afford
   €300 sneakers?" is answered from the real number — this matches the money-coach
   framing in src/lib/ai/prompts.ts.
4. Settings: a small "Safety buffer" field in the personal settings page.
5. Tests: the derivation incl. the de-dup heuristic, negative clamp, month boundaries
   (bill due today counts, bill due next month doesn't), and no-budget/no-bill users
   (then it's just balance − buffer).

All plans get it (no gating) — it's a retention feature, not an upsell.
```

---

### P1-6 · Proactive AI insights feed

- **What**: A dashboard "Insights" panel of individually dismissible cards generated
  server-side: spending in category X up 40% vs 3-month average, duplicate charge
  detected, subscription price increase, unusually large expense, low-runway warning,
  budget about to blow, invoice unpaid 30 days. AI writes the one-liner; deterministic
  detectors decide *what* to surface (no hallucinated facts).
- **Who has it**: Intuit's Business Feed, Copilot Money's "Your Money Assistant",
  Monarch weekly recaps. All 2026 flagship features.
- **Why it fits**: The detectors mostly exist (z-score anomalies in
  `src/lib/ai/context.ts`, price-increase flags in `src/lib/personal/subscriptions.ts`,
  low-cash logic in `src/lib/notifications/`) — they're just trapped in the copilot
  snapshot and notification e-mails. This puts Ballast's differentiator on the front
  page.
- **Edition / gating**: Both editions, all plans; AI-phrased copy on paid plans,
  deterministic phrasing on Free.
- **Effort**: M.

**Implementation prompt**

```text
In the Ballast repo (ai-finance-copilot), add a proactive Insights feed to the
dashboard for both editions. Principle: deterministic detectors decide WHAT to
surface, AI only phrases it — insights must never contain facts the detector didn't
compute. Read src/lib/ai/context.ts (z-score unusual transactions already exist),
src/lib/personal/subscriptions.ts (price-increase and looks-unused flags),
src/lib/notifications/ (low-cash + large-transaction logic, cron patterns), and the
dashboard composition in src/app/(dashboard)/dashboard/ +
src/components/dashboard/. Migrations are hand-written SQL (HANDOFF.md §6).

Build:
1. Prisma: Insight model { id, workspaceId, kind enum, title, body, severity
   (INFO | WARN | ALERT), dataJson, dedupeKey unique per workspace, createdAt,
   dismissedAt nullable }. dedupeKey (e.g. "price-increase:netflix:2026-08") prevents
   re-surfacing the same insight.
2. src/lib/insights/detect.ts — pure detector functions returning candidate insights
   from data the app already computes. Start with: category spend vs trailing 3-month
   average (±35%+), duplicate charge (same counterparty+amount within 3 days),
   subscription price increase & looks-unused (reuse src/lib/personal/subscriptions.ts,
   personal edition), projected low cash within 30 days (reuse the forecast engine),
   budget ≥90% consumed with >5 days left (personal), receivable invoice unpaid >30
   days and AR concentration (>40% of AR on one customer) for business. Each detector
   is independently unit-testable.
3. src/lib/insights/generate.ts — runs detectors, dedupes against existing dedupeKeys,
   asks the AI to phrase title+body for each new insight from the detector's dataJson
   only (batch them in one call; deterministic template fallback per the pattern in
   src/lib/notifications/summaries.ts), and persists. Wire it into the hourly cron
   (src/app/api/cron/notifications/route.ts) with the same idempotent claim-first
   style, plus a lazy on-dashboard-load refresh when the newest insight is older than
   24h (so free users without cron still get them locally / self-hosted).
4. UI: an "Insights" panel on both dashboards (business + personal variants) showing
   the newest ~5 undismissed insights as cards with severity accents, a dismiss (x)
   and a "Ask the copilot about this" link that deep-links to /copilot with the
   insight's question pre-filled (check how suggested questions are passed in
   src/lib/ai/suggestions.ts / the copilot page — reuse that mechanism).
5. Gating: all plans get detectors; AI phrasing only when the workspace's plan has AI
   quota left (reuse aiMessagesPerMonth accounting? No — phrasing must NOT consume the
   user's copilot quota; add it free-of-quota but use the deterministic fallback on
   Free so AI cost stays on paid tiers).
6. Tests: each detector on fixture transactions (style: tests/subscription tests),
   dedupeKey stability, dismiss behavior, and that generate.ts never emits an insight
   whose numbers aren't in dataJson.

Edge cases: brand-new workspaces with <1 month of data (suppress trend detectors —
they'd be noise), workspaces with no AI key configured (fallback copy), and cron +
lazy-refresh racing (unique dedupeKey constraint resolves it — handle the P2002
unique-violation gracefully).
```

---

### P1-7 · Household sharing (Personal)

- **What**: Let a Personal **Premium** workspace invite one partner. Monarch's
  collaboration mode is a top-3 cited reason to choose it; YNAB and Copilot both ship
  family plans. Couples are the highest-LTV personal-finance segment.
- **Why it fits**: This is Ballast's cheapest big win — the *entire* teams
  infrastructure (members, roles, hashed invitations, workspace switcher, seat limits,
  audit log) already exists and is merely switched off for the personal edition
  (`manage_members` stripped, seats fixed at 1). Re-enable a constrained version.
- **Edition / gating**: Personal Premium only (2 seats). A concrete, marketable reason
  to upgrade from Plus.
- **Effort**: S–M (config + UI copy + tests; the machinery exists).

**Implementation prompt**

```text
In the Ballast repo (ai-finance-copilot), enable partner sharing for the Personal
Premium plan. Read README.md "Teams, roles & permissions" and the edition matrix in
src/lib/workspace/editions.ts — today the personal edition strips the manage_members
permission, hides the Team UI and fixes seats at 1. The full invitation machinery
(src/lib/workspace/invitations.ts, team.ts, permissions.ts, the /invite/[token] flow
and Team settings UI) already exists for Business; reuse it, don't rebuild it.

Build:
1. Edition matrix: allow manage_members in the personal edition again, but ONLY
   surfaced when the plan grants >1 seat. Update seats in src/lib/billing/plans.ts:
   Personal Free 1, Plus 1, Premium 2. The existing seat enforcement (invitations
   count against seats) then does the work — verify the invite route checks the seat
   limit and returns the friendly 402 upgrade prompt for Plus/Free.
2. Roles: personal workspaces need no role picker — a partner joins as ADMIN
   (equal partners is the product intent; Monarch works this way). Hard-code the role
   in the personal invite flow and hide role selection + granular permission overrides
   in the personal UI variant. Owner remains owner.
3. UI: in personal Settings, a "Household" section (rename via src/lib/branding.ts
   per-edition copy — do NOT hardcode strings; branding.ts is the single source for
   naming) with the invite-by-email + copyable-link flow reused from the Business team
   settings, showing at most: the partner, the pending invite, remove/revoke. For
   Plus/Free, show the section as a locked teaser ("Premium lets you manage money
   together").
4. Safety: audit-log entries already record member changes — verify they work in a
   personal workspace. Billing stays with the workspace owner (the partner must NOT
   see /billing: keep view_billing out of the partner's effective permissions in the
   personal edition matrix).
5. Tests: extend the edition-gating tests in tests/ — personal Premium can invite to
   exactly 2 seats total, Plus cannot invite at all, the partner's effective
   permissions include data editing + copilot but exclude view_billing and
   manage_members, and a business workspace is unaffected.

Edge cases: downgrade Premium → Plus with a partner present (follow the existing
over-seat-limit behavior on Business downgrades — check what happens today and mirror
it; if nothing is defined, block removal-requiring downgrades with a clear message
listing who must be removed first); invitation to an email that owns a business
workspace (fine — accounts can belong to multiple workspaces by design).
```

---

### P1-8 · Business recurring-spend audit

- **What**: A "Recurring spend" page for Business: every recurring vendor charge
  (SaaS, rent, insurance, utilities) with monthly cost, next charge, **price-increase
  flags** and **duplicate/overlapping-vendor flags** (two project-management tools, two
  storage providers). Ramp markets exactly this as "AI savings insights".
- **Why it fits**: The engine is already written — `src/lib/finance/recurrence.ts`
  powers Personal subscriptions (`src/lib/personal/subscriptions.ts`) and the forecast.
  This is largely re-surfacing an existing capability in the Business edition with
  business framing.
- **Edition / gating**: Business Pro+.
- **Effort**: S.

**Implementation prompt**

```text
In the Ballast repo (ai-finance-copilot), add a "Recurring spend" audit page to the
Business edition. The detection engine already exists: src/lib/finance/recurrence.ts
groups transactions by normalized merchant with stable amounts/intervals, and
src/lib/personal/subscriptions.ts + subscriptions-data.ts build the Personal
"Subscriptions" feature on top of it (monthly cost totals, next charge date,
price-increase flags, looks-unused flags). Read those plus the personal page at
src/app/(dashboard)/subscriptions/ before writing anything.

Build:
1. Refactor for reuse: extract the provider-agnostic parts of
   src/lib/personal/subscriptions.ts (recurring-charge summarization, price-increase
   detection, next-charge projection) into a shared module (e.g.
   src/lib/finance/recurring-spend.ts) consumed by BOTH the personal subscriptions
   feature and the new business page. Do not change personal behavior — the existing
   tests must keep passing unchanged.
2. Business additions in the shared module or a business-specific wrapper:
   - annualized cost per vendor and share of total expenses;
   - price-creep flag (charge grew >5% vs the previous charge, same as personal);
   - overlap candidates: use the AI (getAiClient() from src/lib/ai, batch, strict
     JSON, deterministic skip when no key) to label each recurring vendor with a
     coarse tool category (e.g. "cloud storage", "project management", "accounting")
     and flag categories with 2+ active vendors as potential overlap. Facts (amounts,
     vendors) come from the detector; AI only labels.
3. Page: src/app/(dashboard)/recurring-spend/ (business edition only — gate exactly
   like the personal-only pages do in reverse; see src/lib/workspace/editions.ts and
   how /budgets 404s for business). Table sorted by monthly cost, KPI cards (total
   monthly recurring, YoY-ish trend if data allows, # flagged), badges for price-creep
   and overlap. Sidebar entry for business workspaces.
4. Gating: reuse subscriptionInsightsEnabled in PlanLimits? No — that flag is
   personal-specific in spirit. Add recurringSpendEnabled to PlanLimits in
   src/lib/billing/plans.ts: Business Free false (locked teaser page), Pro/Business/
   Enterprise true; all personal tiers false (edition-gated anyway).
5. Copilot: add a compact "top recurring vendors" section to the business snapshot in
   src/lib/ai/context.ts if not already covered by recurring patterns (check first —
   recurring payment patterns ARE in the snapshot; only add the flags if missing).
6. Tests: the refactor (personal tests unchanged), annualization math, overlap
   flagging with a mocked AI, and edition/plan gating.

Edge cases: vendors billed annually (annualize correctly, don't call a yearly charge
a 12x price increase), currency mixing (present in workspace currency like reports
do), and one-man businesses whose "recurring spend" includes salary-like transfers
(respect existing TransactionType/category exclusions the personal feature applies).
```

---

### P2-9 · Agentic copilot actions (tool calling)

- **What**: The copilot stops being read-only: "categorize these 12 uncategorized
  transactions", "budget €400 for groceries", "add an assumption: rent +€200 from
  October", "mark invoice INV-042 paid" — executed via tool calls with an explicit
  in-chat confirmation step before any write. This is the direction every AI leader is
  going (Cleo Autopilot, Xero JAX bill lifecycle, Intuit agents).
- **Why it fits**: It compounds Ballast's differentiator. But it's the largest lift:
  the `AiClient` abstraction (`src/lib/ai/types.ts`, `openai-compatible.ts`,
  `anthropic.ts`) supports chat/stream, not tools, and the streaming protocol
  (`meta → delta → done`) needs new event types. Do it after P0/P1 so there are more
  tools worth calling (scenarios, budgets, dunning).
- **Edition / gating**: Both; paid plans only.
- **Effort**: L.

**Implementation prompt**

```text
In the Ballast repo (ai-finance-copilot), make the AI copilot agentic: it can propose
and (after user confirmation) execute a small set of write actions. This is a large
change — read src/lib/ai/types.ts (AiClient interface), openai-compatible.ts and
anthropic.ts (both stream over plain fetch + a shared SSE parser),
src/app/api/copilot/route.ts (persists user message, streams newline-delimited JSON
events meta → delta* → done/error, keeps partial output on stop), and
src/lib/ai/prompts.ts + context.ts first.

Constraints (non-negotiable):
- Every write requires an explicit user confirmation in the chat UI. The model
  PROPOSES an action; the user clicks Confirm; only then does the server execute.
- Actions execute through the same permission-checked code paths as the UI: resolve
  requireWorkspace() with the right permission (e.g. edit_transactions,
  manage_forecast — see src/lib/workspace/permissions.ts) and reuse existing route
  logic by extracting it into lib functions where needed; never bypass Zod validation.
- Groq/OpenAI/Anthropic must all keep working: tool support goes into the AiClient
  abstraction (OpenAI-compatible function calling for openai/groq, tool_use blocks
  for anthropic), with graceful degradation to plain chat when a model/provider can't
  do tools.

Build:
1. Extend AiClient with optional tool definitions and tool-call events in the stream.
   Add a new NDJSON event type "action" carrying {toolName, argsJson, proposalId}.
2. Tool registry src/lib/ai/tools.ts — start with exactly five tools, each a Zod
   schema + executor calling existing lib logic:
   set_transaction_category(transactionIds, categoryId),
   create_category_rule(pattern, categoryId),
   create_budget(categoryId, monthlyLimit)              [personal edition only],
   create_assumption(kind, amount, date/window fields)  [respects assumptionsEnabled],
   mark_invoice_paid(invoiceId)                          [business edition only].
   Filter the tool list by edition + the member's effective permissions before
   passing it to the model.
3. Confirmation flow: the copilot route persists proposed actions (new PrismaModel
   CopilotAction { id, conversationId, toolName, argsJson, status PROPOSED |
   CONFIRMED | EXECUTED | REJECTED | FAILED, resultJson }) and a new endpoint
   POST /api/copilot/actions/[id]/confirm executes it (re-validating args against
   current data — the transaction may have been deleted since) and appends a system
   message with the outcome to the conversation. The chat UI
   (src/components/copilot/) renders an action card with Confirm / Dismiss buttons
   and the executed/failed state.
4. Prompting: extend src/lib/ai/prompts.ts so the system prompt explains the tools,
   demands one action per proposal, and forbids inventing ids — transaction/category/
   invoice ids the model may reference must come from the snapshot or a lookup tool;
   add a read-only search_transactions tool for that (query → id list) so the model
   never guesses ids.
5. Gating: paid plans only (aiMessagesPerMonth != some-low-free-tier is not the right
   check — add copilotActionsEnabled to PlanLimits: false on both Free tiers, true
   elsewhere). Actions also consume one AI message from the quota.
6. Tests: tool arg validation, permission filtering (a viewer member gets no write
   tools), the confirm endpoint re-validation path, provider tool-call parsing for
   the OpenAI-compatible and Anthropic wire formats (fixture SSE streams), and
   graceful no-tools degradation.

Edge cases: model proposes a tool with an id not in the workspace (executor 404s,
card shows failure honestly); user confirms twice (idempotent by status); stop-
generation mid-proposal (persist nothing beyond the partial text, like today);
migrations are hand-written SQL per HANDOFF.md §6.
```

---

### P2-10 · Business budgets & variance analysis

- **What**: Per-category monthly spending budgets for Business workspaces plus a
  budget-vs-actual variance view in `/reports` (plan vs actual per category, per month).
  Agicap's variance analysis and Causal/Finmark's plan-vs-actuals are core FP&A
  workflows; QuickBooks has budgets on higher tiers.
- **Why it fits**: The `Budget` model, math and UI already exist for Personal
  (`src/lib/personal/budgets.ts`, `/budgets`) — this is mostly lifting the edition gate
  with business framing (departments later, categories now) and adding one reports
  section. Recommend doing it after P0-3 (scenarios), which serves the adjacent need.
- **Edition / gating**: Business (Business €49 tier+ feels right — it's a
  team/controller feature).
- **Effort**: M.

**Implementation prompt**

```text
In the Ballast repo (ai-finance-copilot), extend budgets to the Business edition and
add a budget-vs-actual variance section to reports. Today budgets are Personal-only:
model Budget in prisma/schema.prisma, math in src/lib/personal/budgets.ts +
budgets-data.ts, page at src/app/(dashboard)/budgets/, API at src/app/api/budgets/,
and the edition gate in src/lib/workspace/editions.ts making the page 404 for
business workspaces.

Build:
1. Ungate: allow the budgets feature for business workspaces in the edition matrix
   and sidebar, with business copy ("Spending budgets") via src/lib/branding.ts
   per-edition strings. The rollover mechanism stays available but defaults OFF for
   new business budgets. Personal behavior must not change.
2. Move the budget math out of src/lib/personal/ into a shared location (e.g.
   src/lib/finance/budgets.ts) since it is no longer personal-only; update imports;
   existing tests keep passing.
3. Variance in reports: read src/lib/reports/data.ts and period.ts. For any selected
   period, add a "Budget vs actual" section: per budgeted category — budgeted amount
   (sum of the monthly limits across the period's months), actual spend, variance €
   and %, with over-budget rows highlighted. Include it in the PDF export
   (src/lib/reports/export-pdf.ts) and the Excel workbook (export-excel.ts) as a new
   sheet — follow the existing section/sheet patterns exactly.
4. Gating: budgets for business behind the BUSINESS €49 tier and above — add
   businessBudgetsEnabled to PlanLimits in src/lib/billing/plans.ts (Free/Pro false
   with a locked teaser page, Business/Enterprise true). Personal tiers keep their
   existing budget access unchanged (budgets are free there by design — see the
   PERSONAL_FREE comment in plans.ts).
5. Permissions: budget editing should require manage_settings or a new edit_budgets
   permission in src/lib/workspace/permissions.ts — look at how similar write
   permissions map to roles (MEMBER yes, VIEWER no) and follow suit.
6. Tests: variance math across multi-month periods (budget created mid-period counts
   only from its first month), export inclusion, plan + edition gating both ways.

Edge cases: categories deleted mid-period (variance uses the transactions' snapshot
via the existing FK SET NULL behavior — uncategorized actuals appear as their own
row), periods with no budgets (hide the section rather than render an empty table),
and currency display consistent with the rest of reports.
```

---

### P2-11 · Debt payoff planner (Personal)

- **What**: Track debts (balance, APR, minimum payment), choose avalanche or snowball,
  see a payoff schedule, projected debt-free date and total interest saved vs
  minimum-only. PocketGuard's most-praised paid feature; YNAB's loan planner similar.
- **Why it fits**: Complements Net worth (P0-2) — liabilities gain APR/minimum fields
  and a projection engine in the spirit of `src/lib/personal/goals.ts` (projected
  completion dates). Deterministic math, very testable, feeds the copilot.
- **Edition / gating**: Personal Plus+.
- **Effort**: M. **Depends on P0-2** (reuses the liability models).

**Implementation prompt**

```text
In the Ballast repo (ai-finance-copilot), add a debt payoff planner to the Personal
edition. Prerequisite: the net worth feature (Asset/AssetValuation models with
liability kinds LOAN | MORTGAGE | CREDIT_LINE) must already be merged — this feature
extends those models. Read src/lib/personal/goals.ts + goals-data.ts first: the
savings-goal projection ("on track / behind / needs €X per month") is the exact
pattern to mirror for payoff projections.

Build:
1. Prisma: extend the liability side — either new columns on Asset (aprPercent
   Decimal?, minimumPayment Decimal?) applicable only to liability kinds, or a small
   DebtDetail 1:1 model; choose whichever keeps schema.prisma clean and write the
   hand-written SQL migration (HANDOFF.md §6).
2. src/lib/personal/debts.ts: given the workspace's liabilities with balance
   (latest valuation), APR and minimum payment, plus a monthly extra-payment amount
   the user sets, compute payoff schedules under avalanche (highest APR first) and
   snowball (smallest balance first): per-month balances per debt, debt-free date,
   total interest paid, and the delta vs paying minimums only. Monthly compounding
   (APR/12), payments applied after interest accrual; document the convention in the
   module docstring.
3. Page: src/app/(dashboard)/debts/ (personal edition gate, same mechanism as
   /budgets): debts table (edit APR/minimum inline), strategy toggle
   avalanche/snowball with the interest-saved comparison headline, an extra-payment
   input, a stacked area chart of balances declining over time (Recharts), and a
   per-debt payoff order list. Add sidebar entry + a compact card on the personal
   dashboard when at least one debt exists.
4. Copilot: add a debts section (total debt, weighted APR, debt-free date under the
   chosen strategy) to the personal snapshot in src/lib/ai/context.ts.
5. Gating: goalsEnabled-style flag — add debtPlannerEnabled to PlanLimits: Personal
   Free false (teaser), Plus and Premium true; business edition never sees it.
6. Tests: payoff math against hand-computed fixtures (two debts, known APRs, verify
   month counts and interest totals), avalanche vs snowball ordering, zero-APR debts,
   payment smaller than monthly interest (balance grows — surface a warning state,
   never an infinite loop: cap simulation at 50 years and return "not payable").

Edge cases: debt paid off mid-plan rolls its payment into the next target (that's
the point of both strategies); balances updated via new AssetValuation rows re-run
the projection; currency = workspace currency.
```

---

### P2-12 · Invoice creation & sending (Business)

- **What**: Create outgoing (receivable) invoices in Ballast — line items, VAT,
  numbering, a branded PDF, email to the customer — instead of only ingesting incoming
  documents. Pennylane, QuickBooks, Xero and Digits all treat invoice *issuing* as
  core; QuickBooks' Payments Agent even drafts invoices from a photo or text.
- **Why it fits**: Ballast has the `Invoice`/`InvoiceLineItem` models with a
  receivable direction, VAT fields, PDF generation experience (`pdf-lib` in
  `src/lib/reports/export-pdf.ts`) and email infra. It completes the AR loop with
  dunning (P0-4): create → send → remind → match payment. Biggest scope of the list;
  do it last, and skip payment links (Stripe invoicing for users' customers) in v1.
- **Edition / gating**: Business Pro+ with a monthly cap on Free.
- **Effort**: L.

**Implementation prompt**

```text
In the Ballast repo (ai-finance-copilot), add outgoing invoice creation to the
Business edition. Today invoices are ingest-only: uploaded/extracted documents stored
in Supabase Storage with models Invoice + InvoiceLineItem (prisma/schema.prisma —
note InvoiceDirection RECEIVABLE already exists and feeds AR in reports). Read
src/lib/invoices/serialize.ts, the invoice routes under src/app/api/invoices/, the
review form in src/components/invoices/, and the pdf-lib usage in
src/lib/reports/export-pdf.ts (the house PDF approach — no headless browser).

Build:
1. Data: extend Invoice for issued invoices — issuedByUs boolean (or an
   InvoiceOrigin enum UPLOADED | ISSUED), customerName/customerEmail if P0-4's
   dunning didn't already add them, and a per-workspace invoice number sequence
   (format like 2026-0001; store nextInvoiceNumber on Workspace or a tiny sequence
   table; concurrency-safe via an atomic update). Hand-written SQL migration
   (HANDOFF.md §6).
2. Create/edit UI: "New invoice" on /invoices for business workspaces — customer
   details, issue + due dates, currency, line items (description, qty, unit price,
   VAT rate per line), automatic subtotal/VAT/total using the same arithmetic the
   extraction validator checks (see the qty × price ≈ line total and subtotal + VAT
   ≈ total checks in src/lib/invoices/extraction-core.ts — reuse, don't duplicate).
   Statuses: DRAFT until sent, then UNPAID (the existing enum InvoiceStatus already
   models this — verify and reuse; "overdue" stays derived, never stored).
3. PDF: src/lib/invoices/render-pdf.ts using pdf-lib in the style of the reports PDF:
   header with the workspace/company name (business profile fields exist — see model
   BusinessProfile), customer block, line-item table, VAT summary, totals, payment
   terms free-text. Store the rendered PDF in the existing private invoices bucket
   under the per-user path convention (src/lib/invoices/storage.ts) so the standard
   signed-URL document route serves it unchanged.
4. Send: email the PDF to customerEmail via sendEmail() in
   src/lib/notifications/email.ts (attachment support may need adding to the Resend
   payload — their REST API takes base64 attachments; keep the honest
   sent/not_configured/failed reporting). Sending flips DRAFT → UNPAID and stamps
   sentAt. Issued invoices then flow through the existing AR aging, reports and
   (if merged) the P0-4 dunning escalations with zero extra work — verify, don't
   assume.
5. Gating: add invoicesIssuedPerMonth to PlanLimits (src/lib/billing/plans.ts):
   Business Free 3, Pro 50, Business/Enterprise null. 402 with upgrade hint via
   src/lib/billing/entitlements.ts. Personal edition: edition-gated out entirely
   (invoices already are — verify the create route rejects personal workspaces).
6. Tests: number sequencing under concurrent creates, VAT math per line and rounding
   (2 decimals, half-up — match extraction-core's tolerance), status transitions,
   quota enforcement, and PDF generation smoke test (parses, non-zero pages).

Edge cases: editing after sending is forbidden (issue a credit-note-style copy
instead — v1 can simply block edits on sent invoices with a message); deleting a
draft is fine, deleting a sent invoice requires the same confirm pattern as other
destructive actions; multi-currency invoices render their own currency; VAT-exempt
lines (0%).
```

---

## 3. Suggested implementation order

Ordered for dependency and compounding value; each item is independently shippable.

1. **AI transaction categorization** (P0-1) — improves every other feature's data
   quality; establishes the AI-batch-JSON pattern others reuse.
2. **Safe-to-Spend** (P1-5) — smallest item, instant personal-edition value while the
   bigger P0s are in flight.
3. **Net worth tracking** (P0-2) — headline Personal feature for marketing; prerequisite
   for the debt planner.
4. **Named forecast scenarios** (P0-3) — headline Business feature; makes the forecast
   the reason to pay.
5. **AI dunning** (P0-4) — the "Ballast pays for itself" story for Business; also lays
   customer-contact groundwork for invoice creation.
6. **Business recurring-spend audit** (P1-8) — quick win reusing the subscription
   engine; pairs with dunning in a "find money" narrative.
7. **Household sharing** (P1-7) — cheap, upgrade-driving; do whenever a small slot opens.
8. **Proactive insights feed** (P1-6) — best shipped after 1/3/4 so it has more insight
   types to draw on.
9. **Business budgets & variance** (P2-10).
10. **Debt payoff planner** (P2-11) — after net worth.
11. **Agentic copilot actions** (P2-9) — after the above so there are more tools worth
    calling; largest AI-infrastructure lift.
12. **Invoice creation & sending** (P2-12) — completes the AR loop; largest overall
    scope, benefits from dunning being live.
