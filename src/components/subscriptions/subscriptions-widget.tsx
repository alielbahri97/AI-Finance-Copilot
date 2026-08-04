import Link from "next/link";
import { CreditCardIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { UpcomingCharge } from "@/lib/personal/subscriptions";
import { formatCurrency, formatDate } from "@/lib/utils";

/** How many upcoming charges the widget lists before deferring to the page. */
const WIDGET_CHARGE_COUNT = 2;

interface SubscriptionsWidgetProps {
  currency: string;
  /** Monthly equivalent of active subscriptions, excluding stopped ones. */
  totalMonthlyCost: number;
  /** Number of detected subscriptions, bills excluded. */
  subscriptionCount: number;
  /** Subscriptions carrying at least one flag. */
  flaggedCount: number;
  /** Next charges, soonest first; only the first couple are shown. */
  upcomingCharges: UpcomingCharge[];
}

/**
 * Dashboard summary of the subscriptions page. Server-renderable and fed
 * plain values, so the dashboard decides what to load and this only displays.
 */
export function SubscriptionsWidget({
  currency,
  totalMonthlyCost,
  subscriptionCount,
  flaggedCount,
  upcomingCharges,
}: SubscriptionsWidgetProps) {
  const next = upcomingCharges.slice(0, WIDGET_CHARGE_COUNT);

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCardIcon className="text-muted-foreground size-4" />
          Subscriptions
        </CardTitle>
        <CardDescription>
          {subscriptionCount === 0
            ? "Nothing recurring detected yet"
            : `${subscriptionCount} recurring ${subscriptionCount === 1 ? "subscription" : "subscriptions"}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {subscriptionCount === 0 ? (
          <p className="text-muted-foreground text-sm">
            Detection needs a few months of transactions before it can tell a subscription from a
            one-off payment.
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight tabular-nums">
                {formatCurrency(totalMonthlyCost, currency)}
              </span>
              <span className="text-muted-foreground text-xs">per month</span>
            </div>
            <p className="text-muted-foreground text-xs">
              {flaggedCount === 0
                ? "Nothing flagged for review"
                : `${flaggedCount} ${flaggedCount === 1 ? "subscription is" : "subscriptions are"} worth a look`}
            </p>
            {next.length > 0 ? (
              <div className="flex flex-col gap-1 border-t pt-3">
                {next.map((charge, index) => (
                  <div
                    key={`${charge.key}-${charge.date}-${index}`}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">{charge.label}</span>
                    <span className="text-muted-foreground text-xs">
                      {formatDate(charge.date)}
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatCurrency(charge.amount, currency)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
        <Link
          href="/subscriptions"
          className="text-muted-foreground hover:text-foreground inline-block text-xs underline underline-offset-4"
        >
          View all subscriptions
        </Link>
      </CardContent>
    </Card>
  );
}
