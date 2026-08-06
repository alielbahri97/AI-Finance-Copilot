import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AvatarUploader } from "@/components/profile/avatar-uploader";
import { BusinessProfileCard } from "@/components/profile/business-profile-card";
import { ProfileForm } from "@/components/profile/profile-form";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/page-heading";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getOrCreateProfile } from "@/lib/data";
import {
  LIFE_STAGE_LABELS,
  PRIMARY_FOCUS_LABELS,
  type LifeStageId,
  type PrimaryFocusId,
} from "@/lib/onboarding/personal";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { SUPPORTED_CURRENCIES } from "@/lib/validations/profile";
import { getWorkspaceContext } from "@/lib/workspace/context";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const [profile, businessProfile, personalProfile, ctx] = await Promise.all([
    getOrCreateProfile(user),
    prisma.businessProfile.findUnique({ where: { userId: user.id } }),
    prisma.personalProfile.findUnique({ where: { userId: user.id } }),
    getWorkspaceContext(),
  ]);
  if (!ctx) redirect("/login");

  const currency = (SUPPORTED_CURRENCIES as readonly string[]).includes(profile.currency)
    ? (profile.currency as (typeof SUPPORTED_CURRENCIES)[number])
    : "USD";
  const isPersonal = ctx.workspace.type === "PERSONAL";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageHeading>{profile.fullName ?? "Your profile"}</PageHeading>
        <p className="text-muted-foreground text-sm">{profile.email}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile photo</CardTitle>
          <CardDescription>
            Shown in the header and on your profile. JPG, PNG or WebP up to 5 MB.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AvatarUploader
            email={profile.email}
            fullName={profile.fullName}
            avatarUrl={profile.avatarUrl}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Personal information</CardTitle>
          <CardDescription>Update your name and display preferences.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            email={profile.email}
            locationHint={businessProfile?.location}
            defaultValues={{ fullName: profile.fullName ?? "", currency }}
          />
        </CardContent>
      </Card>

      {isPersonal ? (
        <Card>
          <CardHeader>
            <CardTitle>Goals questionnaire</CardTitle>
            <CardDescription>
              Answers that drive suggested savings goals and planning tips.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {personalProfile?.completedAt ? (
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Life stage</dt>
                  <dd className="font-medium">
                    {LIFE_STAGE_LABELS[personalProfile.lifeStage as LifeStageId] ??
                      personalProfile.lifeStage}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Primary focus</dt>
                  <dd className="font-medium">
                    {PRIMARY_FOCUS_LABELS[personalProfile.primaryFocus as PrimaryFocusId] ??
                      personalProfile.primaryFocus}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-muted-foreground text-sm">
                {personalProfile?.skippedAt
                  ? "You skipped this earlier — you can fill it in anytime."
                  : "Not completed yet."}
              </p>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href="/onboarding?edit=1">
                {personalProfile?.completedAt ? "Update answers" : "Start questionnaire"}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Business profile</CardTitle>
            <CardDescription>
              Industry context and financial ratio guidelines for your business type.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {businessProfile ? (
              <BusinessProfileCard
                currency={currency}
                businessType={businessProfile.businessType}
                employeeRange={businessProfile.employeeRange}
                monthlyRent={
                  businessProfile.monthlyRent != null ? Number(businessProfile.monthlyRent) : null
                }
                monthlyRevenue={
                  businessProfile.monthlyRevenue != null
                    ? Number(businessProfile.monthlyRevenue)
                    : null
                }
                location={businessProfile.location}
                businessNotes={businessProfile.businessNotes}
                completedAt={businessProfile.completedAt?.toISOString() ?? null}
                skippedAt={businessProfile.skippedAt?.toISOString() ?? null}
              />
            ) : (
              <BusinessProfileCard
                currency={currency}
                businessType="OTHER"
                employeeRange="SOLO"
                monthlyRent={null}
                monthlyRevenue={null}
                location={null}
                businessNotes={null}
                completedAt={null}
                skippedAt={null}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
