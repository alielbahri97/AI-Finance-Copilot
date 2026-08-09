"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";

import { Switch } from "@/components/ui/switch";

interface AiCategorizationFormProps {
  defaultEnabled: boolean;
  /** Rows the plan allows per month; null = unlimited. */
  monthlyLimit: number | null;
  used: number;
}

export function AiCategorizationForm({
  defaultEnabled,
  monthlyLimit,
  used,
}: AiCategorizationFormProps) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [isSaving, setIsSaving] = useState(false);

  async function save(next: boolean) {
    const previous = enabled;
    setEnabled(next);
    setIsSaving(true);
    try {
      const response = await fetch("/api/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiCategorizationEnabled: next }),
      });
      if (!response.ok) {
        setEnabled(previous);
        toast.error("Could not change the setting");
        return;
      }
      toast.success(
        next
          ? "New imports will be categorized by AI"
          : "AI categorization is off — your rules still apply"
      );
      router.refresh();
    } catch {
      setEnabled(previous);
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Categorize imported transactions with AI</p>
          <p className="text-muted-foreground text-sm">
            After your own rules run, anything still uncategorized is sent to the AI in
            batches. Only confident matches are applied, and a rule always wins.
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={isSaving}
          onCheckedChange={(value) => void save(value)}
        />
      </div>
      <p className="text-muted-foreground text-sm">
        {monthlyLimit === null
          ? `Unlimited on your plan — ${used.toLocaleString()} transactions categorized this month.`
          : `${used.toLocaleString()} of ${monthlyLimit.toLocaleString()} transactions used this month.`}
      </p>
    </div>
  );
}
