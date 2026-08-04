"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BallastBadge } from "@/components/brand/ballast-mark";
import { navItemsFor } from "@/components/dashboard/nav-items";
import { ReportIssueButton } from "@/components/report-issue/report-issue-button";
import { BRAND, editionBranding } from "@/lib/branding";
import { editionForWorkspaceType, type WorkspaceType } from "@/lib/workspace/editions";
import { cn } from "@/lib/utils";

interface SidebarProps {
  isAdmin?: boolean;
  workspaceType: WorkspaceType;
}

export function Sidebar({ isAdmin = false, workspaceType }: SidebarProps) {
  const pathname = usePathname();
  const items = navItemsFor(workspaceType, isAdmin);
  const edition = editionForWorkspaceType(workspaceType);

  return (
    <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border hidden w-60 shrink-0 flex-col border-r lg:flex">
      <div className="flex h-16 flex-col justify-center gap-0.5 border-b px-5">
        <span className="flex items-center gap-2 font-semibold">
          <BallastBadge />
          {BRAND.name}
        </span>
        <span className="text-muted-foreground pl-9 text-[0.6875rem] leading-none tracking-wide uppercase">
          {edition}
        </span>
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
        <p>Built for {editionBranding(edition).audience}</p>
        <ReportIssueButton
          variant="inline"
          className="mt-2 h-8 w-full justify-start px-2 text-xs"
        />
      </div>
    </aside>
  );
}
