"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { EllipsisIcon, MenuIcon } from "lucide-react";

import { BallastBadge } from "@/components/brand/ballast-mark";
import { navSectionsFor, tabBarItemsFor } from "@/components/dashboard/nav-items";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { BRAND } from "@/lib/branding";
import type { WorkspaceType } from "@/lib/workspace/editions";
import { cn } from "@/lib/utils";

interface MobileNavProps {
  isAdmin?: boolean;
  workspaceType: WorkspaceType;
}

function NavSheet({
  isAdmin = false,
  workspaceType,
  trigger,
}: MobileNavProps & { trigger: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const sections = navSectionsFor(workspaceType, isAdmin);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="left" className="w-64 p-0">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <BallastBadge className="size-7" markClassName="size-4" />
            {BRAND.name}
          </SheetTitle>
        </SheetHeader>
        <nav aria-label="Mobile" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
          {sections.map((section) => (
            <div key={section.id} className="flex flex-col gap-1">
              <p className="text-muted-foreground text-2xs px-3 pb-0.5 font-semibold tracking-wider uppercase">
                {section.label}
              </p>
              {section.items.map((item) => {
                const isActive = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-[color,background-color,box-shadow] duration-150",
                      isActive
                        ? "bg-accent text-accent-foreground shadow-xs"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground"
                    )}
                  >
                    <item.icon className="size-4.5" />
                    {item.title}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

export function MobileNav({ isAdmin = false, workspaceType }: MobileNavProps) {
  return (
    <NavSheet
      isAdmin={isAdmin}
      workspaceType={workspaceType}
      trigger={
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
          <MenuIcon className="size-5" />
        </Button>
      }
    />
  );
}

/**
 * Bottom tab bar for the destinations people reach every day. Everything else
 * stays one tap further away, behind More.
 */
export function MobileTabBar({ isAdmin = false, workspaceType }: MobileNavProps) {
  const pathname = usePathname();
  const items = tabBarItemsFor(workspaceType);
  const onTabRoute = items.some((item) => pathname.startsWith(item.href));

  return (
    <nav
      aria-label="Mobile tabs"
      className="bg-background/95 fixed inset-x-0 bottom-0 z-40 flex h-[var(--tab-bar-height)] border-t border-border/70 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      {items.map((item) => {
        const isActive = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "text-2xs flex flex-1 flex-col items-center gap-0.5 px-1 py-2 font-medium transition-colors duration-150",
              isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-full transition-[background-color,transform] duration-150",
                isActive && "bg-primary/10 scale-105"
              )}
            >
              <item.icon className="size-5" />
            </span>
            {item.title}
          </Link>
        );
      })}
      <NavSheet
        isAdmin={isAdmin}
        workspaceType={workspaceType}
        trigger={
          <button
            type="button"
            className={cn(
              "text-2xs flex flex-1 cursor-pointer flex-col items-center gap-0.5 px-1 py-2 font-medium transition-colors",
              onTabRoute ? "text-muted-foreground hover:text-foreground" : "text-primary"
            )}
          >
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-full transition-colors",
                !onTabRoute && "bg-primary/10"
              )}
            >
              <EllipsisIcon className="size-5" />
            </span>
            More
          </button>
        }
      />
    </nav>
  );
}
