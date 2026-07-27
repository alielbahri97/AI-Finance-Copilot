import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Header } from "@/components/dashboard/header";
import { Sidebar } from "@/components/dashboard/sidebar";
import { getOrCreateProfile } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";

// Everything behind login is per-user data; keep it out of search engines.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

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
        <main id="main-content" tabIndex={-1} className="flex-1 p-4 outline-none sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
