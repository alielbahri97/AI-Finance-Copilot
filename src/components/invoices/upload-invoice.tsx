"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileTextIcon, Loader2Icon, PlusIcon, UploadCloudIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Upload dialog: drag & drop an invoice (PDF/JPG/PNG/WebP), the server
 * stores it and runs AI extraction, then we navigate to the review form.
 */
export function UploadInvoice() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [direction, setDirection] = useState<"PAYABLE" | "RECEIVABLE">("PAYABLE");

  async function handleFile(file: File | undefined) {
    if (!file || isUploading) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      const isHeic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
      toast.error("Unsupported file", {
        description: isHeic
          ? "HEIC photos aren't supported — convert to JPG or PNG first."
          : "Upload a PDF, JPG, PNG or WebP document.",
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("File too large", {
        description: `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the maximum is 10 MB.`,
      });
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("direction", direction);
      const response = await fetch("/api/invoices/upload", { method: "POST", body: formData });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Upload failed", { description: body?.error ?? "Try again." });
        return;
      }
      if (body.extractionStatus === "EXTRACTED") {
        toast.success("Invoice extracted", { description: "Review the fields and confirm." });
      } else {
        toast.info("Needs review", {
          description:
            body.reviewReason ??
            "We could not extract this document automatically — fill in the details.",
        });
      }
      setOpen(false);
      router.push(`/invoices/${body.invoiceId}`);
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        Upload invoice
      </Button>

      <Dialog open={open} onOpenChange={(next) => !isUploading && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload an invoice</DialogTitle>
            <DialogDescription>
              PDF invoices, receipts and photos (JPG, PNG, WebP). We extract the details with AI
              and let you review them before saving.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label>Type</Label>
            <Tabs
              value={direction}
              onValueChange={(value) => setDirection(value as "PAYABLE" | "RECEIVABLE")}
            >
              <TabsList className="w-full">
                <TabsTrigger value="PAYABLE">Bill to pay</TabsTrigger>
                <TabsTrigger value="RECEIVABLE">Invoice I issued</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <button
            type="button"
            disabled={isUploading}
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
              "flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors",
              isDragging
                ? "border-primary bg-accent/60"
                : "border-border hover:border-primary/50 hover:bg-accent/30",
              isUploading && "pointer-events-none opacity-60"
            )}
            aria-label="Upload an invoice document"
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                handleFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <div className="bg-accent text-accent-foreground flex size-14 items-center justify-center rounded-full">
              {isUploading ? (
                <Loader2Icon className="size-7 animate-spin" />
              ) : isDragging ? (
                <FileTextIcon className="size-7" />
              ) : (
                <UploadCloudIcon className="size-7" />
              )}
            </div>
            <div>
              <p className="font-medium">
                {isUploading ? "Uploading & extracting…" : "Drop your invoice here"}
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                or click to browse — PDF or image up to 10 MB
              </p>
            </div>
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
