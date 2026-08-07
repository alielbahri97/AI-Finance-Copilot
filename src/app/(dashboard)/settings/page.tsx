import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AiCategorizationForm } from "@/components/settings/ai-categorization-form";
import { AiProviderForm } from "@/components/settings/ai-provider-form";
import { AppearanceForm } from "@/components/settings/appearance-form";
import { AutoDunningForm } from "@/components/settings/auto-dunning-form";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { PasskeySettings } from "@/components/settings/passkey-settings";
import { CurrencySettingsForm } from "@/components/settings/currency-settings-form";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { AuditLog, type AuditEntryView } from "@/components/team/audit-log";
import { TeamSettings, type TeamMemberView } from "@/components/team/team-settings";
import { WorkspaceNameForm } from "@/components/team/workspace-name-form";
import {
  AuditExportButton,
  FullDataExportButton,
} from "@/components/exports/surface-export-buttons";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeading } from "@/components/ui/page-heading";
import { Separator } from "@/components/ui/separator";
import { getEntitlements } from "@/lib/billing/entitlements";
import { BRAND } from "@/lib/branding";
import { getOrCreateProfile } from "@/lib/data";
import { isEmailConfigured } from "@/lib/notifications/email";
import { getOrCreatePreferences, serializePreferences } from "@/lib/notifications/preferences";
import { isPushConfigured } from "@/lib/notifications/push";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext } from "@/lib/workspace/context";
import { editionHasFeature } from "@/lib/workspace/editions";
import { parseOverrides, type WorkspaceRoleName } from "@/lib/workspace/permissions";
import { SUPPORTED_CURRENCIES } from "@/lib/validations/profile";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await getWorkspaceContext();
  if (!ctx) redirect("/login");
  const { user, workspace } = ctx;
  const canManageMembers = ctx.permissions.has("manage_members");
  const canManageSettings = ctx.permissions.has("manage_settings");
  const canExport = ctx.permissions.has("export_data");
  const sharing = editionHasFeature(workspace.type, "team");

  const [profile, preferences, businessProfile, entitlements, members, invitations, auditEntries] =
    await Promise.all([
      getOrCreateProfile(user),
      getOrCreatePreferences(user.id),
      prisma.businessProfile.findUnique({
        where: { userId: user.id },
        select: { location: true },
      }),
      getEntitlements(workspace.id),
      prisma.workspaceMember.findMany({
        where: { workspaceId: workspace.id },
        orderBy: { joinedAt: "asc" },
        select: {
          id: true,
          userId: true,
          role: true,
          permissions: true,
          joinedAt: true,
          profile: { select: { fullName: true, email: true } },
        },
      }),
      canManageMembers
        ? prisma.workspaceInvitation.findMany({
            where: {
              workspaceId: workspace.id,
              acceptedAt: null,
              revokedAt: null,
              expiresAt: { gt: new Date() },
            },
            orderBy: { createdAt: "desc" },
            select: { id: true, email: true, role: true, expiresAt: true },
          })
        : Promise.resolve([]),
      canManageMembers
        ? prisma.auditLog.findMany({
            where: { workspaceId: workspace.id },
            orderBy: { createdAt: "desc" },
            take: 50,
            select: {
              id: true,
              action: true,
              detail: true,
              createdAt: true,
              profile: { select: { fullName: true, email: true } },
            },
          })
        : Promise.resolve([]),
    ]);

  const currency = (SUPPORTED_CURRENCIES as readonly string[]).includes(workspace.currency)
    ? (workspace.currency as (typeof SUPPORTED_CURRENCIES)[number])
    : "USD";

  const memberViews: TeamMemberView[] = members.map((member) => ({
    id: member.id,
    userId: member.userId,
    name: member.profile.fullName,
    email: member.profile.email,
    role: member.role as WorkspaceRoleName,
    joinedAt: member.joinedAt.toISOString(),
    overrides: parseOverrides(member.permissions),
  }));

  const auditViews: AuditEntryView[] = auditEntries.map((entry) => ({
    id: entry.id,
    action: entry.action,
    actor: entry.profile ? (entry.profile.fullName ?? entry.profile.email) : null,
    detail: entry.detail,
    createdAt: entry.createdAt,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <PageHeading>Settings</PageHeading>
        <p className="text-muted-foreground text-sm">
          {sharing
            ? "Workspace, team, appearance, and security."
            : "Workspace, appearance, and security."}
        </p>
      </div>

      {/*
        A Personal workspace is one person's own money: the workspace model is
        unchanged underneath, but there is nobody to invite, so the Team card
        collapses to just renaming the workspace. The member APIs need
        `manage_members`, which this edition never grants.
      */}
      {sharing ? (
        <Card>
          <CardHeader>
            <CardTitle>Team — {workspace.name}</CardTitle>
            <CardDescription>
              {canManageMembers
                ? "Invite people to this workspace and control what each member can access."
                : "People who share this workspace with you."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {canManageSettings && <WorkspaceNameForm defaultName={workspace.name} />}
            <TeamSettings
              currentUserId={user.id}
              actorRole={ctx.role as WorkspaceRoleName}
              canManage={canManageMembers}
              members={memberViews}
              invitations={invitations.map((invitation) => ({
                id: invitation.id,
                email: invitation.email,
                role: invitation.role as WorkspaceRoleName,
                expiresAt: invitation.expiresAt.toISOString(),
              }))}
              seatLimit={entitlements.plan.limits.seats}
              planName={entitlements.plan.name}
            />
          </CardContent>
        </Card>
      ) : (
        canManageSettings && (
          <Card>
            <CardHeader>
              <CardTitle>Workspace</CardTitle>
              <CardDescription>
                What this workspace is called in the switcher and in emails.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <WorkspaceNameForm defaultName={workspace.name} />
            </CardContent>
          </Card>
        )
      )}

      {canManageMembers && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle>Audit log</CardTitle>
              <CardDescription>
                Recent member, billing and data changes in this workspace.
              </CardDescription>
            </div>
            {canExport && <AuditExportButton />}
          </CardHeader>
          <CardContent>
            <AuditLog entries={auditViews} />
          </CardContent>
        </Card>
      )}

      {canExport && (
        <Card>
          <CardHeader>
            <CardTitle>Full data export</CardTitle>
            <CardDescription>
              Download everything in this workspace as a ZIP of CSV and JSON files. Always free —
              useful for backups and data-portability requests.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FullDataExportButton />
          </CardContent>
        </Card>
      )}

      {canManageSettings && (
        <Card>
          <CardHeader>
            <CardTitle>Workspace currency</CardTitle>
            <CardDescription>
              Amounts across this workspace use this currency. It follows your location when
              possible.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CurrencySettingsForm
              defaultCurrency={currency}
              locationHint={businessProfile?.location}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Choose how {BRAND.name} looks on this device.</CardDescription>
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

      {canManageSettings && (
        <Card>
          <CardHeader>
            <CardTitle>AI categorization</CardTitle>
            <CardDescription>
              Whether imported transactions your rules don&apos;t cover are categorized
              automatically.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AiCategorizationForm
              defaultEnabled={workspace.aiCategorizationEnabled}
              monthlyLimit={entitlements.plan.limits.aiCategorizationPerMonth}
              used={entitlements.usage.aiCategorizations}
            />
          </CardContent>
        </Card>
      )}

      {canManageSettings && editionHasFeature(workspace.type, "invoices") && (
        <Card>
          <CardHeader>
            <CardTitle>Customer payment reminders</CardTitle>
            <CardDescription>
              Whether {BRAND.name} chases your unpaid invoices for you, or only when you ask.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {entitlements.plan.limits.dunningEnabled ? (
              <AutoDunningForm
                defaultEnabled={workspace.autoDunningEnabled}
                emailConfigured={isEmailConfigured()}
              />
            ) : (
              <p className="text-muted-foreground text-sm">
                Reminding customers is part of the paid plans. Upgrade on the Billing page to
                have {BRAND.name} draft and send them for you.
              </p>
            )}
          </CardContent>
        </Card>
      )}

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

      <Card id="security">
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>
            Manage your password and biometric / passkey sign-in.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <PasskeySettings />
          <Separator />
          <div className="space-y-1">
            <p className="text-sm font-medium">Password</p>
            <p className="text-muted-foreground text-sm">
              Change the password you use when biometric or passkey sign-in is unavailable.
            </p>
          </div>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
