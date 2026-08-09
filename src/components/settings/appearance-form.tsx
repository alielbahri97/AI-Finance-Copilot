"use client";

import { useEffect, useState } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  feedback,
  isHapticsEnabled,
  isSoundEnabled,
  setFeedbackPreference,
  subscribeFeedbackPreferences,
} from "@/lib/feedback";
import { cn } from "@/lib/utils";

const THEMES = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const;

export function AppearanceForm() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [sound, setSound] = useState(true);
  const [haptics, setHaptics] = useState(true);

  // Avoid hydration mismatch: theme and device prefs are only known on the client.
  useEffect(() => {
    setMounted(true);
    setSound(isSoundEnabled());
    setHaptics(isHapticsEnabled());
    return subscribeFeedbackPreferences(() => {
      setSound(isSoundEnabled());
      setHaptics(isHapticsEnabled());
    });
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-3">
        {THEMES.map((option) => {
          const isActive = mounted && theme === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                feedback.select();
                setTheme(option.value);
              }}
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

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="feedback-sound">Sounds</Label>
            <p className="text-muted-foreground text-sm">
              Soft clicks and chimes on taps, toggles, and success or error toasts.
            </p>
          </div>
          <Switch
            id="feedback-sound"
            checked={mounted ? sound : true}
            onCheckedChange={(checked) => {
              setFeedbackPreference("sound", checked);
              setSound(checked);
              if (checked) feedback.success();
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="feedback-haptics">Vibration</Label>
            <p className="text-muted-foreground text-sm">
              Light haptics on supported phones (strongest in the installed PWA on Android).
            </p>
          </div>
          <Switch
            id="feedback-haptics"
            checked={mounted ? haptics : true}
            onCheckedChange={(checked) => {
              setFeedbackPreference("haptics", checked);
              setHaptics(checked);
              if (checked) feedback.tap();
            }}
          />
        </div>
      </div>
    </div>
  );
}
