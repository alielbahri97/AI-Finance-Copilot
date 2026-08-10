# Mobile API contract

The JSON contract a native client writes against, and the rules it can rely on
not changing without a version bump.

A released Android build keeps running for months after it stops being the
newest one, so everything in this document is a promise to versions of the app
that are already in people's hands. Changing a shape here is a breaking change
even when nothing on the server notices.

---

## 1. Authentication

The API accepts two ways of saying who you are. They are alternatives, not
layers: a request that presents a token is answered on the token alone.

### Web — cookie session (unchanged)

The browser keeps the `@supabase/ssr` cookie session it always had. Nothing
about this path changed, including the middleware session refresh.

### Native — `Authorization: Bearer <supabase access token>`

Send the access token from the Supabase Android SDK:

```
Authorization: Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6...
```

The token is verified **locally**, against the project's published signing keys,
cached in the server process. There is no round trip to the auth server per
request.

What is checked, and what a failure looks like:

| Checked | On failure |
| --- | --- |
| Signature, against the project's JWKS | `401 {"error":"Unauthorized"}` |
| `iss` equals `<SUPABASE_URL>/auth/v1` | `401` |
| `aud` equals `authenticated` | `401` |
| `exp`, with 5 seconds of clock tolerance | `401` |
| Not an anonymous session | `401` |

The client learns only that it was not authenticated. The reason is logged
server-side under `bearer_token_rejected` with a `code`.

**A token that fails to verify does not fall back to the cookie session.**
Falling back would mean a stale or tampered token silently resolves to whoever
the browser happens to be signed in as, which hides client bugs and surprises
everyone.

On `401`, refresh the access token with the Supabase SDK and retry once.

### Choosing a workspace

A user can belong to several workspaces. Select one with a header:

```
X-Ballast-Workspace: ws-9c1f...
```

Resolution order is: this header, then the `ballast_workspace` cookie (web),
then the user's default workspace — the personal one if it exists, otherwise
their oldest membership.

The header is a **hint**. It grants nothing. The id is sanitised (64 characters
maximum, `[A-Za-z0-9_-]` only) and then used solely to look up a membership row,
and membership is re-verified against the database on **every** request. Naming
a workspace you do not belong to is not an error — it simply selects nothing,
and you fall through to your default. A removed member loses access on their
next request.

Permissions are resolved from the member's role, narrowed by any per-member
overrides, and then narrowed again by the workspace's edition. A Personal
workspace has no concept of invoices or team members, so an owner of one does
not carry `view_invoices` or `manage_members` however the row is written.

---

## 2. Money

**Money is a decimal string. Never a JSON number.**

```json
{ "amount": "1234.56", "currency": "EUR" }
```

Parse it with `BigDecimal(String)` on Android. Do not route it through `Double`.

### Why not a number

A JSON number is an IEEE 754 double by the time Kotlin has parsed it. Summing a
column of them drifts, and the drift shows up as a balance that is a cent off
and cannot be explained to a user.

### Why not minor units

Integer cents were the alternative and are rejected. They only work if the
reader knows the currency's exponent, and that is not a constant: JPY has no
minor unit, most currencies have two, a few have three. Every money column in
this database is `Decimal(14, 2)` regardless of currency, so a "cents" contract
would be quietly a hundred times wrong for a yen workspace. A decimal string
carries its own scale and needs no lookup table.

### The rules

- Always a string, always exactly two decimal places, matching the stored scale.
- Negative amounts carry a leading `-`. There is one zero: `"0.00"`, never
  `"-0.00"`.
- Absent is `null`, not `"0.00"`. Zero is `"0.00"`, not `null`.
- Never `NaN`, never `Infinity`, never an empty string.
- Where the currency is not implied by the surrounding object, the amount is
  paired with a `currency` field holding an ISO 4217 code.

### What is *not* money

Counts, percentages, savings rates, plan limits and quota meters stay JSON
numbers. A double is the right type for them and stringifying would only make
them annoying to use. Plan *list prices* are also plain numbers — they are a
price list, not a transaction amount.

---

## 3. Dates and times

**Every instant is ISO 8601, in UTC, with milliseconds and an explicit `Z`.**

```json
{ "createdAt": "2026-08-10T12:34:56.000Z" }
```

Values that mean a **calendar day** rather than an instant — a transaction's
date, an invoice's due date — are stored at UTC midnight and sent in the same
shape:

