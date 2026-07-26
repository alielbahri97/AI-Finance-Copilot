"use client";

import { useRef, useState } from "react";
import { FileSpreadsheetIcon, Loader2Icon, UploadCloudIcon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

interface CsvDropzoneProps {
  onFile: (file: File) => void;
  isLoading: boolean;
}

const ACCEPTED_EXTENSIONS = [".csv", ".txt", ".tsv"];

export function CsvDropzone({ onFile, isLoading }: CsvDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  function handleFile(file: File | undefined) {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension))) {
      toast.error("Unsupported file", { description: "Upload a .csv, .tsv or .txt export." });
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
      aria-label="Upload a CSV bank statement"
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
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
          or click to browse — CSV exports up to 8 MB. Delimiters, encodings and number
          formats are detected automatically.
        </p>
      </div>
    </button>
  );
}
