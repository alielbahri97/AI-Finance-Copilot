"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  CheckIcon,
  Loader2Icon,
} from "lucide-react";
import { toast } from "@/lib/toast";

import { StatementDropzone } from "@/components/import/statement-dropzone";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { BRAND } from "@/lib/branding";
import { normalizeRows } from "@/lib/csv/normalize";
import type { ColumnMapping, ColumnRole, NormalizedRow, RowError, StatementCurrencyInfo } from "@/lib/csv/types";
import type { StatementFormat } from "@/lib/import/types";
import { cn, formatCurrency, localeForCurrency } from "@/lib/utils";

interface ParseResponse {
  fileName: string;
  format: StatementFormat;
  /** How the file was read ("Excel sheet \"Sheet1\"", "MT940 statement in EUR", …). */
  source: string;
  columnCount: number;
  rowCount: number;
  headers: string[] | null;
  sampleRows: string[][];
  mapping: ColumnMapping;
  preview: NormalizedRow[];
  previewErrors: RowError[];
  profileCurrency: string;
  statementCurrency: StatementCurrencyInfo;
  currencyMismatch: boolean;
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
  /** Rows the AI categorized after no rule matched them. */
  aiCategorized?: number;
  /** Why the AI did less than it could have (an exhausted monthly allowance). */
  aiCategorizationNote?: string | null;
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
  { value: "currency", label: "Currency" },
];

const MAPPED_ROLES = [
  "date",
  "description",
  "amount",
  "debit",
  "credit",
  "balance",
  "counterparty",
  "currency",
] as const;

function roleOfColumn(mapping: UiMapping, columnIndex: number): ColumnRole {
  for (const role of MAPPED_ROLES) {
    if (mapping[role] === columnIndex) return role;
  }
  return "ignore";
}

type WizardStep = "upload" | "map" | "done";

const STEPS: { id: WizardStep; label: string }[] = [
  { id: "upload", label: "Upload file" },
  { id: "map", label: "Map columns" },
  { id: "done", label: "Import" },
];

/**
 * Where the user is in upload → map → import. Worded the same way as the
 * onboarding wizard's progress bar so the two feel like the same product.
 */