```json
{ "date": "2026-08-10T00:00:00.000Z" }
```

So a client reads the first ten characters to get the day and never has to
guess whether an offset was implied. Absent is `null`.

Query parameters that take a date accept the day form, `YYYY-MM-DD`. `from` is
interpreted as that day's UTC start, `to` as its UTC end, so a range is
inclusive of both endpoints.

---

## 4. Errors

Every error body has an `error` string meant to be shown to a person. Some also
carry a machine-readable `code`.

| Status | Body | Meaning |
| --- | --- | --- |
| 400 | `{"error":"..."}` | Malformed request. The message names the field. |
| 401 | `{"error":"Unauthorized"}` | No usable session or token. Refresh and retry once. |
| 402 | `{"error":"...","code":"UPGRADE_REQUIRED","feature":"...","plan":"FREE"}` | The workspace's plan does not include this. |
| 402 | `{"error":"...","code":"LIMIT_REACHED","feature":"...","plan":"..."}` | This month's quota is used up. |
| 403 | `{"error":"...","code":"FORBIDDEN","permission":"edit_transactions"}` | Authenticated, but the member lacks that permission. |
| 404 | `{"error":"...","code":"WRONG_EDITION","feature":"budgets"}` | The feature does not exist in this workspace's edition. Not 403: in the wrong edition it is not a thing that could be granted. |
| 409 | `{"error":"...","code":"..."}` | A conflict the user has to resolve first. |
| 429 | `{"error":"...","code":"RATE_LIMITED"}` | Plus a `Retry-After` header. |
| 500 | `{"error":"..."}` | A safe message. Details are server-side only. |

Treat `403` and `404 WRONG_EDITION` as "hide this surface", not as failures to
retry.

`WRONG_EDITION` is documented because other routes in this codebase return it,
but **none of the endpoints in section 5 can**. None of them is
edition-exclusive: they all exist in both editions and differ only in content.
The edition shows up instead as `sections.invoices: false` and `members: null`
in a Personal workspace, as the absence of accounting providers, and as a
Personal-only plan line-up — because `view_invoices` and `manage_members` are
stripped from the permission set before any route sees them.

---

## 5. Endpoints

Everything here accepts either identification scheme and honours
`X-Ballast-Workspace`. Every one of them can return `401`, and `500` on an
unexpected server fault, so those are not repeated per endpoint.

### `GET /api/session/bootstrap`

The one call to make at launch. No permission required — the answer *is* what
you have access to.

```json
{
  "profile":     { "id": "...", "email": "...", "fullName": "...", "avatarUrl": null, "currency": "EUR", "aiProvider": "GROQ", "isAdmin": false, "tourCompletedAt": null, "celebrationSeenAt": null },
  "workspaces":  [ { "id": "...", "name": "...", "type": "BUSINESS", "role": "OWNER" } ],
  "workspace":   { "id": "...", "name": "...", "type": "BUSINESS", "edition": "business", "currency": "EUR", "aiCategorizationEnabled": true, "autoDunningEnabled": false },
  "membership":  { "role": "OWNER", "memberId": "...", "permissions": ["edit_transactions", "..."] },
  "entitlements":{ "planId": "FREE", "planName": "Free", "edition": "business", "limits": {}, "usage": {}, "isTrial": false, "trialEndsAt": null, "subscriptionStatus": "...", "cancelAtPeriodEnd": false, "currentPeriodEnd": null, "hasStripeCustomer": false, "period": "2026-08" },
  "onboardingComplete": true
}
```

`permissions` is sorted, so two responses can be compared directly.
`onboardingComplete` false means send the user to onboarding, exactly as the web
app would. Errors: `404` if the requested workspace is not one you are in.

### `GET /api/dashboard`

Home screen figures. No permission required to open it; the three `sections`
flags say which cards this member may draw, so you render what is permitted
instead of asking three times and being refused.

