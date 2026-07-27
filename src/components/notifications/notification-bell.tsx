"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  BellIcon,
  CalendarClockIcon,
  CheckCheckIcon,
  ReceiptTextIcon,
  TrendingDownIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

const TYPE_ICONS: Record<string, LucideIcon> = {
  DAILY_SUMMARY: CalendarClockIcon,
  WEEKLY_SUMMARY: CalendarClockIcon,
  MONTHLY_SUMMARY: CalendarClockIcon,
  LARGE_TRANSACTION: TrendingDownIcon,
  LOW_CASH: WalletIcon,
  INVOICE_REMINDER: ReceiptTextIcon,
};

const POLL_INTERVAL_MS = 60_000;

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications");
      if (!response.ok) return;
      const data = (await response.json()) as {
        notifications: NotificationItem[];
        unreadCount: number;
      };
      setItems(data.notifications);
      setUnreadCount(data.unreadCount);
      setLoaded(true);
    } catch {
      // Silent: the bell just keeps its previous state.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  async function markRead(ids: string[] | "all") {
    const body = ids === "all" ? { all: true } : { ids };
    setItems((current) =>
      current.map((item) =>
        ids === "all" || ids.includes(item.id) ? { ...item, read: true } : item
      )
    );
    setUnreadCount((current) =>
      ids === "all" ? 0 : Math.max(0, current - ids.length)
    );
    await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => undefined);
  }

  function handleItemClick(item: NotificationItem) {
    if (!item.read) void markRead([item.id]);
    if (item.link) {
      setOpen(false);
      router.push(item.link);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void refresh();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <BellIcon className="size-5" />
          {unreadCount > 0 && (
            <span className="bg-destructive text-destructive-foreground absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground h-7 gap-1 text-xs"
              onClick={() => void markRead("all")}
            >
              <CheckCheckIcon className="size-3.5" />
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {!loaded ? (
            <p className="text-muted-foreground px-4 py-8 text-center text-sm">Loading…</p>
          ) : items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <BellIcon className="text-muted-foreground mx-auto mb-2 size-6" />
              <p className="text-muted-foreground text-sm">
                No notifications yet. Summaries and alerts will show up here.
              </p>
            </div>
          ) : (
            items.map((item) => {
              const Icon = TYPE_ICONS[item.type] ?? BellIcon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleItemClick(item)}
                  className={cn(
                    "hover:bg-accent flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0",
                    !item.read && "bg-primary/5"
                  )}
                >
                  <div
                    className={cn(
                      "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
                      item.read ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
                    )}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn("text-sm", !item.read && "font-semibold")}>{item.title}</p>
                      {!item.read && (
                        <span className="bg-primary mt-1.5 size-2 shrink-0 rounded-full" />
                      )}
                    </div>
                    <p className="text-muted-foreground line-clamp-2 text-xs whitespace-pre-line">
                      {item.body}
                    </p>
                    <p className="text-muted-foreground/70 mt-1 text-[11px]">
                      {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
