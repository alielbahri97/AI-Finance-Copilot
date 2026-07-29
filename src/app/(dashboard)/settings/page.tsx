import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AiProviderForm } from "@/components/settings/ai-provider-form";
import { AppearanceForm } from "@/components/settings/appearance-form";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { CurrencySettingsForm } from "@/components/settings/currency-settings-form";
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
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { SUPPORTED_CURRENCIES } from "@/lib/validations/profile";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const profile = await getOrCreateProfile(user);
  const preferences = await getOrCreatePreferences(user.id);
  const businessProfile = await prisma.businessProfile.findUnique({
    where: { userId: user.id },
    select: { location: true },
  });
  const currency = (SUPPORTED_CURRENCIES as readonly string[]).includes(profile.currency)
    ? (profile.currency as (typeof SUPPORTED_CURRENCIES)[number])
    : "USD";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Manage your currency, appearance, AI provider and account security.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Preferred currency</CardTitle>
          <CardDescription>
            Amounts across FinPilot use this currency. It follows your location when possible.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CurrencySettingsForm
            defaultCurrency={currency}
            locationHint={businessProfile?.location}
          />
        </CardContent>
      </Card>

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
