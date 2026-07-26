import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ProfileForm } from "@/components/profile/profile-form";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getOrCreateProfile } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { SUPPORTED_CURRENCIES } from "@/lib/validations/profile";
import { getInitials } from "@/lib/utils";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const profile = await getOrCreateProfile(user);
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
          <h1 className="text-2xl font-bold tracking-tight">
            {profile.fullName ?? "Your profile"}
          </h1>
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
            defaultValues={{ fullName: profile.fullName ?? "", currency }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