```json
{
  "dashboard": {
    "monthIncome": "8420.00", "monthExpenses": "5310.55", "monthNet": "3109.45",
    "incomeChangePct": 12.4, "expensesChangePct": null,
    "totalBalance": "24180.10", "savingsRate": 0.369, "transactionCount": 412,
    "cash": { "source": "bank", "total": "24180.10", "currency": "EUR", "banks": [], "accounts": [], "countedAccounts": 3, "excludedAccounts": 1, "hasOtherCurrency": false, "asOf": "2026-08-10T04:11:00.000Z", "transactionBalance": "23110.00" },
    "monthlySeries":      [ { "month": "Aug", "income": "8420.00", "expenses": "5310.55", "net": "3109.45" } ],
    "categoryBreakdown":  [ { "category": "Groceries", "color": "#5B8DEF", "amount": "612.40" } ],
    "largestExpenses":    [ { "id": "...", "type": "EXPENSE", "amount": "1200.00", "category": "Rent", "categoryColor": "#000", "description": "...", "date": "2026-08-01T00:00:00.000Z" } ],
    "balanceHistory":     [ { "date": "2026-08-01T00:00:00.000Z", "balance": "21000.00" } ],
    "recentTransactions": [ { "...": "same shape as largestExpenses" } ]
  },
  "currency": "EUR",
  "edition": "business",
  "sections": { "transactions": true, "invoices": true, "reports": false }
}
```

`incomeChangePct` and `expensesChangePct` are percentages as numbers, not money,
and are `null` when there is no prior month to compare with. `savingsRate` is a
fraction between 0 and 1.

Two fields look like dates and are not. `monthlySeries[].month` is a short
English chart-axis label — `"Aug"`, not `"2026-08"` — carrying no year, so a
client that needs a real month must derive it from the series position rather
than parse this. `cash.reason` on an account is an enum, one of `"counted"`,
`"excluded"`, `"no-balance"` or `"other-currency"`. By contrast
`balanceHistory[].date`, which is a calendar day internally, *is* widened to a
full UTC-midnight timestamp so it obeys the contract in section 3.

### `GET /api/transactions`

Requires `view_transactions`.

| Parameter | Values | Default |
| --- | --- | --- |
| `q` | free text, matched against description and counterparty, case-insensitive | none |
| `type` | `INCOME`, `EXPENSE`; anything else means no type filter | none |
| `category` | a category id, or the literal `uncategorized` | none |
| `batch` | an import batch id | none |
| `from`, `to` | `YYYY-MM-DD`, inclusive of both days | none |
| `min`, `max` | non-negative decimals, compared against the absolute amount | none |
| `sort` | `date`, `description`, `category`, `amount` | `date`, or `amount` when `category=uncategorized` |
| `dir` | `asc`, `desc` | the column's natural direction: `desc` for date and amount, `asc` for text |
| `page` | integer from 1; clamped down to the last real page | 1 |
| `size` | `25`, `50`, `100` | 50 |

```json
{
  "transactions": [ {
    "id": "...", "type": "EXPENSE", "amount": "42.10", "currency": "EUR",
    "category": { "id": "...", "name": "Groceries", "color": "#5B8DEF" },
    "description": "...", "counterparty": null,
    "date": "2026-08-09T00:00:00.000Z", "createdAt": "2026-08-09T18:22:41.000Z",
    "importBatchId": null
  } ],
  "currency": "EUR",
  "page": 1, "pageSize": 50, "pageCount": 9, "totalCount": 412,
  "sort": "date", "dir": "desc",
  "totals":  { "income": "8420.00", "expenses": "5310.55", "net": "3109.45" },
  "batches": [ { "id": "...", "fileName": "jan.csv", "createdAt": "...", "transactionCount": 88 } ]
}
```

Two things are deliberately not per-page. `totals` aggregates the **whole
filtered set**, because "how much did groceries cost me" is the question a
filter is asked. `batches` lists every import in the workspace regardless of the
filter, because it populates the batch filter itself and would otherwise vanish
the moment it was used.

`page` in the response is the page actually served: asking for page 40 of a
three-page set returns page 3, not an empty list. Errors: `400` names the
offending parameter, `403` without `view_transactions`.

### `GET /api/integrations`

Requires `manage_integrations`.

```json
{
  "locked": false,
  "encryptionConfigured": true,
  "bankConnectionLimit": 1,
  "currency": "EUR",
  "providers": [ {
    "id": "gocardless", "name": "...", "flow": "redirect", "configured": true,
    "connections": [ { "id": "...", "status": "ACTIVE", "institutionName": "...", "institutionLogo": "...", "lastSyncAt": "...", "lastError": null, "accounts": [ { "id": "...", "name": "...", "mask": "1234", "currency": "EUR", "balance": "1204.55", "balanceAt": "...", "includeInTotals": true } ] } ]
  } ]
}
```

