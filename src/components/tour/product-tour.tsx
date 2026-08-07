"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  SparklesIcon,
  UploadCloudIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Edition } from "@/lib/branding";
import { productTourSteps, type TourStepId } from "@/lib/tour/steps";
import { cn } from "@/lib/utils";

const STEP_ICONS: Record<TourStepId, LucideIcon> = {
  welcome: SparklesIcon,
  connect: LandmarkIcon,
  transactions: ListChecksIcon,
  dashboard: LayoutDashboardIcon,
  copilot: SparklesIcon,
  cta: UploadCloudIcon,
};

type Props = {
  edition: Edition;
  /** Called after skip/complete so sibling prompts (e.g. passkey) can run. */
  onDone: () => void;
};

/**
 * Non-blocking multi-step overlay for first dashboard visit after onboarding.
 * Skip and complete both POST /api/tour/complete so the tour never returns.
 */
export function ProductTour({ edition, onDone }: Props) {
  const steps = productTourSteps(edition);
  const [open, setOpen] = useState(true);
  const [index, setIndex] = useState(0);
  const [pending, startTransition] = useTransition();

  const step = steps[index]!;
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;
  const Icon = STEP_ICONS[step.id];

  useEffect(() => {
    // Soft focus management: dialog handles a11y; keep index in range if steps change.
    if (index >= steps.length) setIndex(Math.max(0, steps.length - 1));
  }, [index, steps.length]);

  function finish() {
    startTransition(async () => {
      try {
        await fetch("/api/tour/complete", { method: "POST" });
      } catch {
        // Persistence failed — still dismiss so the user isn't trapped.
      } finally {
        setOpen(false);
        onDone();
      }
    });
  }

  function onOpenChange(next: boolean) {
    if (!next) {
      finish();
      return;
    }
    setOpen(true);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-5 rounded-2xl sm:max-w-md"
        showCloseButton={false}
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          finish();
        }}
      >
        <DialogHeader className="space-y-3 text-left sm:text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="bg-primary text-primary-foreground flex size-11 shrink-0 items-center justify-center rounded-xl shadow-xs">
              <Icon className="size-5" aria-hidden />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={finish}
              className="text-muted-foreground -mt-1 -mr-2"
            >
              Skip
            </Button>
          </div>
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Step {index + 1} of {steps.length}
            </p>
            <DialogTitle className="text-xl">{step.title}</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              {step.body}
            </DialogDescription>
          </div>
        </DialogHeader>

        <ol className="flex items-center gap-1.5" aria-hidden>
          {steps.map((s, i) => (
            <li
              key={s.id}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                i <= index ? "bg-primary" : "bg-muted"
              )}
            />
          ))}
        </ol>

        <DialogFooter className="gap-2 sm:flex-col sm:space-x-0">
          {isLast ? (
            <>
              {step.href && step.hrefLabel ? (
                <Button asChild className="w-full" disabled={pending}>
                  <Link href={step.href} onClick={finish}>
                    {step.hrefLabel}
                    <ArrowRightIcon />
                  </Link>
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={pending}
                onClick={finish}
              >
                Got it
              </Button>
            </>
          ) : (
            <div className="flex w-full gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={isFirst || pending}
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
              >
                <ArrowLeftIcon />
                Back
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={pending}
                onClick={() => setIndex((i) => Math.min(steps.length - 1, i + 1))}
              >
                Next
                <ArrowRightIcon />
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
