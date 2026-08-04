import "server-only";

import { currentPeriod, resolvePlanId } from "@/lib/billing/entitlements";
import { getPlan, type PlanId } from "@/lib/billing/plans";
import type { Edition } from "@/lib/branding";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { editionForWorkspaceType } from "@/lib/workspace/editions";
import { personalWorkspaceId } from "@/lib/workspace/ids";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Returns the authenticated admin's user id, or null when not an admin. */
export async function requireAdmin(): Promise<string | null> {
  const user = await getUser();
  if (!user) return null;
  const profile = await prisma.profile.findUnique({
    where: { id: user.id },
    select: { isAdmin: true },
  });
  return profile?.isAdmin ? user.id : null;
}

export interface AdminKpis {
  totalUsers: number;
  activeSubscriptions: number;
  /** Estimated MRR in EUR from plan list prices. */
  mrrEstimate: number;
  signupsLast30d: number;
  aiMessagesThisMonth: number;
  /** Workspaces per edition, which is how adoption of Personal is read. */
  businessWorkspaces: number;
  personalWorkspaces: number;
}

export interface DayPoint {
  date: string;
  count: number;
}

export interface EventCount {
  name: string;
  count: number;
}

export interface AdminStats {
  kpis: AdminKpis;
  signupsPerDay: DayPoint[];
  topEvents: EventCount[];
}

export interface AdminUserRow {
  id: string;
  email: string;
  fullName: string | null;
  plan: PlanId;
  edition: Edition;
  isTrial: boolean;
  subscriptionStatus: string | null;
  aiMessagesThisMonth: number;
  csvImportsThisMonth: number;
  isAdmin: boolean;
  createdAt: string;
}

export async function getAdminStats(): Promise<AdminStats> {
  const now = new Date();
  const since30d = new Date(now.getTime() - 30 * MS_PER_DAY);
  const period = currentPeriod(now);

  const [
    totalUsers,
    signupsLast30d,
    paidSubscriptions,
    usageAggregate,
    recentProfiles,
    events,
    workspacesByType,
  ] = await Promise.all([
      prisma.profile.count(),
      prisma.profile.count({ where: { createdAt: { gte: since30d } } }),
      prisma.subscription.findMany({
        where: {
          plan: { not: "FREE" },
          status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
        },
        // The workspace's edition decides which tier definition — and so which
        // list price — the stored plan id means.
        select: { plan: true, workspace: { select: { type: true } } },
      }),
      prisma.usageRecord.aggregate({
        where: { period },
        _sum: { aiMessages: true },
      }),
      prisma.profile.findMany({
        where: { createdAt: { gte: since30d } },
        select: { createdAt: true },
      }),
      prisma.analyticsEvent.groupBy({
        by: ["name"],
        where: { createdAt: { gte: since30d } },
        _count: { name: true },
        orderBy: { _count: { name: "desc" } },
        take: 8,
      }),
      prisma.workspace.groupBy({ by: ["type"], _count: { type: true } }),
    ]);

  // Signups per day over the last 30 days (zero-filled).
  const signupsByDay = new Map<string, number>();
  for (let i = 29; i >= 0; i -= 1) {
    const day = new Date(now.getTime() - i * MS_PER_DAY).toISOString().slice(0, 10);
    signupsByDay.set(day, 0);
  }
  for (const profile of recentProfiles) {
    const day = profile.createdAt.toISOString().slice(0, 10);
    if (signupsByDay.has(day)) {
      signupsByDay.set(day, (signupsByDay.get(day) ?? 0) + 1);
    }
  }

  const mrrEstimate = paidSubscriptions.reduce((sum, subscription) => {
    const edition = editionForWorkspaceType(subscription.workspace.type);
    return sum + (getPlan(subscription.plan, edition).monthlyPriceEur ?? 0);
  }, 0);

  const countOfType = (type: "BUSINESS" | "PERSONAL") =>
    workspacesByType.find((row) => row.type === type)?._count.type ?? 0;

  return {
    kpis: {
      totalUsers,
      activeSubscriptions: paidSubscriptions.length,
      mrrEstimate,
      signupsLast30d,
      aiMessagesThisMonth: usageAggregate._sum.aiMessages ?? 0,
      businessWorkspaces: countOfType("BUSINESS"),
      personalWorkspaces: countOfType("PERSONAL"),
    },
    signupsPerDay: [...signupsByDay.entries()].map(([date, count]) => ({ date, count })),
    topEvents: events.map((event) => ({ name: event.name, count: event._count.name })),
  };
}

export async function getAdminUsers(limit = 200): Promise<AdminUserRow[]> {
  const period = currentPeriod();
  const profiles = await prisma.profile.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      email: true,
      fullName: true,
      isAdmin: true,
      createdAt: true,
    },
  });

  // Billing is workspace-scoped now; the admin table shows each user's
  // personal-workspace plan and usage.
  const workspaceIds = profiles.map((profile) => personalWorkspaceId(profile.id));
  const [subscriptions, usageRecords, workspaces] = await Promise.all([
    prisma.subscription.findMany({ where: { workspaceId: { in: workspaceIds } } }),
    prisma.usageRecord.findMany({ where: { workspaceId: { in: workspaceIds }, period } }),
    prisma.workspace.findMany({
      where: { id: { in: workspaceIds } },
      select: { id: true, type: true },
    }),
  ]);
  const subscriptionByWorkspace = new Map(subscriptions.map((s) => [s.workspaceId, s]));
  const usageByWorkspace = new Map(usageRecords.map((u) => [u.workspaceId, u]));
  const typeByWorkspace = new Map(workspaces.map((w) => [w.id, w.type]));

  return profiles.map((profile) => {
    const workspaceId = personalWorkspaceId(profile.id);
    const edition = editionForWorkspaceType(typeByWorkspace.get(workspaceId) ?? "BUSINESS");
    const subscription = subscriptionByWorkspace.get(workspaceId) ?? null;
    const resolved = subscription
      ? resolvePlanId(subscription, edition)
      : { planId: "FREE" as PlanId, isTrial: false };
    const usage = usageByWorkspace.get(workspaceId);
    return {
      id: profile.id,
      email: profile.email,
      fullName: profile.fullName,
      plan: resolved.planId,
      edition,
      isTrial: resolved.isTrial,
      subscriptionStatus: subscription?.status ?? null,
      aiMessagesThisMonth: usage?.aiMessages ?? 0,
      csvImportsThisMonth: usage?.csvImports ?? 0,
      isAdmin: profile.isAdmin,
      createdAt: profile.createdAt.toISOString(),
    };
  });
}
