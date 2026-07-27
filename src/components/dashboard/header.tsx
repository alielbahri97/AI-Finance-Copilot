import { MobileNav } from "@/components/dashboard/mobile-nav";
import { UserNav } from "@/components/dashboard/user-nav";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";

interface HeaderProps {
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

export function Header({ email, fullName, avatarUrl }: HeaderProps) {
  return (
    <header className="bg-background/80 sticky top-0 z-40 flex h-16 items-center justify-between gap-2 border-b px-4 backdrop-blur sm:px-6">
      <MobileNav />
      <div className="ml-auto flex items-center gap-1.5">
        <NotificationBell />
        <ThemeToggle />
        <UserNav email={email} fullName={fullName} avatarUrl={avatarUrl} />
      </div>
    </header>
  );
}
