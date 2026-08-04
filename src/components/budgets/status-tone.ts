import type { ProgressTone } from "@/components/ui/progress";
import type { BudgetStatus } from "@/lib/personal/budgets";

/**
 * Shared by the page and the dashboard widget so a budget is never the same
 * colour in one place and a different one in the other.
 */
export const STATUS_TONES: Record<BudgetStatus, ProgressTone> = {
  under: "default",
  warning: "warning",
  over: "destructive",
};
