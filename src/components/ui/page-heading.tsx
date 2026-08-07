import { cn } from "@/lib/utils";

/**
 * The one h1 a page gets. Exists so the type scale can't drift back to the
 * mix of font-bold and font-semibold it had before.
 */
export function PageHeading({ className, ...props }: React.ComponentProps<"h1">) {
  return <h1 className={cn("text-3xl font-semibold tracking-tight", className)} {...props} />;
}

/**
 * Standard page chrome: short title, one-line subtitle, primary actions on the
 * right. Secondary actions should use quieter button variants (ghost/outline).
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 sm:gap-4", className)}>
      <div className="min-w-0 space-y-1">
        <PageHeading>{title}</PageHeading>
        {description ? (
          <p className="text-muted-foreground max-w-xl text-sm leading-relaxed">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
