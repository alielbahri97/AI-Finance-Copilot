import {
  ArrowLeftRightIcon,
  BotIcon,
  ChartNoAxesCombinedIcon,
  ChartSplineIcon,
  CreditCardIcon,
  LayoutDashboardIcon,
  LifeBuoyIcon,
  PiggyBankIcon,
  PlugIcon,
  ReceiptTextIcon,
  RepeatIcon,
  SettingsIcon,
  ShieldIcon,
  TagsIcon,
  UploadIcon,
  UserIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";

import {
  editionHasFeature,
  type EditionFeature,
  type WorkspaceType,
} from "@/lib/workspace/editions";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Present only in editions that include this feature; absent = shared. */
  feature?: EditionFeature;
}

/**
 * Every dashboard destination in display order, both editions together. The
 * sidebar and the mobile nav both render `navItemsFor()`, so the two can never
 * disagree — and because each edition-specific route is also guarded on the
 * server, an item missing here is a convenience, not the security boundary.
 */
export const NAV_ITEMS: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboardIcon },
  { title: "Transactions", href: "/transactions", icon: ArrowLeftRightIcon },
  { title: "Import", href: "/import", icon: UploadIcon },
  { title: "Categories", href: "/categories", icon: TagsIcon },
  { title: "Invoices", href: "/invoices", icon: ReceiptTextIcon, feature: "invoices" },
  { title: "Budgets", href: "/budgets", icon: WalletIcon, feature: "budgets" },
  { title: "Goals", href: "/goals", icon: PiggyBankIcon, feature: "goals" },
  {
    title: "Subscriptions",
    href: "/subscriptions",
    icon: RepeatIcon,
    feature: "subscriptions",
  },
  { title: "Forecast", href: "/forecast", icon: ChartSplineIcon },
  { title: "Reports", href: "/reports", icon: ChartNoAxesCombinedIcon },
  { title: "Copilot", href: "/copilot", icon: BotIcon },
  { title: "Integrations", href: "/integrations", icon: PlugIcon },
  { title: "Billing", href: "/billing", icon: CreditCardIcon },
  { title: "Profile", href: "/profile", icon: UserIcon },
  { title: "Settings", href: "/settings", icon: SettingsIcon },
  { title: "Help", href: "/help", icon: LifeBuoyIcon },
];

/** Shown only to profiles with isAdmin = true. */
export const ADMIN_NAV_ITEM: NavItem = { title: "Admin", href: "/admin", icon: ShieldIcon };

export function navItemsFor(type: WorkspaceType, isAdmin = false): NavItem[] {
  const items = NAV_ITEMS.filter(
    (item) => !item.feature || editionHasFeature(type, item.feature)
  );
  return isAdmin ? [...items, ADMIN_NAV_ITEM] : items;
}
