import { Badge } from "@/components/ui/badge";
import type { DerivedInvoiceStatus } from "@/lib/invoices/serialize";
import { cn } from "@/lib/utils";

const STYLES: Record<DerivedInvoiceStatus, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-muted text-muted-foreground border-transparent" },
  UNPAID: { label: "Unpaid", className: "bg-chart-4/20 text-chart-4 border-transparent" },
  PAID: { label: "Paid", className: "bg-success/15 text-success border-transparent" },
  OVERDUE: { label: "Overdue", className: "bg-destructive/10 text-destructive border-transparent" },
};

export function InvoiceStatusBadge({ status }: { status: DerivedInvoiceStatus }) {
  const style = STYLES[status];
  return (
    <Badge variant="outline" className={cn("font-medium", style.className)}>
      {style.label}
    </Badge>
  );
}
