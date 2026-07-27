"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PRESET_LABELS: Record<string, string> = {
  "this-month": "This month",
  "last-month": "Last month",
  quarter: "This quarter",
  ytd: "Year to date",
  "last-12m": "Last 12 months",
  custom: "Custom range",
};

/** Drives every figure on the reports page via URL search params. */
export function PeriodSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const preset = searchParams.get("period") ?? "this-month";

  function update(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1.5">
        <Label className="text-muted-foreground text-xs">Period</Label>
        <Select
          value={preset}
          onValueChange={(value) =>
            update(value === "custom" ? { period: value } : { period: value, from: null, to: null })
          }
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PRESET_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {preset === "custom" && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="report-from" className="text-muted-foreground text-xs">
              From
            </Label>
            <Input
              id="report-from"
              type="date"
              className="w-38"
              value={searchParams.get("from") ?? ""}
              onChange={(event) => update({ from: event.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="report-to" className="text-muted-foreground text-xs">
              To
            </Label>
            <Input
              id="report-to"
              type="date"
              className="w-38"
              value={searchParams.get("to") ?? ""}
              onChange={(event) => update({ to: event.target.value })}
            />
          </div>
        </>
      )}
    </div>
  );
}
