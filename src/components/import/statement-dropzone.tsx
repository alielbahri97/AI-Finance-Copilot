"use client";

import { useRef, useState } from "react";
import { FileSpreadsheetIcon, Loader2Icon, UploadCloudIcon } from "lucide-react";
import { toast } from "sonner";

import {
  ACCEPTED_FORMATS_SENTENCE,
  isSupportedStatementFile,
  UPLOAD_ACCEPT_ATTRIBUTE,
} from "@/lib/import/format";
import { cn } from "@/lib/utils";
import { MAX_IMPORT_FILE_MB } from "@/lib/validations/import";

interface StatementDropzoneProps {
  onFile: (file: File) => void;
  isLoading: boolean;
}

export function StatementDropzone({ onFile, isLoading }: StatementDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (!isSupportedStatementFile(file.name)) {
      toast.error("Unsupported file", {
        description: `Upload a ${ACCEPTED_FORMATS_SENTENCE} statement (.csv, .tsv, .xlsx, .xls, .pdf, .mt940, .sta).`,
      });
      return;
    }
    if (file.size > MAX_IMPORT_FILE_MB * 1024 * 1024) {
      toast.error("File is too large", {
        description: `Statements up to ${MAX_IMPORT_FILE_MB} MB can be imported.`,
      });
      return;
    }
    onFile(file);
  }

  return (
    <button
      type="button"
      disabled={isLoading}
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        handleFile(event.dataTransfer.files?.[0]);
      }}
      className={cn(
        "flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors",
        isDragging
          ? "border-primary bg-accent/60"
          : "border-border hover:border-primary/50 hover:bg-accent/30",
        isLoading && "pointer-events-none opacity-60"
      )}
      aria-label="Upload a bank statement"
    >
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT_ATTRIBUTE}
        className="hidden"
        onChange={(event) => {
          handleFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <div className="bg-accent text-accent-foreground flex size-14 items-center justify-center rounded-full">
        {isLoading ? (
          <Loader2Icon className="size-7 animate-spin" />
        ) : isDragging ? (
          <FileSpreadsheetIcon className="size-7" />
        ) : (
          <UploadCloudIcon className="size-7" />
        )}
      </div>
      <div>
        <p className="font-medium">
          {isLoading ? "Analyzing your file…" : "Drop your bank statement here"}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          or click to browse — {ACCEPTED_FORMATS_SENTENCE} exports up to {MAX_IMPORT_FILE_MB} MB.
          Delimiters, encodings, number formats and dates are detected automatically.
        </p>
      </div>
    </button>
  );
}
