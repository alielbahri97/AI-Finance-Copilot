"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { PartyPopperIcon } from "lucide-react";

import { runEnterpriseCelebration } from "@/components/billing/enterprise-celebration";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  /** Called after the dialog is dismissed so sibling prompts can continue. */
  onDone: () => void;
};

/**
 * One-shot celebration for complimentary Enterprise grants.
 * Full-viewport gems + confetti behind the dialog; dismiss POSTs so it never returns.
 */
export function EnterprisePromo({ onDone }: Props) {
  const [open, setOpen] = useState(true);
  const [pending, startTransition] = useTransition();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { stop } = runEnterpriseCelebration(canvas);
    return stop;
  }, []);

  function finish() {
    startTransition(async () => {
      try {
        await fetch("/api/billing/enterprise-promo/complete", { method: "POST" });
      } catch {
        // Persistence failed — still dismiss so the user isn't trapped.
      } finally {
        setOpen(false);
        onDone();
      }
    });
  }

  return (
    <>
      {/* Soft dim so particles read against the dashboard without blocking clicks. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[55] bg-background/35 backdrop-blur-[1px]"
      />
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[60]"
      />
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) finish();
        }}
      >
        <DialogContent className="z-[70] sm:max-w-md">
          <DialogHeader>
            <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-teal-500/15 text-teal-700 dark:text-teal-300">
              <PartyPopperIcon className="size-6" />
            </div>
            <DialogTitle>You&apos;re on Enterprise</DialogTitle>
            <DialogDescription>
              Admin promoted you to the Enterprise version. Enjoy unlimited access across
              Ballast — every feature, every limit unlocked.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={finish} disabled={pending}>
              Let&apos;s go
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
