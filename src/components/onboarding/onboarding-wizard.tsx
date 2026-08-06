"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  Loader2Icon,
  PlugIcon,
  PlusIcon,
  UploadIcon,
  type LucideIcon,
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
import { BRAND } from "@/lib/branding";
import { cn } from "@/lib/utils";
import { onboardingSchema, type OnboardingValues } from "@/lib/validations/onboarding";

type Step = "business" | "scale" | "numbers" | "data" | "results";

const ALL_STEPS: Step[] = ["business", "scale", "numbers", "data", "results"];

const STEP_LABELS: Record<Step, string> = {
  business: "Your business",
  scale: "Team and location",
  numbers: "Monthly snapshot",
  data: "Bring in your numbers",
  results: "Recommendations",
};

/**
 * The three ways real transactions get into a workspace, all of them existing
 * pages. Offered once the business profile is saved, so following a link here
 * leaves onboarding complete rather than bouncing the user back to step 1.
 */
const DATA_OPTIONS: Array<{
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
}> = [
  {
    href: "/integrations",
    icon: PlugIcon,
    title: "Connect a bank",
    description:
      "You log in at your bank and grant read-only access. Balances and transactions arrive on their own and keep updating.",
  },
  {
    href: "/import",
    icon: UploadIcon,
    title: "Upload a statement",
    description:
      "Export a CSV, Excel, PDF or MT940 statement from your bank and drop the file in. You map the columns once; duplicates are skipped.",
  },
  {
    href: "/transactions",
    icon: PlusIcon,
    title: "Add one manually",
    description:
      "Type in a single income or expense. Useful for a quick look at how the dashboard reads your data.",
  },
];

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

  // Editing an existing profile from Profile → Business profile is not a
  // first run, so the import ask has no place in it.
  const isFirstRun = returnTo !== "/profile";
  const steps = useMemo(
    () => (isFirstRun ? ALL_STEPS : ALL_STEPS.filter((entry) => entry !== "data")),
    [isFirstRun]
  );
  const stepIndex = steps.indexOf(step);
  const progressPct = ((stepIndex + 1) / steps.length) * 100;

  // A step change swaps the whole panel, so focus has to follow it or a
  // keyboard user is left on a button that no longer exists and a screen
  // reader announces nothing. Skipped on first render: the page has its own
  // entry point and stealing focus on load is worse than leaving it.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hasRendered = useRef(false);
  useEffect(() => {
    if (!hasRendered.current) {
      hasRendered.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const preview = useMemo(() => {
    const values = form.getValues();
    if (!values.businessType) return null;
    return getRecommendations({
      businessType: values.businessType,
      employeeRange: values.employeeRange,
      monthlyRent: typeof values.monthlyRent === "number" ? values.monthlyRent : null,
      monthlyRevenue: typeof values.monthlyRevenue === "number" ? values.monthlyRevenue : null,
    });
    // form.getValues() is non-reactive, so `step` is a deliberate dependency:
    // it refreshes the preview with the values entered on the completed step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, step]);

  const isQuestionStep = step === "business" || step === "scale" || step === "numbers";

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
    else if (step === "data" || step === "results") setStep("numbers");
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
      // Saved means onboarding is complete server-side, so the import step can
      // send the user off to /integrations, /import or /transactions without
      // the dashboard layout redirecting them back into the wizard.
      setStep(isFirstRun ? "data" : "results");
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
        <div
          role="progressbar"
          aria-valuenow={stepIndex + 1}
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuetext={`Step ${stepIndex + 1} of ${steps.length}: ${STEP_LABELS[step]}`}
          aria-label="Setup progress"
          className="bg-muted h-1.5 overflow-hidden rounded-full"
        >
          <div
            className="bg-primary h-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          Step {stepIndex + 1} of {steps.length} — {STEP_LABELS[step]}
        </p>
      </div>

      {isQuestionStep ? (
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
                  <h1
                    ref={headingRef}
                    tabIndex={-1}
                    className="text-2xl font-bold tracking-tight outline-none"
                  >
                    Tell us about your business
                  </h1>
                  <p className="text-muted-foreground mt-1 text-sm">
                    A few questions help {BRAND.name} suggest financial ratio guidelines for SMBs
                    like yours.
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
                  <h1
                    ref={headingRef}
                    tabIndex={-1}
                    className="text-2xl font-bold tracking-tight outline-none"
                  >
                    Team and location
                  </h1>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Rough size is enough — we set your preferred currency from this location when we
                    can (e.g. Netherlands → EUR). You can change it anytime in Settings.
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
                  <h1
                    ref={headingRef}
                    tabIndex={-1}
                    className="text-2xl font-bold tracking-tight outline-none"
                  >
                    Monthly snapshot
                  </h1>
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
                {/* Every question step, not just the first: the audit found
                    the only escape from step 2 onward was Back-then-skip. */}
                {allowSkip ? (
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
                {step !== "numbers"
                  ? "Continue"
                  : isFirstRun
                    ? "Save and continue"
                    : "See recommendations"}
                <ArrowRightIcon />
              </Button>
            </div>
          </form>
        </Form>
      ) : step === "data" ? (
        <div className="grid gap-5">
          <div>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-2xl font-bold tracking-tight outline-none"
            >
              Bring in your numbers
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Your answers are saved. {BRAND.name} has nothing to chart until it has transactions —
              pick whichever of these is least effort for you.
            </p>
          </div>

          <div className="grid gap-3">
            {DATA_OPTIONS.map((option) => (
              <Link
                key={option.href}
                href={option.href}
                className="hover:border-primary/50 hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-ring/50 group flex items-start gap-3 rounded-lg border p-4 text-left transition-colors outline-none focus-visible:ring-[3px]"
              >
                <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
                  <option.icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{option.title}</span>
                  <span className="text-muted-foreground block text-sm">{option.description}</span>
                </span>
                <ArrowRightIcon className="text-muted-foreground group-hover:text-foreground mt-1 size-4 shrink-0 transition-colors" />
              </Link>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button type="button" variant="outline" onClick={goBack}>
              <ArrowLeftIcon />
              Back
            </Button>
            <Button type="button" variant="ghost" onClick={() => setStep("results")}>
              Do this later
              <ArrowRightIcon />
            </Button>
          </div>

          <p className="text-muted-foreground text-xs">
            Whichever you choose, your recommended targets are saved — Profile → Business profile
            has them whenever you want them.
          </p>
        </div>
      ) : (
        <div className="grid gap-6">
          <div className="flex items-start gap-3">
            <CheckCircle2Icon className="text-primary mt-0.5 size-6 shrink-0" />
            <div>
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="text-2xl font-bold tracking-tight outline-none"
              >
                Your recommended targets
              </h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Revisit these anytime from Profile → Business profile.
              </p>
            </div>
          </div>

          <RecommendationList recommendations={recommendations ?? preview!} />

          <div className={cn("flex flex-wrap justify-between gap-3")}>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={goBack}>
                <ArrowLeftIcon />
                Edit answers
              </Button>
              {isFirstRun ? (
                <Button type="button" variant="ghost" onClick={() => setStep("data")}>
                  Bring in your numbers
                </Button>
              ) : null}
            </div>
            <Button
              type="button"
              onClick={() => {
                router.push(returnTo);
                router.refresh();
              }}
            >
              {isFirstRun ? "Continue to dashboard" : "Back to profile"}
              <ArrowRightIcon />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
