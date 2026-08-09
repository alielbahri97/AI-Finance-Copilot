"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { feedback } from "@/lib/feedback";
import { cn } from "@/lib/utils";

function Switch({
  className,
  onCheckedChange,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
      onCheckedChange={(checked) => {
        feedback.toggle();
        onCheckedChange?.(checked);
      }}
    />
  );
}

export { Switch };
