"use client";

import * as React from "react";
import type { VariantProps } from "class-variance-authority";
import { Loader2Icon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { buttonVariants } from "@/components/ui/button";

interface ConfirmDialogProps {
  title: React.ReactNode;
  description: React.ReactNode;
  /** Runs on confirm; the dialog stays open with a spinner until it settles. */
  onConfirm: () => void | Promise<void>;
  /** Rendered as the trigger. Omit it and drive `open`/`onOpenChange` instead. */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: VariantProps<typeof buttonVariants>["variant"];
}

/**
 * Confirmation step for destructive actions. Radix puts initial focus on
 * Cancel, keeps Escape as a cancel, and wires the description up with
 * `aria-describedby`.
 */
export function ConfirmDialog({
  title,
  description,
  onConfirm,
  trigger,
  open,
  onOpenChange,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  variant = "destructive",
}: ConfirmDialogProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;

  function setOpen(next: boolean) {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  async function handleConfirm(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    setPending(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={(next) => !pending && setOpen(next)}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction variant={variant} disabled={pending} onClick={handleConfirm}>
            {pending && <Loader2Icon className="animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
