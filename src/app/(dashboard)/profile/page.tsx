import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BusinessProfileCard } from "@/components/profile/business-profile-card";
import { ProfileForm } from "@/components/profile/profile-form";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PageHeading } from "@/components/ui/page-heading";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getOrCreateProfile } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { SUPPORTED_CURRENCIES } from "@/lib/validations/profile";
import { getInitials } from "@/lib/utils";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const profile = await getOrCreateProfile(user);
  const businessProfile = await prisma.businessProfile.findUnique({
    where: { userId: user.id },
  });
  const currency = (SUPPORTED_CURRENCIES as readonly string[]).includes(profile.currency)
    ? (profile.currency as (typeof SUPPORTED_CURRENCIES)[number])
    : "USD";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Avatar className="size-14">
          {profile.avatarUrl ? (
            <AvatarImage src={profile.avatarUrl} alt={profile.fullName ?? profile.email} />
          ) : null}
          <AvatarFallback className="text-base">
            {getInitials(profile.fullName, profile.email)}
          </AvatarFallback>
        </Avatar>
        <div>
          <PageHeading>
            {profile.fullName ?? "Your profile"}
          </PageHeading>
          <p className="text-muted-foreground text-sm">{profile.email}</p>
        </div>
      </div>

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
    </div>
  );
}
