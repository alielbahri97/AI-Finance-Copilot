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

import { RecommendationList } from "@/components/onboarding/recommendation-list";
import { Button } from "@/components/ui/button";
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
import {
  BUSINESS_TYPE_LABELS,
  BUSINESS_TYPES,
  EMPLOYEE_RANGE_LABELS,
  EMPLOYEE_RANGES,
  getRecommendations,
  type RecommendationResult,
} from "@/lib/onboarding/benchmarks";
import { cn } from "@/lib/utils";
import { onboardingSchema, type OnboardingValues } from "@/lib/validations/onboarding";

type Step = "business" | "scale" | "numbers" | "results";

const STEPS: Step[] = ["business", "scale", "numbers", "results"];

interface OnboardingWizardProps {
  currency: string;
  /** When true, completing navigates to dashboard; used from profile edit too. */
  returnTo?: string;
  initialValues?: Partial<OnboardingValues>;
  /** Hide skip when editing from profile. */
  allowSkip?: boolean;
}

export function OnboardingWizard({
  currency,
  returnTo = "/dashboard",
  initialValues,
  allowSkip = true,
}: OnboardingWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("business");
  const [isSaving, setIsSaving] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);
  const [recommendations, setRecommendations] = useState<RecommendationResult | null>(null);

  const form = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      businessType: initialValues?.businessType ?? "RESTAURANT",
      employeeRange: initialValues?.employeeRange ?? "SMALL",
      monthlyRent: initialValues?.monthlyRent ?? null,
      monthlyRevenue: initialValues?.monthlyRevenue ?? null,
      location: initialValues?.location ?? null,
      businessNotes: initialValues?.businessNotes ?? null,
    },
    mode: "onChange",
  });

  const stepIndex = STEPS.indexOf(step);
  const progressPct = ((stepIndex + 1) / STEPS.length) * 100;

  const preview = useMemo(() => {
    const values = form.getValues();
    if (!values.businessType) return null;
    return getRecommendations({
      businessType: values.businessType,
      employeeRange: values.employeeRange,
      monthlyRent: typeof values.monthlyRent === "number" ? values.monthlyRent : null,
      monthlyRevenue: typeof values.monthlyRevenue === "number" ? values.monthlyRevenue : null,
    });
  }, [form, step]);

  async function goNext() {
    if (step === "business") {
      const ok = await form.trigger(["businessType", "businessNotes"]);
      if (!ok) return;
      setStep("scale");
      return;
    }
    if (step === "scale") {
      const ok = await form.trigger(["employeeRange", "location"]);
      if (!ok) return;
      setStep("numbers");
      return;
    }
    if (step === "numbers") {
      const ok = await form.trigger(["monthlyRent", "monthlyRevenue"]);
      if (!ok) return;
      await saveAndShowResults();
    }
  }

  function goBack() {
    if (step === "scale") setStep("business");
    else if (step === "numbers") setStep("scale");
    else if (step === "results") setStep("numbers");
  }

  async function saveAndShowResults() {
    setIsSaving(true);
    try {
      const values = onboardingSchema.parse(form.getValues());
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not save", { description: body?.error ?? "Try again." });
        return;
      }
      setRecommendations(body.recommendations ?? getRecommendations(values));
      setStep("results");
      toast.success("Business profile saved");
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsSaving(false);
    }
  }

  async function skip() {
    setIsSkipping(true);
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skip: true }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error("Could not skip", { description: body?.error ?? "Try again." });
        return;
      }
      toast.message("Onboarding skipped", {
        description: "You can set this up later from Profile.",
      });
      router.push(returnTo);
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsSkipping(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <div className="space-y-2">
        <div className="bg-muted h-1.5 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          Step {stepIndex + 1} of {STEPS.length}
          {step === "results" ? " — recommendations" : ""}
        </p>
      </div>

      {step !== "results" ? (
        <Form {...form}>
          <form
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              void goNext();
            }}
          >
            {step === "business" ? (
              <>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">Tell us about your business</h1>
                  <p className="text-muted-foreground mt-1 text-sm">
                    A few questions help FinPilot suggest financial ratio guidelines for SMBs like
                    yours.
                  </p>
                </div>
                <FormField
                  control={form.control}
                  name="businessType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Business type</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Choose a type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {BUSINESS_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                              {BUSINESS_TYPE_LABELS[type]}
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
                  name="businessNotes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Anything else? (optional)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="e.g. quick-service café, B2B consulting, multi-location…"
                          rows={3}
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value || null)}
                        />
                      </FormControl>
                      <FormDescription>Helps you remember context later; guidelines use the type above.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            ) : null}

            {step === "scale" ? (
              <>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">Team and location</h1>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Rough size is enough — currency stays in your profile ({currency}).
                  </p>
                </div>
                <FormField
                  control={form.control}
                  name="employeeRange"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Number of employees</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Choose a range" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {EMPLOYEE_RANGES.map((range) => (
                            <SelectItem key={range} value={range}>
                              {EMPLOYEE_RANGE_LABELS[range]}
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
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location (optional)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="City or country"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value || null)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            ) : null}

            {step === "numbers" ? (
              <>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">Monthly snapshot</h1>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Optional estimates in {currency}. Skip any field you are unsure about.
                  </p>
                </div>
                <FormField
                  control={form.control}
                  name="monthlyRevenue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Approximate monthly revenue</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          placeholder="e.g. 45000"
                          value={field.value ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            field.onChange(v === "" ? null : Number(v));
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="monthlyRent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Approximate monthly rent</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          placeholder="e.g. 3500"
                          value={field.value ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            field.onChange(v === "" ? null : Number(v));
                          }}
                        />
                      </FormControl>
                      <FormDescription>
                        Used to compare rent as a % of revenue against industry guidelines.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex gap-2">
                {step !== "business" ? (
                  <Button type="button" variant="outline" onClick={goBack}>
                    <ArrowLeftIcon />
                    Back
                  </Button>
                ) : null}
                {allowSkip && step === "business" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={isSkipping}
                    onClick={() => void skip()}
                  >
                    {isSkipping && <Loader2Icon className="animate-spin" />}
                    Skip for now
                  </Button>
                ) : null}
              </div>
              <Button type="submit" disabled={isSaving}>
                {isSaving && <Loader2Icon className="animate-spin" />}
                {step === "numbers" ? "See recommendations" : "Continue"}
                {step !== "numbers" ? <ArrowRightIcon /> : null}
              </Button>
            </div>
          </form>
        </Form>
      ) : (
        <div className="grid gap-6">
          <div className="flex items-start gap-3">
            <CheckCircle2Icon className="text-primary mt-0.5 size-6 shrink-0" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Your recommended targets</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Revisit these anytime from Profile → Business profile.
              </p>
            </div>
          </div>

          <RecommendationList recommendations={recommendations ?? preview!} />

          <div className={cn("flex flex-wrap justify-between gap-3")}>
            <Button type="button" variant="outline" onClick={goBack}>
              <ArrowLeftIcon />
              Edit answers
            </Button>
            <Button
              type="button"
              onClick={() => {
                router.push(returnTo);
                router.refresh();
              }}
            >
              {returnTo === "/profile" ? "Back to profile" : "Continue to dashboard"}
              <ArrowRightIcon />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
