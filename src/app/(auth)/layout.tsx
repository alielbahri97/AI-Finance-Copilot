import Link from "next/link";
import { WalletIcon } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";

/** Auth screens (login/signup/reset) — no report-issue FAB before login. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Link href="/" className="flex items-center gap-2 font-semibold">
        <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
          <WalletIcon className="size-4.5" />
        </div>
        FinPilot
      </Link>
      <main id="main-content" tabIndex={-1} className="w-full max-w-sm outline-none">
        {children}
      </main>
    </div>
  );
}
