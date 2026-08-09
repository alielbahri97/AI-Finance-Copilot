"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, Trash2Icon, UploadIcon } from "lucide-react";
import { toast } from "@/lib/toast";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { AvatarCropDialog } from "@/components/profile/avatar-crop-dialog";
import { getInitials } from "@/lib/utils";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT_ATTR = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

interface AvatarUploaderProps {
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

/**
 * Profile avatar picker: pick a photo → crop to a circle → upload. Remove
 * clears storage + profiles.avatar_url.
 */
export function AvatarUploader({ email, fullName, avatarUrl }: AvatarUploaderProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  const displayUrl = previewUrl ?? avatarUrl;
  const busy = isUploading || isRemoving;
  const hasPhoto = Boolean(displayUrl);

  function revokeCropSrc() {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  }

  function handleFilePick(file: File | undefined) {
    if (!file || busy) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      const isHeic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
      toast.error("Unsupported file", {
        description: isHeic
          ? "HEIC photos aren't supported — convert to JPG or PNG first."
          : "Upload a JPG, PNG or WebP image.",
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("File too large", {
        description: `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the maximum is 5 MB.`,
      });
      return;
    }

    revokeCropSrc();
    const objectUrl = URL.createObjectURL(file);
    setCropSrc(objectUrl);
    setCropOpen(true);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function uploadCroppedFile(file: File) {
    const localPreview = URL.createObjectURL(file);
    setPreviewUrl(localPreview);
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/profile/avatar", { method: "POST", body: formData });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Upload failed", { description: body?.error ?? "Try again." });
        setPreviewUrl(null);
        return;
      }
      toast.success("Avatar updated");
      setPreviewUrl(typeof body?.avatarUrl === "string" ? body.avatarUrl : null);
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
      setPreviewUrl(null);
    } finally {
      setIsUploading(false);
      URL.revokeObjectURL(localPreview);
      revokeCropSrc();
    }
  }

  async function handleRemove() {
    if (busy || (!avatarUrl && !previewUrl)) return;
    setIsRemoving(true);
    try {
      const response = await fetch("/api/profile/avatar", { method: "DELETE" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not remove avatar", { description: body?.error ?? "Try again." });
        return;
      }
      setPreviewUrl(null);
      toast.success("Avatar removed");
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsRemoving(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Avatar className="size-14">
          {displayUrl ? <AvatarImage src={displayUrl} alt={fullName ?? email} /> : null}
          <AvatarFallback className="text-base">{getInitials(fullName, email)}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT_ATTR}
              className="sr-only"
              disabled={busy}
              onChange={(event) => handleFilePick(event.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {isUploading ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
              {hasPhoto ? "Replace photo" : "Upload photo"}
            </Button>
            {hasPhoto ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void handleRemove()}
              >
                {isRemoving ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
                Remove
              </Button>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">JPG, PNG or WebP · max 5 MB · crop before save</p>
        </div>
      </div>

      <AvatarCropDialog
        imageSrc={cropSrc}
        open={cropOpen}
        onOpenChange={(open) => {
          setCropOpen(open);
          if (!open) revokeCropSrc();
        }}
        onCropped={uploadCroppedFile}
      />
    </>
  );
}
