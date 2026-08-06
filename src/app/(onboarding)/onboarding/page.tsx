import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BallastLogo } from "@/components/brand/ballast-mark";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { PersonalOnboardingWizard } from "@/components/onboarding/personal-onboarding-wizard";
import { ReportIssueButton } from "@/components/report-issue/report-issue-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { BRAND } from "@/lib/branding";
import { getOrCreateProfile } from "@/lib/data";
import { isOnboardingDone } from "@/lib/onboarding/benchmarks";
import { isPersonalOnboardingDone } from "@/lib/onboarding/personal";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace/context";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const ctx = await getWorkspaceContext();
  const personal = ctx?.workspace.type === "PERSONAL";
  return {
    title: personal ? "Personal setup" : "Business setup",
    description: personal
      ? `Tell ${BRAND.name} about your goals for personalised recommendations.`
      : `Tell ${BRAND.name} about your business to get financial ratio guidelines.`,
    robots: { index: false, follow: false },
  };
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/login?next=/onboarding");

  const profile = await getOrCreateProfile(user);
  const ctx = await getWorkspaceContext();
  if (!ctx) redirect("/login?next=/onboarding");

  const params = await searchParams;
  const editing = params.edit === "1";
  const isPersonal = ctx.workspace.type === "PERSONAL";

  if (isPersonal) {
    const personalProfile = await prisma.personalProfile.findUnique({
      where: { userId: user.id },
    });
    if (isPersonalOnboardingDone(personalProfile) && !editing) {
      redirect("/dashboard");
    }

    return (
      <OnboardingShell>
        <PersonalOnboardingWizard
          currency={ctx.workspace.currency || profile.currency}
          allowSkip={!editing}
          returnTo={editing ? "/profile" : "/dashboard"}
          initialValues={
            personalProfile && (personalProfile.completedAt || editing)
              ? {
                  lifeStage: personalProfile.lifeStage as never,
                  primaryFocus: personalProfile.primaryFocus as never,
                  monthlyIncome:
                    personalProfile.monthlyIncome != null
                      ? Number(personalProfile.monthlyIncome)
                      : null,
                  monthlyEssentials:
                    personalProfile.monthlyEssentials != null
                      ? Number(personalProfile.monthlyEssentials)
                      : null,
                  hasDebt: personalProfile.hasDebt,
                  emergencyMonths: personalProfile.emergencyMonths,
                  notes: personalProfile.notes,
                }
              : undefined
          }
        />
      </OnboardingShell>
    );
  }

  const businessProfile = await prisma.businessProfile.findUnique({
    where: { userId: user.id },
  });

  if (isOnboardingDone(businessProfile) && !editing) {
    redirect("/dashboard");
  }

  return (
    <OnboardingShell>
      <OnboardingWizard
        currency={profile.currency}
        allowSkip={!editing}
        returnTo={editing ? "/profile" : "/dashboard"}
        initialValues={
          businessProfile && (businessProfile.completedAt || editing)
            ? {
                businessType: businessProfile.businessType,
                employeeRange: businessProfile.employeeRange,
                monthlyRent:
                  businessProfile.monthlyRent != null
                    ? Number(businessProfile.monthlyRent)
                    : null,
                monthlyRevenue:
                  businessProfile.monthlyRevenue != null
                    ? Number(businessProfile.monthlyRevenue)
                    : null,
                location: businessProfile.location,
                businessNotes: businessProfile.businessNotes,
              }
            : undefined
        }
      />
    </OnboardingShell>
  );
}

function OnboardingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-col items-center px-4 py-10">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Link href="/" className="mb-8">
        <BallastLogo />
      </Link>
      <main id="main-content" tabIndex={-1} className="w-full outline-none">
        {children}
      </main>
      <ReportIssueButton />
    </div>
  );
}
