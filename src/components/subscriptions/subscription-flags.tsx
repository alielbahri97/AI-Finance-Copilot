import { Badge } from "@/components/ui/badge";
import type { DetectedSubscription, SubscriptionFlag } from "@/lib/personal/subscriptions";
import { formatCurrency, formatDate, localeForCurrency } from "@/lib/utils";

const FLAG_LABELS: Record<SubscriptionFlag, string> = {
  price_increase: "Price up",
  overdue: "No recent charge",
  unused_looking: "Worth reviewing",
};

const FLAG_VARIANTS: Record<SubscriptionFlag, "destructive" | "secondary" | "outline"> = {
  price_increase: "destructive",
  overdue: "outline",
  unused_looking: "secondary",
};

/**
 * One sentence per flag, in the user's own numbers. A badge on its own tells
 * someone that something is up but not what, and the review flag in
 * particular has to state its own limits: the bank shows payments, not usage.
 */
export function flagExplanation(item: DetectedSubscription, currency: string): string | null {
  const locale = localeForCurrency(currency);
  if (item.flags.includes("price_increase") && item.priceChange) {
    const { from, to, percent } = item.priceChange;
    return `Was ${formatCurrency(from, currency, locale)}, now ${formatCurrency(to, currency, locale)} — up ${Math.round(percent)}%.`;
  }
  if (item.flags.includes("overdue")) {
    return `Nothing charged since ${formatDate(item.lastChargedAt, locale)}, well past the usual ${item.cadence} interval. Left out of the monthly total in case it was cancelled.`;
  }
  if (item.flags.includes("unused_looking")) {
    return `Charged ${item.timesSeen} times at the same price, and small enough to go unnoticed. Your transactions cannot show whether you still use it, so this is a prompt to check.`;
  }
  return null;
}

export function SubscriptionFlagBadges({ flags }: { flags: readonly SubscriptionFlag[] }) {
  if (flags.length === 0) return null;

  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((flag) => (
        <Badge key={flag} variant={FLAG_VARIANTS[flag]}>
          {FLAG_LABELS[flag]}
        </Badge>
      ))}
    </span>
  );
}
