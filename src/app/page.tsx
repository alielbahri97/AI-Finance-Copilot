import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRightIcon, BotIcon, LineChartIcon, ShieldCheckIcon, WalletIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ReportIssueButton } from "@/components/report-issue/report-issue-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { isSupabaseConfigured } from "@/lib/env";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    icon: WalletIcon,
    title: "Track every transaction",
    description: "Log income and expenses in seconds with categories that make sense.",
  },
  {
    icon: LineChartIcon,
    title: "Visualize your money",
    description: "Interactive charts show where your money goes, month over month.",
  },
  {
    icon: BotIcon,
    title: "AI-powered insights",
    description: "Ask the copilot anything about your finances and get grounded answers.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Private and secure",
    description: "Your data is protected by Supabase authentication and row-level isolation.",
  },
];

export default async function LandingPage() {
  if (isSupabaseConfigured()) {
    const user = await getUser();
    if (user) {
      redirect("/dashboard");
    }
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2 font-semibold">
            <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
              <WalletIcon className="size-4.5" />
            </div>
            FinPilot
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
        <section className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-4 py-24 text-center sm:px-6">
          <span className="bg-accent text-accent-foreground rounded-full px-3 py-1 text-xs font-medium">
            For small and medium-sized businesses
          </span>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-6xl">
            Understand your money with an AI copilot by your side
          </h1>
          <p className="text-muted-foreground max-w-2xl text-lg text-balance">
            FinPilot tracks income and expenses, turns them into clear insights, and answers your
            financial questions with AI grounded in real data.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button size="lg" asChild>
              <Link href="/signup">
                Start for free
                <ArrowRightIcon />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/login">Sign in to your account</Link>
            </Button>
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-6xl gap-4 px-4 pb-24 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {FEATURES.map((feature) => (
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
        </section>
      </main>

      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 text-sm sm:px-6">
          <span>FinPilot</span>
          <div className="flex items-center gap-2">
            <ReportIssueButton variant="inline" className="h-8" />
            <span className="hidden sm:inline">Built with Next.js, Supabase &amp; AI</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
