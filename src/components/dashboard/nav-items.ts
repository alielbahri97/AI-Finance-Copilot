import {
  ArrowLeftRightIcon,
  BotIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  TagsIcon,
  UploadIcon,
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
  { title: "Import", href: "/import", icon: UploadIcon },
  { title: "Categories", href: "/categories", icon: TagsIcon },
  { title: "Copilot", href: "/copilot", icon: BotIcon },
  { title: "Profile", href: "/profile", icon: UserIcon },
  { title: "Settings", href: "/settings", icon: SettingsIcon },
];
