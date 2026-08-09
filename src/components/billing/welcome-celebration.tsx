"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { PartyPopperIcon, SparklesIcon } from "lucide-react";

import { runCelebration } from "@/components/billing/celebration-particles";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { feedback } from "@/lib/feedback";

export type CelebrationVariant = "enterprise" | "welcome";

type Props = {
  variant: CelebrationVariant;
  /** Called after the dialog is dismissed so sibling prompts can continue. */
  onDone: () => void;
};

const COPY: Record<
  CelebrationVariant,
  { title: string; description: string; cta: string; icon: "party" | "sparkles" }
> = {
  enterprise: {
    title: "You're on Enterprise",
    description:
      "Admin promoted you to the Enterprise version. Enjoy unlimited access across Ballast — every feature, every limit unlocked.",
    cta: "Let's go",
    icon: "party",
  },
  welcome: {
    title: "Welcome to Ballast",
    description:
      "You're in. Your dashboard is ready — explore accounts, insights, and tools built to keep money decisions clear.",
    cta: "Let's go",
    icon: "sparkles",
  },
};

/**
 * One-shot full-viewport gems + confetti celebration for every member.
 * Copy varies: complimentary Enterprise grant vs general welcome.
 */
export function WelcomeCelebration({ variant, onDone }: Props) {
  const [open, setOpen] = useState(true);
  const [pending, startTransition] = useTransition();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const copy = COPY[variant];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    feedback.celebration();
    const { stop } = runCelebration(canvas);
    return stop;
  }, []);

  function finish() {
    startTransition(async () => {
      try {
        await fetch("/api/celebration/complete", { method: "POST" });
      } catch {
        // Persistence failed — still dismiss so the user isn't trapped.
      } finally {
        setOpen(false);
        onDone();
      }
    });
  }

  const Icon = copy.icon === "party" ? PartyPopperIcon : SparklesIcon;

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
              <Icon className="size-6" />
            </div>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={finish} disabled={pending}>
              {copy.cta}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
