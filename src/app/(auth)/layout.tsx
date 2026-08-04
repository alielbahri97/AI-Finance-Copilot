import Link from "next/link";

import { BallastLogo } from "@/components/brand/ballast-mark";
import { ReportIssueButton } from "@/components/report-issue/report-issue-button";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Link href="/">
        <BallastLogo />
      </Link>
      <main id="main-content" tabIndex={-1} className="w-full max-w-sm outline-none">
        {children}
      </main>
      <ReportIssueButton />
    </div>
  );
}
