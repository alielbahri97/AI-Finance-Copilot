import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";

import { PasskeySetupPrompt } from "@/components/auth/passkey-setup-prompt";
import { DatabaseUnavailable } from "@/components/dashboard/database-unavailable";
import { Header } from "@/components/dashboard/header";
import { MobileTabBar } from "@/components/dashboard/mobile-nav";
import { Sidebar } from "@/components/dashboard/sidebar";
import { HelpLauncher } from "@/components/help/help-launcher";
import { getOrCreateProfile } from "@/lib/data";
import { classifyDatabaseFailure, describeDatabaseError } from "@/lib/db-errors";
import { logger } from "@/lib/logger";
import { isOnboardingDone } from "@/lib/onboarding/benchmarks";
import { isPersonalOnboardingDone } from "@/lib/onboarding/personal";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { localeForCurrency } from "@/lib/utils";
import { getWorkspaceContext, listUserWorkspaces } from "@/lib/workspace/context";
import { editionForWorkspaceType } from "@/lib/workspace/editions";

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
    const [profile, businessProfile, personalProfile, ctx, workspaces] = await Promise.all([
      getOrCreateProfile(user),
      // First-run business onboarding — skip once the user completes or dismisses it.
      prisma.businessProfile.findUnique({
        where: { userId: user.id },
        select: { completedAt: true, skippedAt: true },
      }),
      prisma.personalProfile.findUnique({
        where: { userId: user.id },
        select: { completedAt: true, skippedAt: true },
      }),
      getWorkspaceContext(),
      listUserWorkspaces(user.id),
    ]);
    if (!ctx) {
      redirect("/login");
    }
    // Business workspaces get industry benchmarks; Personal workspaces get a
    // short goals questionnaire. Both are skippable and revisit-able later.
    if (ctx.workspace.type === "PERSONAL") {
      if (!isPersonalOnboardingDone(personalProfile)) {
        redirect("/onboarding");
      }
    } else if (!isOnboardingDone(businessProfile)) {
      redirect("/onboarding");
    }

    return (
      <div className="flex min-h-svh">
        <Sidebar isAdmin={profile.isAdmin} workspaceType={ctx.workspace.type} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            email={profile.email}
            fullName={profile.fullName}
            avatarUrl={profile.avatarUrl}
            isAdmin={profile.isAdmin}
            workspaces={workspaces}
            currentWorkspaceId={ctx.workspace.id}
            currentWorkspaceType={ctx.workspace.type}
            locale={localeForCurrency(ctx.workspace.currency)}
          />
          <main
            id="main-content"
            tabIndex={-1}
            className="flex flex-1 flex-col p-4 pb-[calc(var(--tab-bar-height)+1.5rem)] outline-none sm:px-6 sm:pt-6"
          >
            {children}
          </main>
        </div>
        <MobileTabBar isAdmin={profile.isAdmin} workspaceType={ctx.workspace.type} />
        <HelpLauncher edition={editionForWorkspaceType(ctx.workspace.type)} />
        <PasskeySetupPrompt />
      </div>
    );
  } catch (error) {
    unstable_rethrow(error);

    // Data access still fails closed — we only render a clearer explanation
    // than an unhandled 500, never any workspace content.
    const failure = classifyDatabaseFailure(error);
    if (failure) {
      logger.error(
        failure === "schema_outdated" ? "dashboard_schema_outdated" : "dashboard_db_unavailable",
        { error: describeDatabaseError(error) }
      );
      return (
        <DatabaseUnavailable
          email={user.email}
          reason={failure === "schema_outdated" ? "schema-outdated" : "unreachable"}
        />
      );
    }

    throw error;
  }
}
