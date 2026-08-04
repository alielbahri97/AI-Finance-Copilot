import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";

import { DatabaseUnavailable } from "@/components/dashboard/database-unavailable";
import { Header } from "@/components/dashboard/header";
import { Sidebar } from "@/components/dashboard/sidebar";
import { HelpLauncher } from "@/components/help/help-launcher";
import { getOrCreateProfile } from "@/lib/data";
import { describeDatabaseError, isDatabaseUnavailable } from "@/lib/db-errors";
import { logger } from "@/lib/logger";
import { isOnboardingDone } from "@/lib/onboarding/benchmarks";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";

// Everything behind login is per-user data; keep it out of search engines.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) {
    redirect("/login");
  }

  try {
    const [profile, businessProfile] = await Promise.all([
      getOrCreateProfile(user),
      // First-run business onboarding — skip once the user completes or dismisses it.
      prisma.businessProfile.findUnique({
        where: { userId: user.id },
        select: { completedAt: true, skippedAt: true },
      }),
    ]);
    if (!isOnboardingDone(businessProfile)) {
      redirect("/onboarding");
    }

    return (
      <div className="flex min-h-svh">
        <Sidebar isAdmin={profile.isAdmin} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            email={profile.email}
            fullName={profile.fullName}
            avatarUrl={profile.avatarUrl}
            isAdmin={profile.isAdmin}
          />
          <main id="main-content" tabIndex={-1} className="flex-1 p-4 outline-none sm:p-6">
            {children}
          </main>
        </div>
        <HelpLauncher />
      </div>
    );
  } catch (error) {
    unstable_rethrow(error);

    if (isDatabaseUnavailable(error)) {
      logger.error("dashboard_db_unavailable", {
        error: describeDatabaseError(error),
      });
      return <DatabaseUnavailable email={user.email} />;
    }

    throw error;
  }
}
