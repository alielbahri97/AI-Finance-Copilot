"use client";

import Link from "next/link";
import {
  BUSINESS_TYPE_LABELS,
  EMPLOYEE_RANGE_LABELS,
  getRecommendations,
  type BusinessTypeId,
  type EmployeeRangeId,
} from "@/lib/onboarding/benchmarks";
import { RecommendationList } from "@/components/onboarding/recommendation-list";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

export interface BusinessProfileSummaryProps {
  currency: string;
  businessType: BusinessTypeId;
  employeeRange: EmployeeRangeId;
  monthlyRent: number | null;
  monthlyRevenue: number | null;
  location: string | null;
  businessNotes: string | null;
  completedAt: string | null;
  skippedAt: string | null;
}

export function BusinessProfileCard({
  currency,
  businessType,
  employeeRange,
  monthlyRent,
  monthlyRevenue,
  location,
  businessNotes,
  completedAt,
  skippedAt,
}: BusinessProfileSummaryProps) {
  const completed = Boolean(completedAt);
  const recommendations = completed
    ? getRecommendations({
        businessType,
        employeeRange,
        monthlyRent,
        monthlyRevenue,
      })
    : null;

  return (
    <div className="grid gap-5">
      {skippedAt && !completed ? (
        <p className="text-muted-foreground text-sm">
          You skipped business setup earlier. Answer a few questions to unlock industry ratio
          guidelines.
        </p>
      ) : null}

      {completed ? (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Business type</dt>
            <dd className="font-medium">{BUSINESS_TYPE_LABELS[businessType]}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Employees</dt>
            <dd className="font-medium">{EMPLOYEE_RANGE_LABELS[employeeRange]}</dd>
          </div>
          {location ? (
            <div>
              <dt className="text-muted-foreground">Location</dt>
              <dd className="font-medium">{location}</dd>
            </div>
          ) : null}
          {monthlyRevenue != null ? (
            <div>
              <dt className="text-muted-foreground">Approx. monthly revenue</dt>
              <dd className="font-medium">{formatCurrency(monthlyRevenue, currency)}</dd>
            </div>
          ) : null}
          {monthlyRent != null ? (
            <div>
              <dt className="text-muted-foreground">Approx. monthly rent</dt>
              <dd className="font-medium">{formatCurrency(monthlyRent, currency)}</dd>
            </div>
          ) : null}
          {businessNotes ? (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="font-medium">{businessNotes}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <div>
        <Button asChild variant={completed ? "outline" : "default"}>
          <Link href="/onboarding?edit=1">{completed ? "Update business profile" : "Set up business profile"}</Link>
        </Button>
      </div>

      {recommendations ? <RecommendationList recommendations={recommendations} /> : null}
    </div>
  );
}
