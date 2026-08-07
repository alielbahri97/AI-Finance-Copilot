import { cn, formatCurrency } from "@/lib/utils";

const SIZE_CLASS = {
  /** Inline list / table cell. */
  sm: "text-sm font-semibold tracking-tight",
  /** Mobile cards and row-primary figures. */
  md: "text-base font-semibold tracking-tight",
  /** KPI strips and summary tiles. */
  lg: "text-xl font-semibold tracking-tight sm:text-2xl",
  /** Hero balances. */
  hero: "text-4xl font-bold tracking-tight sm:text-5xl",
} as const;

type MoneySize = keyof typeof SIZE_CLASS;

interface MoneyTextProps {
  amount: number;
  currency: string;
  locale: string;
  /**
   * Prefix for signed cashflow (+ income / − expense). Pass the sign only —
   * the formatted absolute amount follows.
   */
  signed?: "income" | "expense" | false;
  size?: MoneySize;
  tone?: "default" | "success" | "destructive" | "muted";
  className?: string;
}

/**
 * Money-first figure: larger type than surrounding labels, always tabular.
 * Keeps amount styling consistent across lists, tables and widgets.
 */
export function MoneyText({
  amount,
  currency,
  locale,
  signed = false,
  size = "sm",
  tone = "default",
  className,
}: MoneyTextProps) {
  const prefix = signed === "income" ? "+" : signed === "expense" ? "−" : "";
  const display = signed ? Math.abs(amount) : amount;

  return (
    <span
      className={cn(
        "numeric",
        SIZE_CLASS[size],
        tone === "success" && "text-success",
        tone === "destructive" && "text-destructive",
        tone === "muted" && "text-muted-foreground",
        tone === "default" && "text-foreground",
        className
      )}
    >
      {prefix}
      {formatCurrency(display, currency, locale)}
    </span>
  );
}
