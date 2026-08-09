"use client";

import { useState } from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { toast } from "@/lib/toast";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatPlanPrice, type Plan, type PlanId } from "@/lib/billing/plans";
import { BRAND } from "@/lib/branding";
import { cn } from "@/lib/utils";

interface PlanCardsProps {
  plans: Plan[];
  currentPlanId: PlanId;
  isTrial: boolean;
  billingConfigured: boolean;
}

export function PlanCards({ plans, currentPlanId, isTrial, billingConfigured }: PlanCardsProps) {
  const [pendingPlan, setPendingPlan] = useState<PlanId | null>(null);
  const [unavailablePlan, setUnavailablePlan] = useState<Plan | null>(null);

  async function checkout(plan: PlanId) {
    setPendingPlan(plan);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const body = (await response.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;
      if (!response.ok || !body?.url) {
        throw new Error(body?.error ?? "Could not start checkout");
      }
      window.location.href = body.url;
    } catch (error) {
      toast.error("Checkout failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
      setPendingPlan(null);
    }
  }

  return (
    <div
      className={cn(
        "grid gap-4 sm:grid-cols-2",
        plans.length <= 3 ? "xl:grid-cols-3" : "xl:grid-cols-4"
      )}
    >
      {plans.map((plan) => {
        const isCurrent = plan.id === currentPlanId;
        const price = formatPlanPrice(plan);
        return (
          <Card
            key={plan.id}
            className={cn("flex flex-col", isCurrent && "border-primary shadow-xs")}
          >
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>{plan.name}</CardTitle>
                {isCurrent && (
                  <Badge variant="default">{isTrial ? "Current (trial)" : "Current"}</Badge>
                )}
              </div>
              <CardDescription>{plan.description}</CardDescription>
              <p className="pt-1">
                {price === null ? (
                  <span className="text-2xl font-bold">Custom</span>
                ) : (
                  <>
                    <span className="text-2xl font-bold">{price}</span>
                    {plan.monthlyPriceEur !== 0 && (
                      <span className="text-muted-foreground text-sm"> / month</span>
                    )}
                  </>
                )}
              </p>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <ul className="flex-1 space-y-2">
                {plan.highlights.map((highlight) => (
                  <li key={highlight} className="flex items-start gap-2 text-sm">
                    <CheckIcon className="text-success mt-0.5 size-4 shrink-0" />
                    <span className="text-muted-foreground">{highlight}</span>
                  </li>
                ))}
              </ul>
              {plan.id === "ENTERPRISE" ? (
                <Button variant="outline" asChild>
                  <a
                    href={`mailto:${BRAND.salesEmail}?subject=${encodeURIComponent(
                      `${BRAND.name} Enterprise`
                    )}`}
                  >
                    Contact sales
                  </a>
                </Button>
              ) : plan.id === "FREE" ? (
                <Button variant="outline" disabled>
                  {isCurrent ? "Your plan" : "Included"}
                </Button>
              ) : isCurrent && !isTrial ? (
                <Button variant="outline" disabled>
                  Your plan
                </Button>
              ) : (
                <Button
                  disabled={pendingPlan !== null}
                  onClick={() =>
                    billingConfigured ? void checkout(plan.id) : setUnavailablePlan(plan)
                  }
                >
                  {pendingPlan === plan.id && <Loader2Icon className="size-4 animate-spin" />}
                  {isTrial && plan.id === currentPlanId ? "Subscribe" : `Upgrade to ${plan.name}`}
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Radix renders this through a portal, so it adds no cell to the grid.
          It replaces a disabled button with a `title` nobody could focus: the
          server has no Stripe keys, which is an operator problem the user can
          only solve by asking someone. */}
      <Dialog open={unavailablePlan !== null} onOpenChange={() => setUnavailablePlan(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Checkout is not available on this server</DialogTitle>
            <DialogDescription>
              {unavailablePlan
                ? `${BRAND.name} cannot take payment for ${unavailablePlan.name} here because billing has not been configured. Your current plan keeps working exactly as it does now.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button asChild>
              <a
                href={`mailto:${BRAND.salesEmail}?subject=${encodeURIComponent(
                  `${BRAND.name} ${unavailablePlan?.name ?? ""} plan`.trim()
                )}`}
              >
                Email us to upgrade
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
