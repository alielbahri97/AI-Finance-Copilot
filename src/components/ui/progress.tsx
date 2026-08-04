import { cn } from "@/lib/utils";

export type ProgressTone = "default" | "success" | "warning" | "destructive";

const TONE_CLASSES: Record<ProgressTone, string> = {
  default: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

interface ProgressProps {
  /** 0–100. Values above 100 fill the bar and are reported to assistive tech as-is. */
  value: number;
  tone?: ProgressTone;
  className?: string;
  /** Accessible name; required because a bare bar means nothing on its own. */
  label: string;
}

/**
 * A plain, server-renderable progress bar. Budgets, savings goals and plan
 * usage all show "how far through am I", so they share one bar rather than
 * three slightly different divs.
 */
export function Progress({ value, tone = "default", className, label }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("bg-muted h-2 overflow-hidden rounded-full", className)}
    >
      <div
        className={cn("h-full rounded-full transition-all", TONE_CLASSES[tone])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
