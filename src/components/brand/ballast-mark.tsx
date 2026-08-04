import type { SVGProps } from "react";

import { BRAND } from "@/lib/branding";
import { MARK_PATH_DATA, MARK_VIEW_BOX } from "@/lib/brand/mark";
import { cn } from "@/lib/utils";

/**
 * The Ballast glyph on its own, drawn in `currentColor` so it inherits the
 * surrounding text colour and follows the light/dark theme without a variant.
 */
export function BallastMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox={MARK_VIEW_BOX}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cn("size-4.5", className)}
      {...props}
    >
      <path d={MARK_PATH_DATA} />
    </svg>
  );
}

/**
 * The glyph in its brand-coloured tile — the app icon as it appears in the
 * sidebar, the mobile nav and the auth screens.
 */
export function BallastBadge({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <div
      className={cn(
        "bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg",
        className
      )}
    >
      <BallastMark className={cn("size-4.5", markClassName)} />
    </div>
  );
}

/** Badge plus wordmark, for headers and anywhere the product introduces itself. */
export function BallastLogo({
  className,
  badgeClassName,
}: {
  className?: string;
  badgeClassName?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2 font-semibold", className)}>
      <BallastBadge className={badgeClassName} />
      {BRAND.name}
    </span>
  );
}
