import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The one shape an empty panel takes: an icon in a soft disc, a short
 * statement of what is missing, optionally why, and a way out.
 *
 * Extracted from the Subscriptions page, which had the only complete version —
 * most other empties were a bare centred line of muted text that read like a
 * loading state. Deliberately not wrapped in a Card: nearly every call site is
 * already inside one, and the few that are not (see the Subscriptions page)
 * supply their own.
 *
 * Pass a height through `className` when replacing a fixed-height chart body,
 * so the card does not resize once the real chart has data.
 */
interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3.5 px-4 py-12 text-center",
        className
      )}
    >
      <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-2xl">
        <Icon aria-hidden className="size-5" />
      </div>
      <div className="space-y-1.5">
        <p className="text-base font-semibold tracking-tight">{title}</p>
        {description ? (
          <p className="text-muted-foreground mx-auto max-w-sm text-sm leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="pt-0.5">{action}</div> : null}
    </div>
  );
}
