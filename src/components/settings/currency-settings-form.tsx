"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { currencyFromLocationText } from "@/lib/currency/location";
import {
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
} from "@/lib/validations/profile";

interface CurrencySettingsFormProps {
  defaultCurrency: SupportedCurrency;
  locationHint?: string | null;
}

export function CurrencySettingsForm({
  defaultCurrency,
  locationHint,
}: CurrencySettingsFormProps) {
  const router = useRouter();
  const [currency, setCurrency] = useState<SupportedCurrency>(defaultCurrency);
  const [isSaving, setIsSaving] = useState(false);

  const suggested = useMemo(
    () => currencyFromLocationText(locationHint),
    [locationHint]
  );

  async function save(next: SupportedCurrency) {
    const previous = currency;
    setCurrency(next);
    setIsSaving(true);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency: next }),
      });
      if (!response.ok) {
        setCurrency(previous);
        toast.error("Could not update currency");
        return;
      }
      toast.success(`Preferred currency set to ${next}`);
      router.refresh();
    } catch {
      setCurrency(previous);
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="grid max-w-sm gap-2">
      <Label htmlFor="preferred-currency">Preferred currency</Label>
      <Select
        value={currency}
        onValueChange={(value) => void save(value as SupportedCurrency)}
        disabled={isSaving}
      >
        <SelectTrigger id="preferred-currency" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_CURRENCIES.map((code) => (
            <SelectItem key={code} value={code}>
              {code}
              {suggested === code ? " (from your location)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-sm">
        {suggested
          ? `Based on your business location${locationHint ? ` (${locationHint})` : ""}, we suggest ${suggested}.`
          : "Chosen from your signup location (IP / browser). Add a business location in Profile to refine it."}
        {isSaving ? (
          <Loader2Icon className="ml-1 inline size-3.5 animate-spin align-text-bottom" />
        ) : null}
      </p>
    </div>
  );
}
