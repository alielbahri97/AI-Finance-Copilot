"use client";

import { useCallback, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type SortDirection = "asc" | "desc";

/**
 * The scroll container belongs to the Table primitive, so the header can only
 * stick if that container is the thing with a height — hence the child
 * selector rather than a wrapper of our own.
 */
export const TABLE_SCROLL_AREA =
  "[&>[data-slot=table-container]]:max-h-[65vh] [&>[data-slot=table-container]]:overflow-auto";
export const TABLE_STICKY_HEAD =
  "bg-card sticky top-0 z-10 shadow-[inset_0_-1px_0_var(--border)]";

/**
 * Writes the `page` / `size` / `sort` / `dir` contract the paginated tables
 * share. A `null` value drops the param: defaults are expressed by absence,
 * so an unsorted first page at the default size is a bare URL.
 */
export function useTableSearchParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );
}

interface SortHeaderProps<Key extends string> {
  column: Key;
  label: string;
  sort: Key;
  direction: SortDirection;
  onSort: (column: Key) => void;
  align?: "left" | "right";
  className?: string;
}

export function SortHeader<Key extends string>({
  column,
  label,
  sort,
  direction,
  onSort,
  align = "left",
  className,
}: SortHeaderProps<Key>) {
  const active = sort === column;
  return (
    <TableHead
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={cn(TABLE_STICKY_HEAD, className)}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "hover:text-foreground focus-visible:ring-ring flex w-full items-center gap-1 rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none",
          align === "right" && "justify-end"
        )}
      >
        {label}
        {active ? (
          direction === "asc" ? (
            <ArrowUpIcon aria-hidden className="size-3.5" />
          ) : (
            <ArrowDownIcon aria-hidden className="size-3.5" />
          )
        ) : (
          <ChevronsUpDownIcon aria-hidden className="size-3.5 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

interface DataTablePaginationProps {
  page: number;
  pageCount: number;
  pageSize: number;
  pageSizeOptions: readonly number[];
  defaultPageSize: number;
  totalCount: number;
  /** Singular noun for the count line; pluralised with a trailing "s". */
  noun: string;
  locale?: string;
  /**
   * Extra summary alongside the count, for figures only one table has — the
   * transactions list puts its filtered income/expense/net totals here.
   */
  summary?: ReactNode;
  className?: string;
}

export function DataTablePagination({
  page,
  pageCount,
  pageSize,
  pageSizeOptions,
  defaultPageSize,
  totalCount,
  noun,
  locale = "en-US",
  summary,
  className,
}: DataTablePaginationProps) {
  const setParams = useTableSearchParams();

  function goToPage(target: number) {
    setParams({ page: target <= 1 ? null : String(target) });
  }

  function changePageSize(value: string) {
    setParams({ size: value === String(defaultPageSize) ? null : value, page: null });
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 pt-1 lg:flex-row lg:items-center lg:justify-between",
        className
      )}
    >
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="tabular-nums">
          {totalCount.toLocaleString(locale)} {noun}
          {totalCount === 1 ? "" : "s"}
          {pageCount > 1 && ` • page ${page} of ${pageCount}`}
        </span>
        {summary && (
          <>
            <span aria-hidden>·</span>
            {summary}
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Select value={String(pageSize)} onValueChange={changePageSize}>
          <SelectTrigger size="sm" className="w-32" aria-label="Rows per page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option} per page
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {pageCount > 1 && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
            >
              <ChevronLeftIcon />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pageCount}
              onClick={() => goToPage(page + 1)}
            >
              Next
              <ChevronRightIcon />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
