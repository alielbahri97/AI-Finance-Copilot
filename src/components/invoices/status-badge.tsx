import { Badge } from "@/components/ui/badge";
import type { DerivedInvoiceStatus } from "@/lib/invoices/serialize";
import { cn } from "@/lib/utils";

/*
 * The four statuses are an escalation, so they use the semantic ladder the rest
 * of the app already tunes for contrast — grey, amber, green, red — rather than
 * a slot from the chart palette, which carries no meaning outside a chart and
 * changes whenever the palette is reordered.
 *
 * The fills stay at 10% of the base tokens, which is what carries the
 * traffic-light reading at a glance; only the text uses the `-tinted`
 * foregrounds, which are dark enough to clear AA on those fills. Overdue keeps
 * the tinted treatment rather than going solid red so that a table with several
 * overdue invoices doesn't read as a wall of alarm — its urgency comes from
 * being the most saturated text in the ladder instead.
 */
const STYLES: Record<DerivedInvoiceStatus, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-muted text-muted-foreground border-transparent" },
  UNPAID: { label: "Unpaid", className: "bg-warning/10 text-warning-tinted border-transparent" },
  PAID: { label: "Paid", className: "bg-success/10 text-success-tinted border-transparent" },
  OVERDUE: {
    label: "Overdue",
    className: "bg-destructive/10 text-destructive-tinted border-transparent",
  },
};

export function InvoiceStatusBadge({ status }: { status: DerivedInvoiceStatus }) {
  const style = STYLES[status];
  return (
    <Badge variant="outline" className={cn("font-medium", style.className)}>
      {style.label}
    </Badge>
  );
}
