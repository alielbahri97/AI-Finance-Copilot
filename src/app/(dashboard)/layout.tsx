import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";

import { DatabaseUnavailable } from "@/components/dashboard/database-unavailable";
import { Header } from "@/components/dashboard/header";
import { Sidebar } from "@/components/dashboard/sidebar";
import { HelpLauncher } from "@/components/help/help-launcher";
import { getOrCreateProfile } from "@/lib/data";
import { classifyDatabaseFailure, describeDatabaseError } from "@/lib/db-errors";
import { logger } from "@/lib/logger";
import { isOnboardingDone } from "@/lib/onboarding/benchmarks";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
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
    const [profile, businessProfile, ctx, workspaces] = await Promise.all([
      getOrCreateProfile(user),
      // First-run business onboarding — skip once the user completes or dismisses it.
      prisma.businessProfile.findUnique({
        where: { userId: user.id },
        select: { completedAt: true, skippedAt: true },
      }),
      getWorkspaceContext(),
      listUserWorkspaces(user.id),
    ]);
    if (!ctx) {
      redirect("/login");
    }
    // The onboarding wizard asks for business type, headcount and rent to pick
    // industry benchmarks. None of that applies to a person's own money, so a
    // Personal workspace goes straight to the dashboard.
    if (ctx.workspace.type !== "PERSONAL" && !isOnboardingDone(businessProfile)) {
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
          />
          <main id="main-content" tabIndex={-1} className="flex-1 p-4 outline-none sm:p-6">
            {children}
          </main>
        </div>
        <HelpLauncher edition={editionForWorkspaceType(ctx.workspace.type)} />
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
