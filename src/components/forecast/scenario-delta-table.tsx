import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { scenarioColor, type ScenarioDelta } from "@/lib/finance/scenarios";
import { cn, formatCurrency, localeForCurrency } from "@/lib/utils";

interface ScenarioDeltaTableProps {
  deltas: ScenarioDelta[];
  currency: string;
}

function runwayText(months: number | null): string {
  if (months === null) return "∞";
  if (months <= 0) return "0 months";
  return `${Math.round(months * 10) / 10} months`;
}

/**
 * The comparison in numbers: where each scenario leaves the balance at 30 days,
 * 90 days and 12 months, how long the cash lasts, and the gap to the primary
 * scenario. The chart shows the shape; this is the part people quote.
 */
export function ScenarioDeltaTable({ deltas, currency }: ScenarioDeltaTableProps) {
  const locale = localeForCurrency(currency);
  const money = (value: number) => formatCurrency(value, currency, locale);
  const signed = (value: number) =>
    value === 0 ? "—" : `${value > 0 ? "+" : "−"}${money(Math.abs(value))}`;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Scenario</TableHead>
          <TableHead className="text-right">30 days</TableHead>
          <TableHead className="text-right">90 days</TableHead>
          <TableHead className="text-right">12 months</TableHead>
          <TableHead className="text-right">Runway</TableHead>
          <TableHead className="text-right">vs {deltas[0]?.name}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {deltas.map((delta, index) => (
          <TableRow key={delta.id}>
            <TableCell className="font-medium">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: scenarioColor(index) }}
                />
                <span className="truncate">{delta.name}</span>
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums">{money(delta.balance30d)}</TableCell>
            <TableCell className="text-right tabular-nums">{money(delta.balance90d)}</TableCell>
            <TableCell className="text-right tabular-nums">{money(delta.balance12m)}</TableCell>
            <TableCell
              className={cn(
                "text-right tabular-nums",
                delta.runwayMonths !== null && delta.runwayMonths < 6 && "text-destructive"
              )}
            >
              {runwayText(delta.runwayMonths)}
              {delta.runwayDeltaMonths !== null && delta.runwayDeltaMonths !== 0 ? (
                <span className="text-muted-foreground">
                  {" "}
                  ({delta.runwayDeltaMonths > 0 ? "+" : "−"}
                  {Math.abs(Math.round(delta.runwayDeltaMonths * 10) / 10)})
                </span>
              ) : null}
            </TableCell>
            <TableCell
              className={cn(
                "text-right tabular-nums",
                delta.isPrimary
                  ? "text-muted-foreground"
                  : delta.delta12m > 0
                    ? "text-success"
                    : delta.delta12m < 0
                      ? "text-destructive"
                      : "text-muted-foreground"
              )}
            >
              {delta.isPrimary ? "baseline" : signed(delta.delta12m)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
