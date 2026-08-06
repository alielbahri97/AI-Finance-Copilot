import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  BotIcon,
  CreditCardIcon,
  DollarSignIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";

import { EventsChart, SignupsChart } from "@/components/admin/admin-charts-lazy";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeading } from "@/components/ui/page-heading";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAdminStats, getAdminUsers, requireAdmin } from "@/lib/admin/stats";
import { PLANS } from "@/lib/billing/plans";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function AdminPage() {
  const adminId = await requireAdmin();
  if (!adminId) redirect("/dashboard");

  const [stats, users] = await Promise.all([getAdminStats(), getAdminUsers()]);
  const { kpis } = stats;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageHeading>Admin</PageHeading>
        <p className="text-muted-foreground text-sm">
          Users, subscriptions and product analytics.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          title="Total users"
          value={kpis.totalUsers.toLocaleString()}
          hint="All registered accounts"
          icon={UsersIcon}
        />
        <StatCard
          title="Active subscriptions"
          value={kpis.activeSubscriptions.toLocaleString()}
          hint="Paid plans incl. trialing"
          icon={CreditCardIcon}
        />
        <StatCard
          title="MRR estimate"
          value={`$${kpis.mrrEstimate.toLocaleString()}`}
          hint="From plan list prices"
          icon={DollarSignIcon}
        />
        <StatCard
          title="Signups (30d)"
          value={kpis.signupsLast30d.toLocaleString()}
          hint="New accounts, last 30 days"
          icon={UserPlusIcon}
        />
        <StatCard
          title="AI messages (month)"
          value={kpis.aiMessagesThisMonth.toLocaleString()}
          hint="Across all users this month"
          icon={BotIcon}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Signups per day</CardTitle>
            <CardDescription>Last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <SignupsChart data={stats.signupsPerDay} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top events</CardTitle>
            <CardDescription>Internal analytics events, last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <EventsChart data={stats.topEvents} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>Most recent {users.length} accounts</CardDescription>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <EmptyState
              className="py-8"
              icon={UsersIcon}
              title="No users yet"
              description="Every account that signs up is listed here, newest first."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="text-right">AI msgs (mo)</TableHead>
                    <TableHead className="text-right">Imports (mo)</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="flex items-center gap-2 font-medium">
                            {user.fullName ?? user.email}
                            {user.isAdmin && (
                              <Badge variant="outline" className="text-2xs">
                                Admin
                              </Badge>
                            )}
                          </span>
                          {user.fullName && (
                            <span className="text-muted-foreground text-xs">{user.email}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.plan === "FREE" ? "secondary" : "default"}>
                          {PLANS[user.plan].name}
                          {user.isTrial ? " (trial)" : ""}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {user.aiMessagesThisMonth.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {user.csvImportsThisMonth.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(user.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
