"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  Loader2Icon,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { PersonalRecommendationList } from "@/components/onboarding/personal-recommendation-list";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { BRAND } from "@/lib/branding";
import {
  getPersonalRecommendations,
  LIFE_STAGE_LABELS,
  LIFE_STAGES,
  PRIMARY_FOCUS_LABELS,
  PRIMARY_FOCUSES,
  type PersonalRecommendationResult,
} from "@/lib/onboarding/personal";
import { cn } from "@/lib/utils";
import {
  personalOnboardingSchema,
  type PersonalOnboardingValues,
} from "@/lib/validations/personal-onboarding";

type Step = "about" | "focus" | "snapshot" | "results";

const ALL_STEPS: Step[] = ["about", "focus", "snapshot", "results"];

const STEP_LABELS: Record<Step, string> = {
  about: "About you",
  focus: "Your focus",
  snapshot: "Monthly snapshot",
  results: "Recommendations",
};

interface PersonalOnboardingWizardProps {
  currency: string;
  returnTo?: string;
  initialValues?: Partial<PersonalOnboardingValues>;
  allowSkip?: boolean;
}

export function PersonalOnboardingWizard({
  currency,
  returnTo = "/dashboard",
  initialValues,
  allowSkip = true,
}: PersonalOnboardingWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("about");
  const [isSaving, setIsSaving] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);
  const [recommendations, setRecommendations] = useState<PersonalRecommendationResult | null>(
    null
  );

  const form = useForm<PersonalOnboardingValues>({
    resolver: zodResolver(personalOnboardingSchema),
    defaultValues: {
      lifeStage: initialValues?.lifeStage ?? "EARLY_CAREER",
      primaryFocus: initialValues?.primaryFocus ?? "EMERGENCY_FUND",
      monthlyIncome: initialValues?.monthlyIncome ?? null,
      monthlyEssentials: initialValues?.monthlyEssentials ?? null,
      hasDebt: initialValues?.hasDebt ?? false,
      emergencyMonths: initialValues?.emergencyMonths ?? 0,
      notes: initialValues?.notes ?? null,
    },
  });

  const stepIndex = ALL_STEPS.indexOf(step);
  const progress = useMemo(
    () => ((stepIndex + 1) / ALL_STEPS.length) * 100,
    [stepIndex]
  );

  async function saveAndShowResults() {
    const valid = await form.trigger();
    if (!valid) return;
    setIsSaving(true);
    try {
      const values = form.getValues();
      const response = await fetch("/api/onboarding/personal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        recommendations?: PersonalRecommendationResult;
      } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "Could not save questionnaire");
      }
      setRecommendations(body?.recommendations ?? getPersonalRecommendations(values));
      setStep("results");
      toast.success("Saved", { description: "Your recommendations are ready." });
    } catch (error) {
      toast.error("Save failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function skip() {
    setIsSkipping(true);
    try {
      const response = await fetch("/api/onboarding/personal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skip: true }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not skip");
      }
      router.push(returnTo);
      router.refresh();
    } catch (error) {
      toast.error("Could not skip", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
      setIsSkipping(false);
    }
  }

  async function goNext() {
    if (step === "about") {
      const ok = await form.trigger(["lifeStage"]);
      if (ok) setStep("focus");
      return;
    }
    if (step === "focus") {
      const ok = await form.trigger(["primaryFocus", "hasDebt", "emergencyMonths"]);
      if (ok) setStep("snapshot");
      return;
    }
    if (step === "snapshot") {
      await saveAndShowResults();
    }
  }

  function goBack() {
    if (step === "focus") setStep("about");
    else if (step === "snapshot") setStep("focus");
    else if (step === "results") setStep("snapshot");
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
          Personal setup
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Help {BRAND.name} understand your goals
        </h1>
        <p className="text-muted-foreground text-sm">
          A few questions so we can suggest savings goals and next steps that fit you. You can
          skip and fill this in later.
        </p>
      </div>

      <div className="space-y-2">
        <div className="text-muted-foreground flex justify-between text-xs">
          <span>
            Step {stepIndex + 1} of {ALL_STEPS.length}: {STEP_LABELS[step]}
          </span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="bg-muted h-1.5 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <Form {...form}>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void goNext();
          }}
        >
          {step === "about" ? (
            <FormField
              control={form.control}
              name="lifeStage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Where are you in life?</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose one" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {LIFE_STAGES.map((id) => (
                        <SelectItem key={id} value={id}>
                          {LIFE_STAGE_LABELS[id]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    This shapes time horizons — students vs near-retirement get different goal
                    templates.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}

          {step === "focus" ? (
            <>
              <FormField
                control={form.control}
                name="primaryFocus"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>What matters most right now?</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose one" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PRIMARY_FOCUSES.map((id) => (
                          <SelectItem key={id} value={id}>
                            {PRIMARY_FOCUS_LABELS[id]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="hasDebt"
                render={({ field }) => (
                  <FormItem className="border-border flex flex-row items-start gap-3 rounded-lg border p-4">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                      />
                    </FormControl>
                    <div className="space-y-1">
                      <FormLabel className="font-medium">I currently have debt to pay down</FormLabel>
                      <FormDescription>
                        Student loans, cards, or a mortgage — we will suggest a payoff pot if so.
                      </FormDescription>
                    </div>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="emergencyMonths"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Emergency buffer (months of essentials)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={24}
                        value={field.value}
                        onChange={(event) => field.onChange(Number(event.target.value) || 0)}
                      />
                    </FormControl>
                    <FormDescription>0 if you are just starting. 3–6 is a common target.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          ) : null}

          {step === "snapshot" ? (
            <>
              <FormField
                control={form.control}
                name="monthlyIncome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly take-home income ({currency}) — optional</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={field.value ?? ""}
                        onChange={(event) => {
                          const raw = event.target.value;
                          field.onChange(raw === "" ? null : Number(raw));
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="monthlyEssentials"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly essentials ({currency}) — optional</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={field.value ?? ""}
                        onChange={(event) => {
                          const raw = event.target.value;
                          field.onChange(raw === "" ? null : Number(raw));
                        }}
                      />
                    </FormControl>
                    <FormDescription>Rent, food, utilities, transport — rough is fine.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Anything else? — optional</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        placeholder="e.g. Wedding in 2027, relocating next year…"
                        value={field.value ?? ""}
                        onChange={(event) =>
                          field.onChange(event.target.value.trim() ? event.target.value : null)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          ) : null}

          {step === "results" && recommendations ? (
            <PersonalRecommendationList
              recommendations={recommendations}
              currency={currency}
            />
          ) : null}

          <div className={cn("flex flex-wrap items-center gap-2", step === "about" && "justify-between")}>
            {step !== "about" && step !== "results" ? (
              <Button type="button" variant="ghost" onClick={goBack} disabled={isSaving}>
                <ArrowLeftIcon />
                Back
              </Button>
            ) : (
              <span />
            )}

            <div className="ml-auto flex flex-wrap gap-2">
              {allowSkip && step !== "results" ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void skip()}
                  disabled={isSkipping || isSaving}
                >
                  {isSkipping ? <Loader2Icon className="animate-spin" /> : null}
                  Skip for now
                </Button>
              ) : null}

              {step !== "results" ? (
                <Button type="submit" disabled={isSaving || isSkipping}>
                  {isSaving ? <Loader2Icon className="animate-spin" /> : null}
                  {step === "snapshot" ? "See recommendations" : "Continue"}
                  {step !== "snapshot" ? <ArrowRightIcon /> : null}
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => {
                    router.push(returnTo);
                    router.refresh();
                  }}
                >
                  <CheckCircle2Icon />
                  Go to dashboard
                </Button>
              )}
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