`locked` true means the plan does not include integrations. It is deliberately
**not** a `402`: render the grid behind an upgrade prompt, as the web app does.
The connect and sync endpoints are where the plan is actually enforced.

### `GET /api/profile`

Session only, no permission — a person's own name is not a permission.

```json
{
  "profile": { "id": "...", "email": "...", "fullName": "...", "avatarUrl": null, "currency": "EUR", "aiProvider": "GROQ", "isAdmin": false, "tourCompletedAt": null, "celebrationSeenAt": null },
  "edition": "business",
  "workspace": { "id": "...", "name": "...", "type": "BUSINESS", "edition": "business" },
  "locationHint": "NL",
  "supportedCurrencies": ["EUR", "USD", "..."],
  "personal": null,
  "business": { "...": "the business questionnaire, or null" }
}
```

Exactly one of `personal` and `business` is non-null, following the current
workspace's edition. `aiProvider` is an uppercase enum — `GROQ`, `OPENAI` or
`ANTHROPIC` — not a lowercase string. `currency` is the stored preference
verbatim, so a client rendering a picker should fall back to `USD` when it is
not in `supportedCurrencies`, which is what the web page does.

### `GET /api/workspace`

Session only, no permission.

```json
{
  "workspace": { "id": "...", "name": "...", "type": "BUSINESS", "edition": "business", "currency": "EUR", "aiCategorizationEnabled": true, "autoDunningEnabled": false },
  "members": [ { "id": "...", "userId": "...", "role": "ADMIN", "fullName": "...", "email": "...", "permissions": ["..."], "overrides": { "granted": [], "revoked": [] }, "joinedAt": "..." } ],
  "seats": { "used": 3, "limit": 5, "planName": "Team" }
}
```

`members` is `null`, not `[]`, in the Personal edition: there is nobody to list,
and null says "this workspace has no team" where `[]` would read as "the team is
empty". The gate on the roster is the edition, not a permission — the web
settings page shows the member list to anyone in the workspace, including a
VIEWER, and gates only pending invitations and the audit log on
`manage_members` — so this endpoint does the same. Each member carries both its
effective sorted `permissions` and the raw `overrides` map a permissions editor
needs.

`seats.limit` null means unlimited. `seats.used` counts members plus pending
invitations, because that is what the plan counts. Note this can legitimately
disagree with the figure the web app shows a non-manager: the settings page adds
the invitations it fetched, and it only fetches them for someone with
`manage_members`, so a plain member sees an under-count there. The API figure is
the correct one.

### `GET /api/billing/summary`

Requires `view_billing`.

```json
{
  "entitlements": { "...": "as in bootstrap" },
  "planSource": "stripe",
  "plans": [ { "id": "PRO", "edition": "business", "name": "Pro", "description": "...", "monthlyPriceEur": 29, "monthlyPrice": "29.00", "limits": {}, "highlights": ["..."] } ],
  "usage": {
    "aiMessages":         { "used": 12, "limit": 100 },
    "aiCategorizations":  { "used": 0,  "limit": 500 },
    "csvImports":         { "used": 2,  "limit": 5 },
    "invoiceExtractions": { "used": 0,  "limit": 0 },
    "exports":            { "used": 1,  "limit": null }
  },
  "billingConfigured": true
}
```

`planSource` is one of `stripe`, `google_play`, `complimentary`, `trial`,
`free`. `google_play` is in the union so a client can switch on it from the
first release, but nothing returns it yet — there is no Play Billing
integration in this codebase. A meter with `limit: 0` does not exist in this
edition and should be hidden rather than shown as "0 / 0"; `limit: null` is
unlimited. `billingConfigured` false means the server has no Stripe keys, so
say so rather than opening a checkout that will fail. `plans` lists only the
current edition's tiers. Errors: `403` without `view_billing`.

### `POST /api/integrations/gocardless/link`

Starts a bank connection. Requires `manage_integrations`. POST because every
call mints a requisition at GoCardless.

Body is optional: `{"institutionId": "ABNAMRO_ABNANL2A"}`, falling back to the
server's `GOCARDLESS_INSTITUTION_ID`. Get ids from
`GET /api/integrations/gocardless/institutions`.

