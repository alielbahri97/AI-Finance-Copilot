import "server-only";

import { currentPeriod, resolvePlanId } from "@/lib/billing/entitlements";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
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
  /** Estimated MRR in USD from plan list prices. */
  mrrEstimate: number;
  signupsLast30d: number;
  aiMessagesThisMonth: number;
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

  const [totalUsers, signupsLast30d, paidSubscriptions, usageAggregate, recentProfiles, events] =
    await Promise.all([
      prisma.profile.count(),
      prisma.profile.count({ where: { createdAt: { gte: since30d } } }),
      prisma.subscription.findMany({
        where: {
          plan: { not: "FREE" },
          status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
        },
        select: { plan: true },
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

  const mrrEstimate = paidSubscriptions.reduce(
    (sum, subscription) => sum + (PLANS[subscription.plan].monthlyPriceUsd ?? 0),
    0
  );

  return {
    kpis: {
      totalUsers,
      activeSubscriptions: paidSubscriptions.length,
      mrrEstimate,
      signupsLast30d,
      aiMessagesThisMonth: usageAggregate._sum.aiMessages ?? 0,
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
  const [subscriptions, usageRecords] = await Promise.all([
    prisma.subscription.findMany({ where: { workspaceId: { in: workspaceIds } } }),
    prisma.usageRecord.findMany({ where: { workspaceId: { in: workspaceIds }, period } }),
  ]);
  const subscriptionByWorkspace = new Map(subscriptions.map((s) => [s.workspaceId, s]));
  const usageByWorkspace = new Map(usageRecords.map((u) => [u.workspaceId, u]));

  return profiles.map((profile) => {
    const workspaceId = personalWorkspaceId(profile.id);
    const subscription = subscriptionByWorkspace.get(workspaceId) ?? null;
    const resolved = subscription
      ? resolvePlanId(subscription)
      : { planId: "FREE" as PlanId, isTrial: false };
    const usage = usageByWorkspace.get(workspaceId);
    return {
      id: profile.id,
      email: profile.email,
      fullName: profile.fullName,
      plan: resolved.planId,
      isTrial: resolved.isTrial,
      subscriptionStatus: subscription?.status ?? null,
      aiMessagesThisMonth: usage?.aiMessages ?? 0,
      csvImportsThisMonth: usage?.csvImports ?? 0,
      isAdmin: profile.isAdmin,
      createdAt: profile.createdAt.toISOString(),
    };
  });
}
