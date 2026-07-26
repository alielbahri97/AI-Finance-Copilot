import {
  ArrowLeftRightIcon,
  BotIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  UserIcon,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboardIcon },
  { title: "Transactions", href: "/transactions", icon: ArrowLeftRightIcon },
  { title: "Copilot", href: "/copilot", icon: BotIcon },
  { title: "Profile", href: "/profile", icon: UserIcon },
  { title: "Settings", href: "/settings", icon: SettingsIcon },
];
