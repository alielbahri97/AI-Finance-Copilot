"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BallastBadge } from "@/components/brand/ballast-mark";
import { ADMIN_NAV_ITEM, NAV_ITEMS } from "@/components/dashboard/nav-items";
import { ReportIssueButton } from "@/components/report-issue/report-issue-button";
import { BRAND, editionBranding } from "@/lib/branding";
import { cn } from "@/lib/utils";

export function Sidebar({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const items = isAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;

  return (
    <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border hidden w-60 shrink-0 flex-col border-r lg:flex">
      <div className="flex h-16 items-center gap-2 border-b px-5 font-semibold">
        <BallastBadge />
        {BRAND.name}
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {items.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="size-4.5" />
              {item.title}
            </Link>
          );
        })}
      </nav>
      <div className="text-muted-foreground border-t p-4 text-xs">
        <p>Built for {editionBranding().audience}</p>
        <ReportIssueButton
          variant="inline"
          className="mt-2 h-8 w-full justify-start px-2 text-xs"
        />
      </div>
    </aside>
  );
}
