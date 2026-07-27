import {
  ArrowLeftRightIcon,
  BotIcon,
  ChartNoAxesCombinedIcon,
  ChartSplineIcon,
  CreditCardIcon,
  LayoutDashboardIcon,
  ReceiptTextIcon,
  SettingsIcon,
  ShieldIcon,
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
  { title: "Invoices", href: "/invoices", icon: ReceiptTextIcon },
  { title: "Forecast", href: "/forecast", icon: ChartSplineIcon },
  { title: "Reports", href: "/reports", icon: ChartNoAxesCombinedIcon },
  { title: "Copilot", href: "/copilot", icon: BotIcon },
  { title: "Billing", href: "/billing", icon: CreditCardIcon },
  { title: "Profile", href: "/profile", icon: UserIcon },
  { title: "Settings", href: "/settings", icon: SettingsIcon },
];

/** Shown only to profiles with isAdmin = true. */
export const ADMIN_NAV_ITEM: NavItem = { title: "Admin", href: "/admin", icon: ShieldIcon };
