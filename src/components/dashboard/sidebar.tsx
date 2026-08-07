"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDownIcon } from "lucide-react";

import { BallastBadge } from "@/components/brand/ballast-mark";
import { navSectionsFor, type NavItem } from "@/components/dashboard/nav-items";
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
  const sections = navSectionsFor(workspaceType, isAdmin);
  const edition = editionForWorkspaceType(workspaceType);
  const [accountExpanded, setAccountExpanded] = useState(false);

  const primarySections = sections.filter((section) => section.id !== "account");
  const accountSection = sections.find((section) => section.id === "account");
  const accountItems = accountSection?.items ?? [];
  const isAccountRoute = accountItems.some((item) => pathname.startsWith(item.href));
  const showAccountItems = accountExpanded || isAccountRoute;

  function renderItem(item: NavItem) {
    const isActive = pathname.startsWith(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-xs"
            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
        )}
      >
        <item.icon className="size-4.5" />
        {item.title}
      </Link>
    );
  }

  return (
    <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r lg:flex">
      <div className="flex h-16 shrink-0 flex-col justify-center gap-0.5 border-b px-5">
        <span className="flex items-center gap-2 text-[0.95rem] font-semibold tracking-tight">
          <BallastBadge />
          {BRAND.name}
        </span>
        <span className="text-muted-foreground text-2xs pl-9 leading-none tracking-wide uppercase">
          {edition}
        </span>
      </div>
      <nav aria-label="Main" className="flex flex-1 flex-col gap-5 overflow-y-auto p-3">
        {primarySections.map((section) => (
          <div key={section.id} className="flex flex-col gap-1">
            <p className="text-muted-foreground text-2xs px-3 pb-1 font-semibold tracking-wider uppercase">
              {section.label}
            </p>
            {section.items.map(renderItem)}
          </div>
        ))}

        {accountItems.length > 0 && (
          <div className="mt-auto flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setAccountExpanded((current) => !current)}
              aria-expanded={showAccountItems}
              aria-controls="sidebar-account-items"
              className="text-muted-foreground hover:text-sidebar-accent-foreground text-2xs flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-1.5 font-semibold tracking-wider uppercase transition-colors"
            >
              {accountSection?.label}
              <ChevronDownIcon
                className={cn("size-3.5 transition-transform", !showAccountItems && "-rotate-90")}
              />
            </button>
            <div
              id="sidebar-account-items"
              className={cn("flex-col gap-1", showAccountItems ? "flex" : "hidden")}
            >
              {accountItems.map(renderItem)}
            </div>
          </div>
        )}
      </nav>
      <div className="text-muted-foreground shrink-0 border-t p-4 text-xs">
        <p>Built for {editionBranding(edition).audience}</p>
        <ReportIssueButton
          variant="inline"
          className="mt-2 h-8 w-full justify-start px-2 text-xs"
        />
      </div>
    </aside>
  );
}
