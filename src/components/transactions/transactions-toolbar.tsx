"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FilterIcon, SearchIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/utils";
import type { BatchOption, CategoryOption } from "./types";

const ALL = "all";
const UNCATEGORIZED = "uncategorized";

/** Date-input values are plain days; parse them locally so the chip is not off by one. */
function formatDayParam(value: string, locale: string) {
  return formatDate(`${value}T00:00:00`, locale);
}

interface TransactionsToolbarProps {
  categories: CategoryOption[];
  batches: BatchOption[];
  locale: string;
}

export function TransactionsToolbar({ categories, batches, locale }: TransactionsToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [minAmount, setMinAmount] = useState(searchParams.get("min") ?? "");
  const [maxAmount, setMaxAmount] = useState(searchParams.get("max") ?? "");
  const [fromDate, setFromDate] = useState(searchParams.get("from") ?? "");
  const [toDate, setToDate] = useState(searchParams.get("to") ?? "");
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(
    ["type", "category", "batch", "from", "to", "min", "max"].some((key) =>
      searchParams.has(key)
    )
  );
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

  const updateDebounced = useCallback(
    (updates: Record<string, string | null>) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => updateParams(updates), 350);
    },
    [updateParams]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const hasActiveFilters =
    ["q", "type", "category", "batch", "from", "to", "min", "max"].some((key) =>
      searchParams.has(key)
    );

  const incomeCategories = categories.filter((category) => category.type === "INCOME");
  const expenseCategories = categories.filter((category) => category.type === "EXPENSE");

  /**
   * A range that ends before it starts matches nothing, so we hold the value
   * locally and say why rather than reloading an empty table.
   */
  function updateRange(key: "from" | "to", value: string) {
    if (key === "from") setFromDate(value);
    else setToDate(value);

    const nextFrom = key === "from" ? value : fromDate;
    const nextTo = key === "to" ? value : toDate;
    if (nextFrom && nextTo && nextFrom > nextTo) {
      setRangeError("The end date comes before the start date, so nothing would match.");
      return;
    }
    setRangeError(null);
    updateParams({ [key]: value });
  }

  function clearFilter(key: string) {
    if (key === "min") setMinAmount("");
    if (key === "max") setMaxAmount("");
    if (key === "from") setFromDate("");
    if (key === "to") setToDate("");
    if (key === "from" || key === "to") setRangeError(null);
    updateParams({ [key]: null });
  }

  const categoryParam = searchParams.get("category");
  const batchParam = searchParams.get("batch");
  const chips: { key: string; label: string }[] = [];
  const typeParam = searchParams.get("type");
  if (typeParam === "INCOME" || typeParam === "EXPENSE") {
    chips.push({ key: "type", label: typeParam === "INCOME" ? "Income only" : "Expenses only" });
  }
  if (categoryParam) {
    chips.push({
      key: "category",
      label:
        categoryParam === UNCATEGORIZED
          ? "Uncategorized"
          : (categories.find((category) => category.id === categoryParam)?.name ?? "Category"),
    });
  }
  if (batchParam) {
    chips.push({
      key: "batch",
      label: batches.find((batch) => batch.id === batchParam)?.fileName ?? "Import batch",
    });
  }
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  if (fromParam) chips.push({ key: "from", label: `From ${formatDayParam(fromParam, locale)}` });
  if (toParam) chips.push({ key: "to", label: `To ${formatDayParam(toParam, locale)}` });
  if (searchParams.get("min")) {
    chips.push({ key: "min", label: `Min ${searchParams.get("min")}` });
  }
  if (searchParams.get("max")) {
    chips.push({ key: "max", label: `Max ${searchParams.get("max")}` });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              updateDebounced({ q: event.target.value });
            }}
            placeholder="Search description or counterparty…"
            className="pl-9"
            aria-label="Search transactions"
          />
        </div>
        <Button
          variant={showFilters ? "secondary" : "outline"}
          onClick={() => setShowFilters((value) => !value)}
        >
          <FilterIcon />
          Filters
        </Button>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch("");
              setMinAmount("");
              setMaxAmount("");
              setFromDate("");
              setToDate("");
              setRangeError(null);
              router.replace(pathname, { scroll: false });
            }}
          >
            <XIcon />
            Clear
          </Button>
        )}
      </div>

      {!showFilters && chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => clearFilter(chip.key)}
              aria-label={`Remove filter: ${chip.label}`}
              className="bg-muted text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex max-w-56 items-center gap-1 rounded-full py-1 pr-2 pl-2.5 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="truncate">{chip.label}</span>
              <XIcon aria-hidden className="size-3 shrink-0" />
            </button>
          ))}
        </div>
      )}

      {showFilters && (
        <div className="bg-card grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground text-xs">Type</Label>
            <Select
              value={searchParams.get("type") ?? ALL}
              onValueChange={(value) => updateParams({ type: value })}
            >
              <SelectTrigger className="w-full" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All types</SelectItem>
                <SelectItem value="INCOME">Income</SelectItem>
                <SelectItem value="EXPENSE">Expense</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-muted-foreground text-xs">Category</Label>
            <Select
              value={searchParams.get("category") ?? ALL}
              onValueChange={(value) => updateParams({ category: value })}
            >
              <SelectTrigger className="w-full" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                <SelectItem value={UNCATEGORIZED}>Uncategorized</SelectItem>
                {expenseCategories.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Expenses</SelectLabel>
                    {expenseCategories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {incomeCategories.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Income</SelectLabel>
                    {incomeCategories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-muted-foreground text-xs">Import batch</Label>
            <Select
              value={searchParams.get("batch") ?? ALL}
              onValueChange={(value) => updateParams({ batch: value })}
            >
              <SelectTrigger className="w-full" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All sources</SelectItem>
                {batches.map((batch) => (
                  <SelectItem key={batch.id} value={batch.id}>
                    {batch.fileName} ({formatDate(batch.createdAt, locale)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="filter-from" className="text-muted-foreground text-xs">
              From
            </Label>
            <Input
              id="filter-from"
              type="date"
              className="h-8"
              max={toDate || undefined}
              aria-invalid={rangeError !== null}
              aria-describedby={rangeError ? "filter-range-error" : undefined}
              value={fromDate}
              onChange={(event) => updateRange("from", event.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="filter-to" className="text-muted-foreground text-xs">
              To
            </Label>
            <Input
              id="filter-to"
              type="date"
              className="h-8"
              min={fromDate || undefined}
              aria-invalid={rangeError !== null}
              aria-describedby={rangeError ? "filter-range-error" : undefined}
              value={toDate}
              onChange={(event) => updateRange("to", event.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-muted-foreground text-xs">Amount range</Label>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                placeholder="Min"
                className="h-8"
                aria-label="Minimum amount"
                value={minAmount}
                onChange={(event) => {
                  setMinAmount(event.target.value);
                  updateDebounced({ min: event.target.value });
                }}
              />
              <span className="text-muted-foreground text-xs">–</span>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                placeholder="Max"
                className="h-8"
                aria-label="Maximum amount"
                value={maxAmount}
                onChange={(event) => {
                  setMaxAmount(event.target.value);
                  updateDebounced({ max: event.target.value });
                }}
              />
            </div>
          </div>

          {rangeError && (
            <p
              id="filter-range-error"
              role="alert"
              className="text-destructive col-span-full text-xs"
            >
              {rangeError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