```json
{ "link": "https://ob.gocardless.com/...", "requisitionId": "...", "reference": "...", "institutionId": "...", "expiresAt": "2026-08-10T15:41:00.000Z" }
```

Open `link` in a Custom Tab and **keep `reference`** — it is what finalizes the
connection. The attempt is finalizable until `expiresAt`, thirty minutes out.

Errors: `400` for a malformed or missing institution id; `402` with
`code: "UPGRADE_REQUIRED"` when the plan has no integrations, or
`code: "LIMIT_REACHED"` when its bank allowance is spent; `403` without the
permission; `404` if GoCardless is not offered in this workspace's edition;
`502` if GoCardless itself refuses; `503` if the server is missing GoCardless
credentials or the encryption key.

The plan allowance is checked **before** the link is minted, so a user never
learns their limit while sitting on a bank's consent screen.

**What the Custom Tab lands on, and why the app must not rely on it.** The
redirect URL GoCardless sends the user back to is this server's *web* callback,
`/api/integrations/gocardless/callback`, because the redirect is built inside
the shared provider module. That page authenticates with a cookie session. If
the user happens to be signed in to Ballast in Chrome, the callback finalizes
the connection itself and lands on the web integrations page; if not — the
common case on a phone — it redirects to the web login page.

Either way the Android client should **ignore what the tab shows**, close it on
resume, and call `/finalize` with the reference it kept. That is correct in both
cases: if the web callback already finalized, `/finalize` takes its idempotent
path and returns the same connection. The only cost is that a signed-out user
may glimpse a login page before the app dismisses the tab.

Removing that glimpse means giving GoCardless an app deep link as the redirect
instead, which requires a change to the shared provider module that was
deliberately left alone here.

### `POST /api/integrations/gocardless/finalize`

Finishes the connection once the Custom Tab closes. Requires
`manage_integrations`. Body: `{"reference": "..."}`.

```json
{ "connection": { "id": "...", "provider": "gocardless", "status": "ACTIVE", "institutionName": "...", "institutionLogo": "...", "accounts": [ { "id": "...", "externalAccountId": "...", "name": "...", "mask": "1234", "currency": "EUR", "includeInTotals": true, "balance": null, "balanceAt": null } ] } }
```

Balances are usually `null` here; they arrive with the first sync.

Idempotent: calling it again with the same reference returns the same
connection rather than making a second one, so a client that lost the response
can simply retry.

Errors: `400` for a missing reference; `403` without the permission; `404` with
`code: "NOT_FOUND"` if no pending attempt matches — which is also the answer
when the reference belongs to somebody else, deliberately, since saying "that is
not yours" would confirm it exists; `410` if the attempt expired or the
connection has since been disconnected; `502` if the approval was never
completed at the bank or GoCardless refuses.

### `GET`, `POST`, `DELETE /api/account/deletion`

User-scoped, no workspace or permission: deleting an account is not something a
workspace role grants. See section 6.

`GET` returns `{"request": null, "gracePeriodDays": 7}` or the current request:

```json
{ "request": { "id": "...", "status": "SCHEDULED", "reason": null, "requestedAt": "...", "scheduledFor": "2026-08-17T13:02:00.000Z", "cancelledAt": null, "completedAt": null, "gracePeriodDays": 7 }, "gracePeriodDays": 7 }
```

`POST` schedules one. Body: `{"confirm": "DELETE", "reason": "optional, ≤1000 chars"}`.

```json
{ "request": { "...": "as above" },
  "warnings": {
    "activeSubscriptions": [ { "workspaceId": "...", "workspaceName": "...", "plan": "PRO", "status": "ACTIVE", "currentPeriodEnd": "..." } ],
    "workspacesToDelete":  [ { "id": "...", "name": "...", "memberCount": 1 } ]
  } }
```

Show `warnings` before the user commits: those workspaces will be deleted and
those subscriptions cancelled. Repeating the call returns the existing request
with `"alreadyScheduled": true` rather than making a second one.

Errors: `400` with `code: "INVALID_CONFIRMATION"` if `confirm` is not exactly
`DELETE`; `401` with `code: "REAUTH_REQUIRED"` if the user last authenticated
more than fifteen minutes ago — sign them in again and retry; `409` with
`code: "SOLE_OWNER"` and a `workspaces` array if they are the last owner of a
workspace other people are still in; `409` with `code: "NO_EMAIL"` if the
account has no address on file.

