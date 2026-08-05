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
  ScaleIcon,
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

export type NavSectionId = "money" | "analyze" | "account";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  section: NavSectionId;
  /** Present only in editions that include this feature; absent = shared. */
  feature?: EditionFeature;
}

export interface NavSection {
  id: NavSectionId;
  label: string;
  items: NavItem[];
}

/**
 * Every dashboard destination in display order, both editions together. The
 * sidebar and the mobile nav both render `navItemsFor()`, so the two can never
 * disagree — and because each edition-specific route is also guarded on the
 * server, an item missing here is a convenience, not the security boundary.
 */
export const NAV_ITEMS: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboardIcon, section: "money" },
  { title: "Transactions", href: "/transactions", icon: ArrowLeftRightIcon, section: "money" },
  { title: "Import", href: "/import", icon: UploadIcon, section: "money" },
  { title: "Categories", href: "/categories", icon: TagsIcon, section: "money" },
  {
    title: "Invoices",
    href: "/invoices",
    icon: ReceiptTextIcon,
    section: "money",
    feature: "invoices",
  },
  {
    title: "Budgets",
    href: "/budgets",
    icon: WalletIcon,
    section: "money",
    feature: "budgets",
  },
  { title: "Goals", href: "/goals", icon: PiggyBankIcon, section: "money", feature: "goals" },
  {
    title: "Net worth",
    href: "/net-worth",
    icon: ScaleIcon,
    section: "money",
    feature: "netWorth",
  },
  {
    title: "Subscriptions",
    href: "/subscriptions",
    icon: RepeatIcon,
    section: "money",
    feature: "subscriptions",
  },
  { title: "Forecast", href: "/forecast", icon: ChartSplineIcon, section: "analyze" },
  { title: "Reports", href: "/reports", icon: ChartNoAxesCombinedIcon, section: "analyze" },
  { title: "Copilot", href: "/copilot", icon: BotIcon, section: "analyze" },
  { title: "Integrations", href: "/integrations", icon: PlugIcon, section: "account" },
  { title: "Billing", href: "/billing", icon: CreditCardIcon, section: "account" },
  { title: "Profile", href: "/profile", icon: UserIcon, section: "account" },
  { title: "Settings", href: "/settings", icon: SettingsIcon, section: "account" },
  { title: "Help", href: "/help", icon: LifeBuoyIcon, section: "account" },
];

/** Shown only to profiles with isAdmin = true. */
export const ADMIN_NAV_ITEM: NavItem = {
  title: "Admin",
  href: "/admin",
  icon: ShieldIcon,
  section: "account",
};

const SECTION_LABELS: Record<NavSectionId, string> = {
  money: "Money",
  analyze: "Analyze",
  account: "Account",
};

/** Reachable in one tap from the mobile tab bar; the rest live behind More. */
const TAB_BAR_HREFS = ["/dashboard", "/transactions", "/copilot"];

export function navItemsFor(type: WorkspaceType, isAdmin = false): NavItem[] {
  const items = NAV_ITEMS.filter(
    (item) => !item.feature || editionHasFeature(type, item.feature)
  );
  return isAdmin ? [...items, ADMIN_NAV_ITEM] : items;
}

export function navSectionsFor(type: WorkspaceType, isAdmin = false): NavSection[] {
  const items = navItemsFor(type, isAdmin);
  return (Object.keys(SECTION_LABELS) as NavSectionId[])
    .map((id) => ({
      id,
      label: SECTION_LABELS[id],
      items: items.filter((item) => item.section === id),
    }))
    .filter((section) => section.items.length > 0);
}

export function tabBarItemsFor(type: WorkspaceType): NavItem[] {
  const items = navItemsFor(type);
  return TAB_BAR_HREFS.flatMap((href) => items.filter((item) => item.href === href));
}
