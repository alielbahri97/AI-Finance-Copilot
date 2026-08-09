"use client";

import { useState } from "react";
import { ExternalLinkIcon, Loader2Icon } from "lucide-react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";

export function PortalButton({ disabled }: { disabled?: boolean }) {
  const [isLoading, setIsLoading] = useState(false);

  async function openPortal() {
    setIsLoading(true);
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const body = (await response.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;
      if (!response.ok || !body?.url) {
        throw new Error(body?.error ?? "Could not open the billing portal");
      }
      window.location.href = body.url;
    } catch (error) {
      toast.error("Billing portal unavailable", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
      setIsLoading(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled || isLoading}
      onClick={() => void openPortal()}
      title={disabled ? "Billing is not configured on this server" : undefined}
    >
      {isLoading ? (
        <Loader2Icon className="size-4 animate-spin" />
      ) : (
        <ExternalLinkIcon className="size-4" />
      )}
      Manage billing
    </Button>
  );
}