`DELETE` cancels a scheduled deletion and returns the cancelled request.
Errors: `404` with `code: "NOT_SCHEDULED"` when there is nothing to cancel.

---

## 6. Account deletion semantics

A request is not a deletion. It schedules one **seven days** out and the account
holder can cancel it at any point until the sweep picks it up.

That window is the only defence a hijacked account has. An attacker who deletes
an account outright leaves nothing to restore; one who merely schedules it
leaves an email in the victim's inbox and a week to act. The cost is that a user
who genuinely wants out waits a week, which the confirmation email states
plainly.

Requesting deletion requires having authenticated in the last **fifteen
minutes** — the usual "sudo mode" window, long enough to cover signing in and
navigating, short enough that an unattended unlocked device is not a deletion
waiting to happen. Freshness is read from the session's own `amr` claim, which
records when each authentication method was actually used and, unlike `iat`,
does not move when the access token is refreshed. Tokens without `amr` fall back
to `iat`, which is weaker: it proves possession of a refresh token rather than
presentation of a credential.

Being the **last owner of a shared workspace blocks** the request. Other
people's data is not collateral for one member leaving, so ownership has to move
first. Membership is re-checked when the sweep runs, since it can change during
the grace period; a workspace that became blocking in the meantime is *not*
deleted — the account still goes, and the orphaned workspace is logged as an
error for a human to hand over.

An **active subscription does not block** anything. It is reported so the client
can warn, and cancelled at Stripe for real when the deletion executes, but only
for workspaces that are actually being deleted: a subscription on a workspace
that survives belongs to the members who stay.

What is erased: the Profile row and everything cascading from it, workspaces
nobody else occupies, and the Supabase Auth user. Bank and OAuth consents are
revoked at each provider first, while the tokens still exist to revoke with.

What is kept, and why: a row recording that a deletion happened, holding a
**SHA-256 hash of the email address** and no plaintext, which answers "was this
address deleted, and when" for a support or regulator question without retaining
the personal data we just promised to erase. The free-text reason is cleared on
completion, since the row outlives the account. Audit entries in workspaces that
still belong to other people survive with their `user_id` set to null, so those
workspaces keep an intact history that no longer names anyone.

Stripe cancellation, consent revocation, Auth-user removal and the emails are
all best-effort and never fail the run: a third-party outage must not make an
account undeletable, which would be the actual policy violation. Each failure is
logged as an error. The data deletion itself is the only step that can fail the
run, and a failed run is retried by the next sweep, up to five attempts.

---

## 7. Deployment configuration

### Supabase JWT signing keys

The Bearer path verifies against
`<NEXT_PUBLIC_SUPABASE_URL>/auth/v1/.well-known/jwks.json`. On a project using
asymmetric signing keys this needs **no new configuration** — the URL is already
set.

Projects still on the legacy shared HS256 secret must set `SUPABASE_JWT_SECRET`.
Prefer migrating instead (Supabase dashboard, Authentication, JWT Keys). A
symmetric secret on the API server is a key that can *mint* tokens, not merely
check them.

The key set is cached for 10 minutes with a 30-second refetch cooldown, so an
unknown key id cannot be used to hammer the auth server.

### Database migration

`prisma/migrations/0026_mobile_api` adds two tables, `pending_bank_connections`
and `account_deletion_requests`. It must be applied before deploying: the
GoCardless flow writes to the first on every connect, including the web one.

### Scheduled job

`vercel.json` gains a daily cron at 02:00 UTC hitting
`/api/cron/account-deletions`, which executes deletions whose grace period has
expired. It authenticates with the existing `CRON_SECRET`. Without it, requests
are recorded and can be cancelled but are never carried out.

### GoCardless redirect URI

No dashboard configuration is needed. GoCardless takes the callback URL as a
`redirect` field on each requisition rather than matching against a
pre-registered allow-list, so `NEXT_PUBLIC_APP_URL` is the only thing that
decides where users come back to. Preview deployments work without registering
anything.

### Everything else

No other new environment variables. `SUPABASE_SERVICE_ROLE_KEY` and
`CRON_SECRET` already exist and are reused. `SUPABASE_SERVICE_ROLE_KEY` is what
removes the Supabase Auth user on deletion; without it the data is erased but
the login survives, which is logged as an error for a human to finish.
