import Link from "next/link";

import { BallastLogo } from "@/components/brand/ballast-mark";
import { ReportIssueButton } from "@/components/report-issue/report-issue-button";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-8 overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,oklch(0.5_0.22_255/0.08),transparent_55%)] dark:bg-[radial-gradient(ellipse_at_top,oklch(0.57_0.19_255/0.14),transparent_50%)]"
      />
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Link href="/" className="transition-opacity hover:opacity-90">
        <BallastLogo />
      </Link>
      <main id="main-content" tabIndex={-1} className="w-full max-w-sm outline-none">
        {children}
      </main>
      <ReportIssueButton />
    </div>
  );
}
