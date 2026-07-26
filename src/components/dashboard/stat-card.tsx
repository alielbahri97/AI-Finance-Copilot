import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  tone?: "default" | "positive" | "negative";
}

export function StatCard({ title, value, hint, icon: Icon, tone = "default" }: StatCardProps) {
  return (
    <Card className="gap-2">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-muted-foreground text-sm font-medium">{title}</CardTitle>
        <Icon className="text-muted-foreground size-4" />
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "text-2xl font-bold tracking-tight",
            tone === "positive" && "text-success",
            tone === "negative" && "text-destructive"
          )}
        >
          {value}
        </div>
        <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
      </CardContent>
    </Card>
  );
}
