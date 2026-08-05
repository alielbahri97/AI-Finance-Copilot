import { Badge } from "@/components/ui/badge";
import type { RecurringSpendFlag, RecurringVendor } from "@/lib/business/recurring-spend";
import { formatCurrency, formatDate, localeForCurrency } from "@/lib/utils";

const FLAG_LABELS: Record<RecurringSpendFlag, string> = {
  price_creep: "Price up",
  overlap: "Possible duplicate",
  stopped: "No recent charge",
};

const FLAG_VARIANTS: Record<RecurringSpendFlag, "destructive" | "warning" | "outline"> = {
  price_creep: "destructive",
  overlap: "warning",
  stopped: "outline",
};

/**
 * One sentence per flag, in the workspace's own numbers. A badge on its own
 * tells someone that something is up but not what — and the overlap badge in
 * particular has to name the other vendor, because "possible duplicate" with
 * nothing to compare against is an accusation rather than information.
 */
export function vendorFlagExplanation(
  vendor: RecurringVendor,
  currency: string,
  overlapWith: string[] = []
): string | null {
  const locale = localeForCurrency(currency);

  if (vendor.flags.includes("price_creep") && vendor.priceChange) {
    const { from, to, percent } = vendor.priceChange;
    return `Was ${formatCurrency(from, currency, locale)} per charge, now ${formatCurrency(to, currency, locale)} — up ${Math.round(percent)}%.`;
  }
  if (vendor.flags.includes("overlap") && vendor.toolCategory) {
    const others = overlapWith.filter((label) => label !== vendor.label);
    return others.length > 0
      ? `Also paying ${others.join(", ")} for ${vendor.toolCategory}.`
      : `Another vendor is also booked as ${vendor.toolCategory}.`;
  }
  if (vendor.flags.includes("stopped")) {
    return `Nothing charged since ${formatDate(vendor.lastChargedAt, locale)}, well past the usual ${vendor.cadence} interval. Left out of every total in case it was cancelled.`;
  }
  return null;
}

export function RecurringSpendFlagBadges({ flags }: { flags: readonly RecurringSpendFlag[] }) {
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
