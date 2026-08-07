import { cn } from "@/lib/utils";

/**
 * The one h1 a page gets. Exists so the type scale can't drift back to the
 * mix of font-bold and font-semibold it had before.
 */
export function PageHeading({ className, ...props }: React.ComponentProps<"h1">) {
  return <h1 className={cn("text-3xl font-semibold tracking-tight", className)} {...props} />;
}
