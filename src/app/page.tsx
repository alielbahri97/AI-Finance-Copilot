import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRightIcon,
  BotIcon,
  Building2Icon,
  CheckIcon,
  LineChartIcon,
  ShieldCheckIcon,
  UserIcon,
  WalletIcon,
} from "lucide-react";

import { BallastBadge } from "@/components/brand/ballast-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ReportIssueButton } from "@/components/report-issue/report-issue-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { formatPlanPrice, getPlan, planOrder } from "@/lib/billing/plans";
import { BRAND, EDITIONS, type Edition } from "@/lib/branding";
import { isSupabaseConfigured } from "@/lib/env";
import { getUser } from "@/lib/supabase/server";
import { EDITION_PARAM } from "@/lib/workspace/editions";

export const dynamic = "force-dynamic";

/** What both editions share, so the choice is about fit rather than features. */
const SHARED_FEATURES = [
  {
    icon: WalletIcon,
    title: "Every transaction, categorised",
    description:
      "Connect your bank or drop in a CSV. Ballast works out the format, skips duplicates and files each transaction.",
  },
  {
    icon: LineChartIcon,
    title: "See where the money goes",
    description:
      "Month-over-month charts, category breakdowns and your largest expenses, without building a spreadsheet.",
  },
  {
    icon: BotIcon,
    title: "An AI copilot that reads your data",
    description:
      "Ask a question in plain language and get an answer grounded in your real numbers, not a generic tip.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Private by construction",
    description:
      "Every query is scoped to your workspace, bank tokens are encrypted at rest, and nothing is shared between accounts.",
  },
];

const CHOICE_ICONS: Record<Edition, typeof Building2Icon> = {
  business: Building2Icon,
  personal: UserIcon,
};

/** The cheapest paid tier of an edition, read from the plans module. */
function startingPrice(edition: Edition): string | null {
  for (const id of planOrder(edition)) {
    const plan = getPlan(id, edition);
    if (plan.monthlyPriceEur) return formatPlanPrice(plan);
  }
  return null;
}

function EditionChoice({ edition }: { edition: Edition }) {
  const branding = EDITIONS[edition];
  const Icon = CHOICE_ICONS[edition];
  const price = startingPrice(edition);

  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col gap-5">
        <div className="flex items-start gap-3">
          <div className="bg-accent text-accent-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
            <Icon className={`size-5 ${branding.accentClassName}`} />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{branding.choiceLabel}</h2>
            <p className="text-muted-foreground text-sm">{branding.choiceDescription}</p>
          </div>
        </div>

        <ul className="flex-1 space-y-2">
          {branding.highlights.map((highlight) => (
            <li key={highlight} className="flex items-start gap-2 text-sm">
              <CheckIcon className={`mt-0.5 size-4 shrink-0 ${branding.accentClassName}`} />
              <span className="text-muted-foreground">{highlight}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2">
          <Button size="lg" asChild>
            <Link href={`/signup?${EDITION_PARAM}=${edition}`}>
              {branding.choiceLabel}
              <ArrowRightIcon />
            </Link>
          </Button>
          <p className="text-muted-foreground text-center text-xs">
            {branding.name} · free to start{price ? `, paid plans from ${price}/month` : ""}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default async function LandingPage() {
  // The public page must render even when auth is unreachable, so a signed-in
  // visitor is only bounced to the dashboard when we positively know who they
  // are. redirect() throws, so it has to happen outside the try.
  let user = null;
  if (isSupabaseConfigured()) {
    try {
      user = await getUser();
    } catch {
      // Treat an unresolvable session as anonymous and show the marketing page.
    }
  }
  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2 font-semibold">
            <BallastBadge />
            {BRAND.name}
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild>
              <Link href="/signup">Get started</Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        <section className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-4 pt-24 pb-12 text-center sm:px-6">
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-6xl">
            {BRAND.tagline}
          </h1>
          <p className="text-muted-foreground max-w-2xl text-lg text-balance">
            {BRAND.name} turns your bank statements into clear numbers, forecasts and answers.
            It comes in two editions — pick the one that matches whose money you are looking at.
          </p>
        </section>

        <section
          aria-label="Choose your edition"
          className="mx-auto grid w-full max-w-4xl gap-4 px-4 pb-6 sm:px-6 md:grid-cols-2"
        >
          <EditionChoice edition="business" />
          <EditionChoice edition="personal" />
        </section>

        <p className="text-muted-foreground mx-auto max-w-4xl px-4 pb-20 text-center text-sm sm:px-6">
          Not sure? Start with either — you can add a workspace of the other kind later, and both
          live in the same account.
        </p>

        <section className="bg-muted/40 border-y py-16">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <h2 className="text-center text-2xl font-semibold tracking-tight">
              In both editions
            </h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {SHARED_FEATURES.map((feature) => (
                <Card key={feature.title}>
                  <CardContent className="flex flex-col gap-3">
                    <div className="bg-accent text-accent-foreground flex size-10 items-center justify-center rounded-lg">
                      <feature.icon className="size-5" />
                    </div>
                    <h3 className="font-semibold">{feature.title}</h3>
                    <p className="text-muted-foreground text-sm">{feature.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 px-4 py-16 text-center sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">Already have an account?</h2>
          <Button size="lg" variant="outline" asChild>
            <Link href="/login">Sign in to your account</Link>
          </Button>
        </section>
      </main>

      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 text-sm sm:px-6">
          <span>{BRAND.name}</span>
          <span className="hidden sm:inline">Built with Next.js, Supabase &amp; AI</span>
        </div>
      </footer>
      <ReportIssueButton />
    </div>
  );
}
