import { cn } from "@/lib/utils";

interface Meter {
  label: string;
  used: number;
  /** null = unlimited. */
  limit: number | null;
}

export function UsageMeters({ meters }: { meters: Meter[] }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {meters.map((meter) => {
        const pct =
          meter.limit === null ? 0 : Math.min(100, Math.round((meter.used / meter.limit) * 100));
        const nearLimit = meter.limit !== null && pct >= 80;
        return (
          <div key={meter.label}>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium">{meter.label}</p>
              <p className="text-muted-foreground text-xs tabular-nums">
                {meter.limit === null
                  ? `${meter.used.toLocaleString()} / unlimited`
                  : `${meter.used.toLocaleString()} / ${meter.limit.toLocaleString()}`}
              </p>
            </div>
            <div className="bg-muted h-2 overflow-hidden rounded-full">
              {meter.limit === null ? (
                <div className="bg-success/40 h-full w-full" />
              ) : (
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    nearLimit ? "bg-destructive" : "bg-primary"
                  )}
                  style={{ width: `${pct}%` }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
