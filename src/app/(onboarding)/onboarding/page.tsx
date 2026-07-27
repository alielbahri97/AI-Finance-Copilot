import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { WalletIcon } from "lucide-react";

import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { ThemeToggle } from "@/components/theme-toggle";
import { getOrCreateProfile } from "@/lib/data";
import { isOnboardingDone } from "@/lib/onboarding/benchmarks";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Business setup",
  description: "Tell FinPilot about your business to get financial ratio guidelines.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/login?next=/onboarding");

  const profile = await getOrCreateProfile(user);
  const businessProfile = await prisma.businessProfile.findUnique({
    where: { userId: user.id },
  });
  const params = await searchParams;
  const editing = params.edit === "1";

  // Already finished (or skipped) — send them to the app unless they asked to edit.
  if (isOnboardingDone(businessProfile) && !editing) {
    redirect("/dashboard");
  }

  return (
    <div className="relative flex min-h-svh flex-col items-center px-4 py-10">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Link href="/" className="mb-8 flex items-center gap-2 font-semibold">
        <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
          <WalletIcon className="size-4.5" />
        </div>
        FinPilot
      </Link>
      <main id="main-content" tabIndex={-1} className="w-full outline-none">
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
      </main>
    </div>
  );
}
