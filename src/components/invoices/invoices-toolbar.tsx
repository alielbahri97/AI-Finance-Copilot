"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "all";

export function InvoicesToolbar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [vendor, setVendor] = useState(searchParams.get("vendor") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "" || value === ALL) params.delete(key);
        else params.set(key, value);
      }
      params.delete("page"); // filters reset pagination
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const hasActiveFilters = ["status", "vendor", "from", "to"].some((key) =>
    searchParams.has(key)
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="relative min-w-52 flex-1">
        <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={vendor}
          onChange={(event) => {
            setVendor(event.target.value);
            if (debounceRef.current) clearTimeout(debounceRef.current);
            const value = event.target.value;
            debounceRef.current = setTimeout(() => updateParams({ vendor: value }), 350);
          }}
          placeholder="Search vendor…"
          className="pl-9"
          aria-label="Search invoices by vendor"
        />
      </div>

      <div className="grid gap-1.5">
        <Label className="text-muted-foreground text-xs">Status</Label>
        <Select
          value={searchParams.get("status") ?? ALL}
          onValueChange={(value) => updateParams({ status: value })}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="UNPAID">Unpaid</SelectItem>
            <SelectItem value="OVERDUE">Overdue</SelectItem>
            <SelectItem value="PAID">Paid</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="invoices-from" className="text-muted-foreground text-xs">
          From
        </Label>
        <Input
          id="invoices-from"
          type="date"
          className="w-38"
          value={searchParams.get("from") ?? ""}
          onChange={(event) => updateParams({ from: event.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="invoices-to" className="text-muted-foreground text-xs">
          To
        </Label>
        <Input
          id="invoices-to"
          type="date"
          className="w-38"
          value={searchParams.get("to") ?? ""}
          onChange={(event) => updateParams({ to: event.target.value })}
        />
      </div>

      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setVendor("");
            updateParams({ status: null, vendor: null, from: null, to: null });
          }}
        >
          <XIcon />
          Clear
        </Button>
      )}
    </div>
  );
}
