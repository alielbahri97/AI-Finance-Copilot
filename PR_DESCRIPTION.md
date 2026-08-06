# Merge four independent workstreams: interface redesign, net-worth tracking, AI transaction categorization, and invoice dunning

This branch is not one feature. `feat/net-worth` was branched on top of two earlier feature
branches that were never merged, so the 15 commits between `origin/master` and this tip cover four
unrelated workstreams:

1. **AI transaction categorization** (`8f7683c`, also the tip of `feat/ai-categorization`)
2. **AI-drafted invoice dunning** (`9ab73b5`, also the tip of `feat/ai-dunning`)
3. **Net-worth tracking for the Personal edition** (`df1c6fd`, `c7b5953`)
4. **The interface and accessibility redesign** (11 commits, `4983455` through `9e75bc9`)

180 files, +13,726/-1,749. Each workstream is self-contained and independently reviewable; the
commits are ordered so that reviewing them in sequence keeps the four apart. Three additive
migrations come with it — `0018_ai_categorization`, `0019_customer_dunning`, `0020_net_worth` —
each with the paste-into-Supabase bundle under `ops/migrations-bundle/` that the production
database is actually migrated with.

## Interface and accessibility redesign

Two things were plainly broken before this.

**The app shipped with no typeface at all.** `layout.tsx` set `className="font-sans"` and nothing
ever loaded a font; `globals.css` defined no `--font-sans` in its `@theme` block. Every screen
rendered in whatever the browser's default sans-serif happened to be, so the product looked
different on every operating system and looked designed on none of them. Inter and JetBrains Mono
are now loaded through `next/font/local`, with the stylistic sets that keep narrow table columns
legible (`cv11`, `ss01`) and a `numeric` utility — `tabular-nums slashed-zero` — for money figures,
so digits stop changing width between renders and `0` stays distinct from `O` in account and
invoice numbers.

**Several semantic finance colors were failing WCAG AA.** The contrast ratios here were computed
from the token values rather than eyeballed, which is how the failures were found in the first
place, since none of them are visible by inspection:

- `--muted-foreground` was tuned against `--card`, but the `bg-muted text-muted-foreground` chip
  pattern (draft invoices, inactive tabs, empty-state icons) puts it on `--muted`, where it reached
  only **4.31:1**.
- `--warning` sat at exactly 4.5:1 on white, but every warning badge and alert prints it on a 10%
  wash of itself, which dropped it to **4.14:1** — the pattern failed AA everywhere it was used.
- The solid `bg-destructive` button was at **4.52:1**, and its `/90` hover blends towards the
  surface, lightening the fill and pushing it under the threshold on the one interaction that
  matters most.

The fix was to stop treating a semantic color as a single value. Each now splits by role: the base
(charts, borders, rings, progress fills), a `-tinted` variant for text on a 10% wash of the base,
and a `-solid` variant for a filled surface carrying white text. A fix to one role can no longer
drag the others — the base stays exactly where the charts want it. Chart series are addressed by
meaning (`--chart-income`, `--chart-expense`, `--chart-net`, `--chart-projected`) rather than by
slot order, so green cannot end up labelled "Income" on one page and "Profit" on another, and a
contrast fix propagates into the charts for free.

The rest of the redesign, one commit each:

- **Confirmation on destructive actions** (`28c0a08`) — every delete now goes through one
  `ConfirmDialog`, rather than some paths asking and others deleting on click.
- **Dashboard hierarchy** (`8de4eac`) — the dashboard leads with the figure people open it for, and
  every chart carries a screen-reader-readable table via `chart-accessibility.tsx`.
- **Sorting and pagination** (`ec94446`) — long lists were silently cut off at 200 rows with no
  indication that anything was missing. Transactions and invoices are now sorted and paged through
  a shared `DataTable`.
- **Mobile navigation and copilot recovery** (`fc7adde`) — a bottom tab bar sized from one
  `--tab-bar-height` token that the page padding, help FAB and install prompt all read, so they
  cannot drift apart; and a failed copilot turn can be retried instead of stranding the
  conversation.
