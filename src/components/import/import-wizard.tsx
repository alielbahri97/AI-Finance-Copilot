"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  Loader2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { CsvDropzone } from "@/components/import/csv-dropzone";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { normalizeRows } from "@/lib/csv/normalize";
import type { ColumnMapping, ColumnRole, NormalizedRow, RowError } from "@/lib/csv/types";
import { cn, formatCurrency } from "@/lib/utils";

interface ParseResponse {
  fileName: string;
  delimiter: string;
  columnCount: number;
  rowCount: number;
  headers: string[] | null;
  sampleRows: string[][];
  mapping: ColumnMapping;
  preview: NormalizedRow[];
  previewErrors: RowError[];
}

/** Like ColumnMapping, but date/description may be unassigned while editing. */
type UiMapping = Omit<ColumnMapping, "date" | "description"> & {
  date: number | null;
  description: number | null;
};

interface CommitResponse {
  imported: number;
  duplicates: number;
  failed: number;
  rowErrors: RowError[];
  batchId: string | null;
}

const ROLE_OPTIONS: { value: ColumnRole; label: string }[] = [
  { value: "ignore", label: "Ignore" },
  { value: "date", label: "Date" },
  { value: "description", label: "Description" },
  { value: "amount", label: "Amount (signed)" },
  { value: "debit", label: "Debit (money out)" },
  { value: "credit", label: "Credit (money in)" },
  { value: "balance", label: "Balance" },
  { value: "counterparty", label: "Counterparty" },
];

const MAPPED_ROLES = [
  "date",
  "description",
  "amount",
  "debit",
  "credit",
  "balance",
  "counterparty",
] as const;

function roleOfColumn(mapping: UiMapping, columnIndex: number): ColumnRole {
  for (const role of MAPPED_ROLES) {
    if (mapping[role] === columnIndex) return role;
  }
  return "ignore";
}

interface ImportWizardProps {
  currency: string;
}

