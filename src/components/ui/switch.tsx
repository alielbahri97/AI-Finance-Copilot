"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { feedback } from "@/lib/feedback";
import { cn } from "@/lib/utils";

function Switch({
  className,
  onCheckedChange,
  withFeedback = true,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  /** Soft tick on change. Set false when the caller plays its own cue after updating prefs. */
  withFeedback?: boolean;
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
      onCheckedChange={(checked) => {
        // Consumer first so preference toggles can persist before any cue runs.
        onCheckedChange?.(checked);
        if (withFeedback) feedback.toggle();
      }}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