- **First-run funnel** (`3b2f87c`) — signup through to a first imported transaction without
  guesswork, plus a dashboard zero-state.
- **Loading and empty states** (`0a95535`, `5edcde8`) — skeletons that show the shape of the page
  while it loads, reports ranked by what is worth reading first, and something useful to read
  wherever a list is empty.
- **Locale-aware formatting** (`ec29a71`, `9e75bc9`) — money and dates are written the way the
  workspace's own currency is written, so a EUR workspace reads `1.234,56 €` rather than
  `€1,234.56`.
- **Build fixes** (`4983455`, `464d30f`) — see below.

## Net-worth tracking (Personal edition)

Ballast Personal had only ever seen flows: money in, money out, what is left this month. The
question people actually ask of a finance app over years — am I getting better off? — needs the
stock, not the flow, and that means the house, the car, the index fund and the mortgage, none of
which any bank connection reports. `/net-worth` adds an assets table, a debts table and a
twelve-month net-worth line above both.

Two rules keep the headline figure honest. Bank cash is never entered by hand — it comes from
`computeCashPosition`, which is also what applies each account's `includeInTotals` switch, so an
Asset row exists precisely for what is not synced and the same current account can never be counted
twice. And there is still no FX anywhere in this app: a holding in another currency is shown with
its own figure and left out of every total, because inventing a rate would misstate net worth rather
than admit it does not know.

An asset row carries no value of its own. Worth changes, and the history of it is the whole feature,
so every figure is an append-only `AssetValuation` dated by the day it describes. That is what makes
the chart possible: each month takes the most recent valuation on or before its last day and carries
it forward, so a house revalued once a year draws a line rather than a single spike. `c7b5953` is
the follow-up: a workspace that downgrades from Plus to Free keeps its holdings counting towards the
headline figure, so hiding the tables outright left the summary saying "3 tracked, plus cash" above
a page showing nothing.

The copilot gets a compact net-worth block in its snapshot, built from monthly nets it had already
accumulated, and the section is omitted entirely when nothing is tracked rather than restating the
bank balance under a second heading.

## AI transaction categorization

Rule matching only ever covered merchants somebody had already taught the workspace about, so a
first import landed mostly uncategorized and every downstream feature — budgets, reports, forecasts,
the copilot's context — worked from a pile of "Uncategorized". CSV import and bank sync now hand
whatever the rules left empty to the AI, in batches of 50, against the workspace's own category
list.

Two properties hold the design together. **A rule always wins**: the AI is only shown rows that came
out of rule matching with no category, so a pattern the user taught us can never be overridden by a
model's opinion. And **an AI failure never fails an import**: the pass runs inside its own 12-second
deadline, swallows its own errors and returns a count, so the worst case is an import with more rows
to sort by hand — exactly where the product was before.

Everything the model says is treated as a suggestion to be disproved, in `categorize-core.ts`:
suggestions below 0.8 confidence are dropped, so are indexes that were never sent, category ids the
workspace does not own, and categories pointing the wrong way for the transaction's direction.
Invalid JSON gets one retry that shows the model its own output and the validation error. The pass
reads its rows back from the `ImportBatch` rather than taking them as an argument, which is what
makes it correct on re-import and safe to call twice.

## AI-drafted invoice dunning

An unpaid receivable now has a Remind customer action: the escalation step is picked from how far
the invoice is from its due date, the subject and body are drafted by the AI from the invoice's own
facts, and the user edits both before anything is sent. Without an AI key the draft comes from a
deterministic template, the way the notification digests already do.

Each step is sent at most once per invoice, enforced by a unique key on the reminder log rather than
by hoping two callers do not overlap. Workspaces that opt in have the hourly notifications cron do
the same pass for them, one step per invoice per run, with an in-app notification to the owner for
every send. Off by default, paid Business plans only.

## Notable decisions

- **The brand color moved from blue to indigo.** The app icon has always been `#4F46E5`, and
  `--primary` was a blue at hue 262.9 — the icon and the interface it opened were different colors.
  Every primary-derived token (`--ring`, `--accent`, `--chart-1`, the sidebar set) now sits on the
  icon's indigo hue, 276.966.
