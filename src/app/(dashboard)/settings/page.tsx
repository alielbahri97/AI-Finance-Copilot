import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AiProviderForm } from "@/components/settings/ai-provider-form";
import { AppearanceForm } from "@/components/settings/appearance-form";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { CurrencySettingsForm } from "@/components/settings/currency-settings-form";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { AuditLog, type AuditEntryView } from "@/components/team/audit-log";
import { TeamSettings, type TeamMemberView } from "@/components/team/team-settings";
import { WorkspaceNameForm } from "@/components/team/workspace-name-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getOrCreateProfile } from "@/lib/data";
import { isEmailConfigured } from "@/lib/notifications/email";
import { getOrCreatePreferences, serializePreferences } from "@/lib/notifications/preferences";
import { isPushConfigured } from "@/lib/notifications/push";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext } from "@/lib/workspace/context";
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Manage your workspace, team, appearance, AI provider and account security.
        </p>
      </div>

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

      {canManageMembers && (
        <Card>
          <CardHeader>
            <CardTitle>Audit log</CardTitle>
            <CardDescription>
              Recent member, billing and data changes in this workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AuditLog entries={auditViews} />
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
