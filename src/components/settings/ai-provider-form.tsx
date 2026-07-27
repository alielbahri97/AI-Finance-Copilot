"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Provider = "OPENAI" | "ANTHROPIC" | "GROQ";

const LABELS: Record<Provider, string> = {
  GROQ: "Groq (free Llama)",
  OPENAI: "OpenAI (GPT)",
  ANTHROPIC: "Anthropic (Claude)",
};

interface AiProviderFormProps {
  defaultProvider: Provider;
}

export function AiProviderForm({ defaultProvider }: AiProviderFormProps) {
  const router = useRouter();
  const [provider, setProvider] = useState<Provider>(defaultProvider);
  const [isSaving, setIsSaving] = useState(false);

  async function handleChange(value: string) {
    const next = value as Provider;
    const previous = provider;
    setProvider(next);
    setIsSaving(true);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiProvider: next }),
      });
      if (!response.ok) {
        setProvider(previous);
        toast.error("Could not update AI provider");
        return;
      }
      toast.success(`Copilot now uses ${LABELS[next]}`);
      router.refresh();
    } catch {
      setProvider(previous);
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="grid max-w-sm gap-2">
      <Label htmlFor="ai-provider">Preferred provider</Label>
      <Select value={provider} onValueChange={handleChange} disabled={isSaving}>
        <SelectTrigger id="ai-provider" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="GROQ">{LABELS.GROQ}</SelectItem>
          <SelectItem value="OPENAI">{LABELS.OPENAI}</SelectItem>
          <SelectItem value="ANTHROPIC">{LABELS.ANTHROPIC}</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-sm">
        Groq is free for personal use. The copilot falls back to another provider if the
        preferred one has no API key configured.
      </p>
    </div>
  );
}
