"use client";

import { useEffect, useState } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";

const THEMES = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const;

export function AppearanceForm() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch: theme is only known on the client.
  useEffect(() => setMounted(true), []);

  return (
    <div className="flex flex-wrap gap-3">
      {THEMES.map((option) => {
        const isActive = mounted && theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setTheme(option.value)}
            className={cn(
              "flex w-28 cursor-pointer flex-col items-center gap-2 rounded-lg border p-4 text-sm font-medium transition-colors",
              isActive
                ? "border-primary bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
            )}
            aria-pressed={isActive}
          >
            <option.icon className="size-5" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