- **Fonts are self-hosted rather than fetched from Google.** `next/font/google` resolves CSS and
  binaries at build time, and this network cannot reach `fonts.googleapis.com`, so `next build`
  fails outright. The `.woff2` files are copied into `src/app/fonts/` from the
  `@fontsource-variable/*` packages and loaded with `next/font/local`. `HANDOFF.md` records where to
  re-copy them from when bumping those packages.
- **`prisma generate` falls back to a placeholder engine when `binaries.prisma.sh` is unreachable.**
  `scripts/prisma-generate.mjs` attempts a normal `prisma generate` first and only substitutes the
  placeholder when the download itself is what failed, so an unrestricted network is completely
  unaffected — it never takes the fallback path. The CLI only checks that the engine file exists,
  and runtime queries never need it because the app uses the pg driver adapter. This replaces the
  `PRISMA_SCHEMA_ENGINE_BINARY` environment variable that every shell previously had to set by hand;
  `build`, `postinstall` and `generate` all route through the script, which is why the Docker deps
  stage now copies `scripts/` (`464d30f`).
- **Dark-mode `--primary` sits at 4.25:1, and that is a proven ceiling rather than a compromise.**
  The token has to do two things at once: carry near-white text as a solid button, and be readable
  as text itself on `--card`. Those two contrast ratios multiply to a constant that depends only on
  `--primary-foreground` and `--card` — 18.03 here — so whatever indigo goes in,
  `min(button, link)` can never exceed `sqrt(18.03) = 4.25:1`. Pure white button text only lifts the
  ceiling to 4.34. AA on both is unreachable without inverting the button foreground to navy or
  darkening every card, so the value sits exactly on the balance point at 4.25/4.24 rather than
  letting one side fail outright. Chroma drops from 0.233 to 0.22 because the balanced lightness at
  0.233 falls outside sRGB and would render clipped — that is, not the color declared.

## Known gaps

- **Locale is derived from currency, not stored.** `localeForCurrency` maps EUR to `de-DE`, GBP to
  `en-GB` and so on. This is a stopgap and wrong in principle: currency is not nationality, and a
  Dutch user can perfectly well hold a USD account. Making it correct needs a `locale` column on
  `Profile`, a picker in settings so the column has a writer, and the value read alongside
  `currency` where the workspace context is resolved. Every call site already takes the locale as an
  argument, so that last step is a substitution at one point and nothing deeper.
- **The remaining dunning, email-delivery and bank-integration work is not in this PR.** It is still
  uncommitted in the working tree of the machine this branch came from. The committed state does not
  depend on it — the uncommitted changes to `src/lib/notifications/email.ts` and the notifications
  cron route are additive refinements on top, and nothing committed here imports a module that only
  exists uncommitted — so this branch stands on its own.

## Test plan

Already verified on this branch:

- [x] `npm run typecheck` clean
- [x] `npm run lint` clean
- [x] Full test suite passing, including the new `tests/ai-categorization.test.ts`,
      `tests/dunning.test.ts`, `tests/net-worth.test.ts` and `tests/format.test.ts`
- [x] `next build` completes, run from the committed tip in an isolated worktree against a Prisma
      client regenerated from the committed schema
- [x] The committed state checked out and verified in an isolated git worktree, so none of the above
      depends on uncommitted files in the original working tree
- [x] Migration `0020` verified by replay rather than by reading: `0001`–`0019` into a real
      PostgreSQL engine, then the Supabase bundle twice (idempotent, 18 of 18 checks OK) and the
      plain migration file onto a second copy, with the resulting columns, indexes and constraints
      diffed identical

For a human to click through:

- [ ] Both dashboard editions, Business and Personal, in light and dark mode
- [ ] A destructive delete — confirm the dialog appears, that cancelling leaves the row alone, and
      that confirming removes it
- [ ] Transactions sorting and pagination, and invoice pagination, past the old 200-row cut-off
- [ ] The onboarding import step end to end, and the dashboard zero-state on a workspace with no
      data
- [ ] A copilot turn made to fail, then retried
- [ ] Mobile layout: the new bottom tab bar, and that the help button and install prompt clear it