export function ImportWizard({ currency }: ImportWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<"upload" | "map" | "done">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ParseResponse | null>(null);
  const [mapping, setMapping] = useState<UiMapping | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [result, setResult] = useState<CommitResponse | null>(null);

  const mappingValid =
    mapping !== null &&
    mapping.date !== null &&
    mapping.description !== null &&
    (mapping.amount !== null || mapping.debit !== null || mapping.credit !== null);

  const preview = useMemo(() => {
    if (!parseResult || !mapping || !mappingValid) return null;
    return normalizeRows(parseResult.sampleRows, mapping as ColumnMapping);
  }, [parseResult, mapping, mappingValid]);

  async function handleFile(selected: File) {
    setIsParsing(true);
    try {
      const formData = new FormData();
      formData.append("file", selected);
      const response = await fetch("/api/import/parse", { method: "POST", body: formData });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not read the file", { description: body?.error ?? "Try again." });
        return;
      }
      const parsed = body as ParseResponse;
      setFile(selected);
      setParseResult(parsed);
      setMapping(parsed.mapping);
      setStep("map");
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsParsing(false);
    }
  }

  function setColumnRole(columnIndex: number, role: ColumnRole) {
    setMapping((previous) => {
      if (!previous) return previous;
      const next: UiMapping = { ...previous };
      // A column holds at most one role, and a role at most one column.
      for (const existing of MAPPED_ROLES) {
        if (next[existing] === columnIndex) next[existing] = null;
      }
      if (role !== "ignore") {
        next[role] = columnIndex;
        // A signed amount column and a debit/credit pair are mutually exclusive.
        if (role === "amount") {
          next.debit = null;
          next.credit = null;
        }
        if (role === "debit" || role === "credit") {
          next.amount = null;
        }
      }
      return next;
    });
  }

  async function handleCommit() {
    if (!file || !mapping) return;
    setIsCommitting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mapping", JSON.stringify(mapping));
      const response = await fetch("/api/import/commit", { method: "POST", body: formData });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Import failed", { description: body?.error ?? "Try again." });
        return;
      }
      const commit = body as CommitResponse;
      setResult(commit);
      setStep("done");
      if (commit.imported > 0) {
        toast.success(`Imported ${commit.imported} transactions`);
      } else {
        toast.info("Nothing new to import", {
          description: "All rows were already imported previously.",
        });
      }
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsCommitting(false);
    }
  }

  function reset() {
    setStep("upload");
    setFile(null);
    setParseResult(null);
    setMapping(null);
    setResult(null);
  }

  /* ---------------- Step: upload ---------------- */
  if (step === "upload") {
    return <CsvDropzone onFile={handleFile} isLoading={isParsing} />;
  }

  /* ---------------- Step: done ---------------- */
  if (step === "done" && result) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="bg-success/15 text-success flex size-14 items-center justify-center rounded-full">
            <CheckCircle2Icon className="size-7" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Import complete</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {result.imported} imported · {result.duplicates} duplicates skipped
              {result.failed > 0 && ` · ${result.failed} rows could not be read`}
            </p>
          </div>
          {result.rowErrors.length > 0 && (
            <Alert className="max-w-lg text-left">
              <AlertTitle>Some rows were skipped</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {result.rowErrors.slice(0, 5).map((error) => (
                    <li key={error.rowNumber}>
                      Row {error.rowNumber}: {error.message}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <div className="flex gap-2">
            <Button asChild>
              <Link href="/transactions">View transactions</Link>
            </Button>
            <Button variant="outline" onClick={reset}>
              Import another file
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  /* ---------------- Step: map ---------------- */
  if (!parseResult || !mapping) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="secondary">{parseResult.fileName}</Badge>
          <span className="text-muted-foreground">
            {parseResult.rowCount.toLocaleString()} rows ·{" "}
            {parseResult.delimiter === "\t" ? "tab" : `"${parseResult.delimiter}"`} separated
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={reset}>
            <ArrowLeftIcon />
            Start over
          </Button>
          <Button onClick={handleCommit} disabled={!mappingValid || isCommitting}>
            {isCommitting ? <Loader2Icon className="animate-spin" /> : <ArrowRightIcon />}
            Import {parseResult.rowCount.toLocaleString()} rows
          </Button>
        </div>
      </div>

      {!mappingValid && (
        <Alert variant="destructive">
          <AlertTitle>Mapping incomplete</AlertTitle>
          <AlertDescription>
            Assign a Date column, a Description column, and either a signed Amount column or the
            Debit/Credit pair.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="grid gap-1.5">
              <Label className="text-muted-foreground text-xs">Number format</Label>
              <Select
                value={mapping.numberFormat}
                onValueChange={(value) =>
                  setMapping({ ...mapping, numberFormat: value as ColumnMapping["numberFormat"] })
                }
              >
                <SelectTrigger size="sm" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="us">US — 1,234.56</SelectItem>
                  <SelectItem value="eu">European — 1.234,56</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-muted-foreground text-xs">Date format</Label>
              <Select
                value={mapping.dateFormat}
                onValueChange={(value) =>
                  setMapping({ ...mapping, dateFormat: value as ColumnMapping["dateFormat"] })
                }
              >
                <SelectTrigger size="sm" className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ymd">Year-Month-Day (2026-07-26)</SelectItem>
                  <SelectItem value="dmy">Day-Month-Year (26/07/2026)</SelectItem>
                  <SelectItem value="mdy">Month-Day-Year (07/26/2026)</SelectItem>
                  <SelectItem value="compact">Compact (20260726)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-muted-foreground text-xs">
              Assign a role to each column below. The preview updates as you go.
            </p>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {Array.from({ length: parseResult.columnCount }, (_, columnIndex) => (
                    <TableHead key={columnIndex} className="min-w-40 align-top">
                      <div className="flex flex-col gap-1.5 py-1.5">
                        <Select
                          value={roleOfColumn(mapping, columnIndex)}
                          onValueChange={(value) => setColumnRole(columnIndex, value as ColumnRole)}
                        >
                          <SelectTrigger
                            size="sm"
                            className={cn(
                              "w-full",
                              roleOfColumn(mapping, columnIndex) !== "ignore" &&
                                "border-primary/40 bg-accent/50"
                            )}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {parseResult.headers && (
                          <span className="text-muted-foreground truncate text-xs font-normal">
                            {parseResult.headers[columnIndex] || `Column ${columnIndex + 1}`}
                          </span>
                        )}
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {parseResult.sampleRows.map((row, rowIndex) => (
                  <TableRow key={rowIndex}>
                    {Array.from({ length: parseResult.columnCount }, (_, columnIndex) => (
                      <TableCell
                        key={columnIndex}
                        className={cn(
                          "max-w-56 truncate text-xs",
                          roleOfColumn(mapping, columnIndex) === "ignore" &&
                            "text-muted-foreground/60"
                        )}
                        title={row[columnIndex]}
                      >
                        {row[columnIndex] || "—"}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                Preview — how the first rows will be imported
              </h3>
              {preview.errors.length > 0 && (
                <Badge variant="destructive">
                  {preview.errors.length} of {parseResult.sampleRows.length} sample rows skipped
                </Badge>
              )}
            </div>
            {preview.ok.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-sm">
                Nothing could be read with this mapping — adjust the column roles or formats
                above.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Counterparty</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.ok.map((row, index) => (
                    <TableRow key={index}>
                      <TableCell className="text-muted-foreground">{row.date}</TableCell>
                      <TableCell className="max-w-64 truncate">{row.description}</TableCell>
                      <TableCell className="text-muted-foreground max-w-40 truncate">
                        {row.counterparty ?? "—"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-semibold tabular-nums",
                          row.type === "INCOME" ? "text-success" : "text-foreground"
                        )}
                      >
                        {row.type === "INCOME" ? "+" : "-"}
                        {formatCurrency(row.amount, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {preview.errors.length > 0 && (
              <ul className="text-destructive list-disc pl-5 text-xs">
                {preview.errors.slice(0, 3).map((error) => (
                  <li key={error.rowNumber}>
                    Sample row {error.rowNumber}: {error.message}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
