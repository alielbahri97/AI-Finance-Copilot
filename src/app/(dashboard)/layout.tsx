import { redirect } from "next/navigation";

import { Header } from "@/components/dashboard/header";
import { Sidebar } from "@/components/dashboard/sidebar";
import { getOrCreateProfile } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) {
    redirect("/login");
  }

  const profile = await getOrCreateProfile(user);

  return (
    <div className="flex min-h-svh">
      <Sidebar isAdmin={profile.isAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          email={profile.email}
          fullName={profile.fullName}
          avatarUrl={profile.avatarUrl}
          isAdmin={profile.isAdmin}
        />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
