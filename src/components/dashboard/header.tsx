import { MobileNav } from "@/components/dashboard/mobile-nav";
import { UserNav } from "@/components/dashboard/user-nav";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { WorkspaceSwitcher, type WorkspaceOption } from "@/components/team/workspace-switcher";
import { ThemeToggle } from "@/components/theme-toggle";

interface HeaderProps {
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  isAdmin?: boolean;
  workspaces: WorkspaceOption[];
  currentWorkspaceId: string;
}

export function Header({
  email,
  fullName,
  avatarUrl,
  isAdmin,
  workspaces,
  currentWorkspaceId,
}: HeaderProps) {
  return (
    <header className="bg-background/80 sticky top-0 z-40 flex h-16 items-center justify-between gap-2 border-b px-4 backdrop-blur sm:px-6">
      <MobileNav isAdmin={isAdmin} />
      <WorkspaceSwitcher workspaces={workspaces} currentId={currentWorkspaceId} />
      <div className="ml-auto flex items-center gap-1.5">
        <NotificationBell />
        <ThemeToggle />
        <UserNav email={email} fullName={fullName} avatarUrl={avatarUrl} />
      </div>
    </header>
  );
}