function StepIndicator({ step }: { step: WizardStep }) {
  const index = STEPS.findIndex((entry) => entry.id === step);
  const current = index + 1;

  return (
    <div className="space-y-2">
      <div
        role="progressbar"
        aria-label="Import progress"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={current}
        aria-valuetext={`Step ${current} of ${STEPS.length}: ${STEPS[index].label}`}
        className="bg-muted h-1.5 overflow-hidden rounded-full"
      >
        <div
          className="bg-primary h-full transition-all duration-300"
          style={{ width: `${(current / STEPS.length) * 100}%` }}
        />
      </div>
      <ol className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {STEPS.map((entry, entryIndex) => (
          <li
            key={entry.id}
            aria-current={entryIndex === index ? "step" : undefined}
            className={cn(
              "flex items-center gap-1.5",
              entryIndex === index && "text-foreground font-medium"
            )}
          >
            {entryIndex < index ? (
              <CheckIcon aria-hidden className="text-success size-3.5" />
            ) : (
              <span aria-hidden className="numeric w-3.5 text-center">
                {entryIndex + 1}
              </span>
            )}
            {entry.label}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Every step gets the same frame, so the indicator never jumps or disappears. */
function WizardShell({ step, children }: { step: WizardStep; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <StepIndicator step={step} />
      {children}
    </div>
  );
}

interface ImportWizardProps {
  currency: string;
}

export function ImportWizard({ currency }: ImportWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ParseResponse | null>(null);
  const [mapping, setMapping] = useState<UiMapping | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [result, setResult] = useState<CommitResponse | null>(null);
  const [applyStatementCurrency, setApplyStatementCurrency] = useState(false);

  const mappingValid =
    mapping !== null &&
    mapping.date !== null &&
    mapping.description !== null &&
    (mapping.amount !== null || mapping.debit !== null || mapping.credit !== null);

  const displayCurrency =
    applyStatementCurrency && parseResult?.statementCurrency.code
      ? parseResult.statementCurrency.code
      : (parseResult?.profileCurrency ?? currency);
  const displayLocale = localeForCurrency(displayCurrency);

  const preview = useMemo(() => {
    if (!parseResult || !mapping || !mappingValid) return null;
    const expectedCurrency =
      mapping.currency !== null ? displayCurrency : null;
    return normalizeRows(parseResult.sampleRows, mapping as ColumnMapping, {
      expectedCurrency,
    });
  }, [parseResult, mapping, mappingValid, displayCurrency]);

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
      setMapping({
        ...parsed.mapping,
        currency: parsed.mapping.currency ?? null,
      });
      // Default to adopting the statement currency when it differs and is known.
      setApplyStatementCurrency(
        Boolean(parsed.currencyMismatch && parsed.statementCurrency.code)
      );
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
      if (applyStatementCurrency) {
        formData.append("applyStatementCurrency", "true");
      }
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
    setApplyStatementCurrency(false);
  }

  /* ---------------- Step: upload ---------------- */
  if (step === "upload") {
    return (
      <WizardShell step="upload">
        <StatementDropzone onFile={handleFile} isLoading={isParsing} />
      </WizardShell>
    );
  }

  /* ---------------- Step: done ---------------- */
  if (step === "done" && result) {
    return (
      <WizardShell step="done">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <div className="bg-success/10 text-success flex size-14 items-center justify-center rounded-full">
              <CheckCircle2Icon className="size-7" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Import complete</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {result.imported} imported · {result.duplicates} duplicates skipped
                {result.aiCategorized ? ` · ${result.aiCategorized} auto-categorized by AI` : ""}
                {result.failed > 0 && ` · ${result.failed} rows could not be read`}
              </p>
            </div>
            {result.aiCategorizationNote && (
              <Alert className="max-w-lg text-left">
                <AlertTitle>AI categorization paused</AlertTitle>
                <AlertDescription>{result.aiCategorizationNote}</AlertDescription>
              </Alert>
            )}
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
      </WizardShell>
    );
  }

  /* ---------------- Step: map ---------------- */
  if (!parseResult || !mapping) return null;

  return (
    <WizardShell step="map">
      {/*
       * Sticks under the 4rem app header. Checking the mapping means scrolling
       * through the column table and the preview below, and the whole point of
       * the step is to act on what you just checked — so the action goes with
       * you instead of staying at the top of the page.
       */}
      <div className="bg-background/95 sticky top-16 z-30 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="secondary">{parseResult.fileName}</Badge>
          <span className="text-muted-foreground">
            {parseResult.rowCount.toLocaleString()} rows · {parseResult.source}
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

      {parseResult.format === "pdf" && (
        <Alert>
          <AlertTitle>Read from a PDF — check these rows</AlertTitle>
          <AlertDescription>
            PDF statements have no fixed structure, so dates, descriptions and amounts were
            recovered from the printed layout. Review the preview below before importing; if
            anything looks off, your bank&apos;s CSV, Excel or MT940 export is more reliable.
          </AlertDescription>
        </Alert>
      )}

      {!mappingValid && (
        <Alert variant="destructive">
          <AlertTitle>Mapping incomplete</AlertTitle>
          <AlertDescription>
            Assign a Date column, a Description column, and either a signed Amount column or the
            Debit/Credit pair.
          </AlertDescription>
        </Alert>
      )}

      {parseResult.statementCurrency.code && (
        <Alert>
          <AlertTitle>
            Statement currency: {parseResult.statementCurrency.code}
            {parseResult.statementCurrency.mixed
              ? ` (mixed: ${parseResult.statementCurrency.codes.join(", ")})`
              : ""}
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            {parseResult.currencyMismatch ? (
              <p>
                Your profile is set to <strong>{parseResult.profileCurrency}</strong>, but this
                file looks like <strong>{parseResult.statementCurrency.code}</strong>.{" "}
                {BRAND.name} does not convert FX — amounts are labeled with your profile currency
                unless you update it.
              </p>
            ) : (
              <p>
                Amounts will be shown as {parseResult.profileCurrency}.
                {parseResult.statementCurrency.mixed
                  ? " Rows in other currencies will be skipped."
                  : ""}
              </p>
            )}
            {parseResult.currencyMismatch && (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={applyStatementCurrency}
                  onCheckedChange={(checked) => setApplyStatementCurrency(checked === true)}
                  className="mt-0.5"
                />
                <span>
                  Update my profile currency to {parseResult.statementCurrency.code} when
                  importing
                </span>
              </label>
            )}
            {parseResult.statementCurrency.mixed && mapping.currency !== null && (
              <p className="text-muted-foreground text-xs">
                Only rows in {displayCurrency} will be imported; other currencies are skipped.
              </p>
            )}
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
                          // Ignored columns are de-emphasised by dropping from
                          // `--foreground` to `--muted-foreground`, not by an
                          // alpha on top of it: at /60 this preview text was
                          // 2.45:1 and unreadable, and the user still has to be
                          // able to check *which* columns they are skipping.
                          roleOfColumn(mapping, columnIndex) === "ignore" &&
                            "text-muted-foreground"
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
                        {formatCurrency(row.amount, displayCurrency, displayLocale)}
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
    </WizardShell>
  );
}
