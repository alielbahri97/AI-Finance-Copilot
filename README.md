# FinPilot — AI Finance Copilot

A production-quality personal finance dashboard with an AI copilot, built with Next.js 15,
Supabase, Prisma and OpenAI/Anthropic.

## Features

- **Authentication** — email/password sign up with email confirmation, sign in, forgot/reset
  password (Supabase Auth, PKCE flow, session refresh middleware)
- **Dashboard** — balance, income, expenses and savings-rate cards, six-month cash-flow area
  chart, spending-by-category donut chart, recent activity (Recharts)
- **Transactions** — add and delete income/expense records with validated forms
  (React Hook Form + Zod)
- **AI Copilot** — chat grounded in your real transaction data, with a provider abstraction
  over OpenAI and Anthropic and persisted conversation history
- **Profile & Settings** — display name, preferred currency, AI provider choice, theme
  (light/dark/system) and password change
- **UI** — responsive layout, dark mode, toast notifications, loading skeletons, error
  boundaries, shadcn/ui component library on Tailwind CSS v4

## Tech stack

| Layer      | Technology                                        |
| ---------- | ------------------------------------------------- |
| Framework  | Next.js 15 (App Router, React 19, TypeScript)     |
| Styling    | Tailwind CSS v4, shadcn/ui, next-themes           |
| Auth       | Supabase Auth (`@supabase/ssr`)                   |
| Database   | Supabase PostgreSQL via Prisma 7 (`adapter-pg`)   |
| Forms      | React Hook Form + Zod v4                          |
| Charts     | Recharts                                          |
| AI         | OpenAI / Anthropic via a small provider interface |
| Deployment | Vercel                                            |

## Project structure

```
├── prisma/
│   ├── schema.prisma          # Profile, Transaction, Budget, ChatMessage models
│   └── seed.ts                # Demo data seeder
├── prisma.config.ts           # Prisma 7 CLI config (datasource, migrations, seed)
├── src/
│   ├── app/
│   │   ├── (auth)/            # login, signup, forgot-password, reset-password
│   │   ├── (dashboard)/       # dashboard, transactions, copilot, profile, settings
│   │   ├── api/               # transactions, profile, copilot route handlers
│   │   ├── auth/              # Supabase callback + confirm handlers
│   │   ├── error.tsx          # global error boundary
│   │   └── not-found.tsx
│   ├── components/
│   │   ├── ui/                # shadcn/ui primitives (button, card, dialog, ...)
│   │   ├── auth/              # auth forms
│   │   ├── dashboard/         # sidebar, header, charts, stat cards
│   │   ├── transactions/      # table + add-transaction dialog
│   │   ├── copilot/           # chat interface
│   │   ├── profile/ settings/ # profile & settings forms
│   │   └── theme-*.tsx        # dark mode provider/toggle
│   ├── lib/
│   │   ├── ai/                # OpenAI/Anthropic provider abstraction
│   │   ├── supabase/          # browser/server/middleware clients
│   │   ├── validations/       # Zod schemas
│   │   ├── data.ts            # server-side data access & aggregation
│   │   ├── env.ts             # validated environment variables
│   │   ├── prisma.ts          # Prisma client singleton
│   │   └── utils.ts
│   ├── generated/prisma/      # generated Prisma client (git-ignored)
│   └── middleware.ts          # session refresh + route protection
└── .env.example
```

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. In **Project Settings → API**, copy the project URL and anon key.
3. In **Project Settings → Database**, copy the pooled (port 6543) and direct (port 5432)
   connection strings.
4. Optional: in **Authentication → URL Configuration**, set the site URL and add
   `http://localhost:3000/auth/callback` to the redirect allow list.

### 3. Configure environment variables

```bash
cp .env.example .env
```

Fill in the Supabase values and at least one AI provider key (`OPENAI_API_KEY` or
`ANTHROPIC_API_KEY`).

### 4. Create the database schema

```bash
npm run db:push        # or: npm run db:migrate
```

### 5. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), create an account (confirm the email),
and start adding transactions.

### Optional: seed demo data

After signing up, grab your user id (Supabase dashboard → Authentication → Users) and run:

```bash
npm run db:seed -- <supabase-user-id> <email>
```

## Scripts

| Script               | Purpose                                  |
| -------------------- | ---------------------------------------- |
| `npm run dev`        | Start the dev server (Turbopack)         |
| `npm run build`      | Production build                         |
| `npm run start`      | Serve the production build               |
| `npm run lint`       | Run ESLint                               |
| `npm run db:push`    | Push the Prisma schema to the database   |
| `npm run db:migrate` | Create/apply a development migration     |
| `npm run db:deploy`  | Apply migrations in production           |
| `npm run db:seed`    | Seed demo transactions for a user        |
| `npm run db:studio`  | Open Prisma Studio                       |

## Deploying to Vercel

1. Push this repository to GitHub/GitLab and import it in Vercel.
2. Add all variables from `.env.example` in **Project → Settings → Environment Variables**.
3. Deploy. The build runs `prisma generate` automatically (postinstall) before `next build`.
4. Add your production URL (e.g. `https://yourapp.vercel.app/auth/callback`) to the Supabase
   auth redirect allow list, and set it as the site URL.

## Architecture notes

- **Auth**: `src/middleware.ts` refreshes the Supabase session on every request and guards
  `/dashboard`, `/transactions`, `/copilot`, `/profile` and `/settings`. Server components
  re-check the user via `supabase.auth.getUser()`.
- **Profiles**: a `profiles` row (same UUID as the Supabase auth user) is upserted on first
  authenticated visit, so no database trigger is required.
- **AI abstraction**: `src/lib/ai` exposes a tiny `AiClient` interface with `openai` and
  `anthropic` implementations over plain `fetch`; `getAiClient()` picks the user's preferred
  provider and falls back to whichever has an API key.
- **Data isolation**: every query and mutation is scoped to the authenticated user id in the
  API routes; the AI copilot only ever sees the requesting user's aggregated data.
