"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";

interface AutoDunningFormProps {
  defaultEnabled: boolean;
  /** Whether the server can actually send mail right now. */
  emailConfigured: boolean;
}

/**
 * The opt-in for letting the hourly cron email customers without anyone
 * looking first. Off unless it is switched on, and honest about the fact that
 * it does nothing at all while email delivery is unconfigured.
 */
export function AutoDunningForm({ defaultEnabled, emailConfigured }: AutoDunningFormProps) {
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
        body: JSON.stringify({ autoDunningEnabled: next }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setEnabled(previous);
        toast.error("Could not change the setting", { description: data?.error });
        return;
      }
      toast.success(
        next
          ? "Customers will be reminded automatically as invoices fall due"
          : "Automatic reminders are off — you can still send them by hand"
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
          <p className="text-sm font-medium">Automatically remind customers of overdue invoices</p>
          <p className="text-muted-foreground text-sm">
            Once an hour, unpaid invoices you issued get one reminder at each stage — due soon,
            then 1, 15 and 30 days past due — sent to the customer address on the invoice. Each
            stage is sent once, and you get a notification for every email that goes out.
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={isSaving}
          onCheckedChange={(value) => void save(value)}
        />
      </div>
      {!emailConfigured && (
        <p className="text-muted-foreground text-sm">
          Email delivery isn&apos;t configured on this server, so nothing will be sent until{" "}
          <code className="font-mono">RESEND_API_KEY</code> and{" "}
          <code className="font-mono">EMAIL_FROM</code> are set.
        </p>
      )}
    </div>
  );
}
