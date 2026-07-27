import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AiProviderForm } from "@/components/settings/ai-provider-form";
import { AppearanceForm } from "@/components/settings/appearance-form";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { NotificationSettings } from "@/components/settings/notification-settings";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getOrCreateProfile } from "@/lib/data";
import { isEmailConfigured } from "@/lib/notifications/email";
import { getOrCreatePreferences, serializePreferences } from "@/lib/notifications/preferences";
import { isPushConfigured } from "@/lib/notifications/push";
import { getUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const profile = await getOrCreateProfile(user);
  const preferences = await getOrCreatePreferences(user.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Manage your appearance, AI provider and account security.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Choose how FinPilot looks on this device.</CardDescription>
        </CardHeader>
        <CardContent>
          <AppearanceForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI provider</CardTitle>
          <CardDescription>Pick which model powers your copilot.</CardDescription>
        </CardHeader>
        <CardContent>
          <AiProviderForm defaultProvider={profile.aiProvider} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>
            Choose which summaries and alerts you receive, and on which channels.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationSettings
            initial={serializePreferences(preferences)}
            emailConfigured={isEmailConfigured()}
            pushConfigured={isPushConfigured()}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>Change the password you use to sign in.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
