/**
 * Industry financial-ratio guidelines for SMB onboarding.
 *
 * Ranges are approximate, widely cited industry norms (not audited benchmarks).
 * They are meant as planning targets for small and medium-sized businesses —
 * not guarantees, and not a substitute for an accountant.
 *
 * Sources consulted conceptually include common restaurant prime-cost rules
 * (labor ~25–35%, COGS ~28–35%, rent ~5–10%), retail gross-margin bands,
 * SaaS Rule-of-40 / gross-margin norms, and construction / services overhead
 * rules of thumb. Always label these as guidelines in the UI.
 */

export const BUSINESS_TYPES = [
  "RESTAURANT",
  "RETAIL",
  "SERVICES",
  "SAAS",
  "CONSTRUCTION",
  "PROFESSIONAL",
  "HEALTHCARE",
  "MANUFACTURING",
  "OTHER",
] as const;

export type BusinessTypeId = (typeof BUSINESS_TYPES)[number];

export const EMPLOYEE_RANGES = ["SOLO", "SMALL", "MEDIUM", "LARGE", "ENTERPRISE"] as const;

export type EmployeeRangeId = (typeof EMPLOYEE_RANGES)[number];

export const BUSINESS_TYPE_LABELS: Record<BusinessTypeId, string> = {
  RESTAURANT: "Restaurant / food service",
  RETAIL: "Retail",
  SERVICES: "Services",
  SAAS: "SaaS / software",
  CONSTRUCTION: "Construction / trades",
  PROFESSIONAL: "Professional services",
  HEALTHCARE: "Healthcare / clinic",
  MANUFACTURING: "Manufacturing",
  OTHER: "Other",
};

export const EMPLOYEE_RANGE_LABELS: Record<EmployeeRangeId, string> = {
  SOLO: "Just me (1)",
  SMALL: "2–10",
  MEDIUM: "11–50",
  LARGE: "51–200",
  ENTERPRISE: "200+",
};

export interface RatioBenchmark {
  /** Stable id for tests and UI keys. */
  id: string;
  /** Short label shown as the KPI name. */
  label: string;
  /** One-line explanation of what to aim for. */
  description: string;
  /** Inclusive low end of the typical range (percent of revenue unless noted). */
  lowPct: number;
  /** Inclusive high end of the typical range. */
  highPct: number;
  /**
   * How to interpret the range:
   * - target: staying inside the band is healthy
   * - ceiling: prefer at or below highPct (lowPct is a soft floor / typical floor)
   * - floor: prefer at or above lowPct
   */
  kind: "target" | "ceiling" | "floor";
  /** Optional unit override; defaults to "% of revenue". */
  unit?: string;
}

export interface BusinessContextInput {
  businessType: BusinessTypeId;
  employeeRange?: EmployeeRangeId;
  monthlyRent?: number | null;
  monthlyRevenue?: number | null;
}

export interface PersonalizedInsight {
  id: string;
  label: string;
  message: string;
  /** true when the user's estimate sits outside the guideline band. */
  outsideGuideline: boolean;
}

export interface RecommendationResult {
  businessType: BusinessTypeId;
  businessTypeLabel: string;
  disclaimer: string;
  ratios: RatioBenchmark[];
  insights: PersonalizedInsight[];
}

const DISCLAIMER =
  "These are general industry guidelines for planning — typical ranges, not precise targets for every business. Local markets, seasonality, and your model will differ.";

const BY_TYPE: Record<BusinessTypeId, RatioBenchmark[]> = {
  RESTAURANT: [
    {
      id: "labor",
      label: "Labor / wages",
      description: "Payroll and related labor costs as a share of sales.",
      lowPct: 25,
      highPct: 35,
      kind: "ceiling",
    },
    {
      id: "cogs",
      label: "Food / COGS",
      description: "Food and beverage cost of goods sold.",
      lowPct: 28,
      highPct: 35,
      kind: "ceiling",
    },
    {
      id: "rent",
      label: "Rent / occupancy",
      description: "Rent and occupancy relative to revenue.",
      lowPct: 5,
      highPct: 10,
      kind: "ceiling",
    },
    {
      id: "prime_cost",
      label: "Prime cost (labor + COGS)",
      description: "Combined labor and food cost — keep under ~60–65%.",
      lowPct: 55,
      highPct: 65,
      kind: "ceiling",
    },
    {
      id: "net_margin",
      label: "Net profit margin",
      description: "Healthy full-service restaurants often land in the mid-single digits.",
      lowPct: 3,
      highPct: 9,
      kind: "target",
    },
  ],
  RETAIL: [
    {
      id: "cogs",
      label: "Cost of goods (COGS)",
      description: "Merchandise cost as a share of sales.",
      lowPct: 50,
      highPct: 65,
      kind: "target",
    },
    {
      id: "gross_margin",
      label: "Gross margin",
      description: "Sales minus COGS — typical specialty retail band.",
      lowPct: 35,
      highPct: 50,
      kind: "floor",
    },
    {
      id: "labor",
      label: "Labor / wages",
      description: "Store payroll relative to revenue.",
      lowPct: 10,
      highPct: 20,
      kind: "ceiling",
    },
    {
      id: "rent",
      label: "Rent / occupancy",
      description: "Occupancy cost; location-heavy concepts run higher.",
      lowPct: 5,
      highPct: 12,
      kind: "ceiling",
    },
    {
      id: "net_margin",
      label: "Net profit margin",
      description: "After operating expenses for many retail SMBs.",
      lowPct: 2,
      highPct: 8,
      kind: "target",
    },
  ],
  SERVICES: [
    {
      id: "labor",
      label: "Labor / delivery cost",
      description: "Wages and contractor cost to deliver the service.",
      lowPct: 40,
      highPct: 60,
      kind: "target",
    },
    {
      id: "rent",
      label: "Rent / occupancy",
      description: "Office or studio occupancy vs revenue.",
      lowPct: 5,
      highPct: 10,
      kind: "ceiling",
    },
    {
      id: "marketing",
      label: "Sales & marketing",
      description: "Customer acquisition and promotion spend.",
      lowPct: 5,
      highPct: 12,
      kind: "target",
    },
    {
      id: "net_margin",
      label: "Net profit margin",
      description: "Typical healthy services businesses after overhead.",
      lowPct: 10,
      highPct: 20,
      kind: "target",
    },
  ],
  SAAS: [
    {
      id: "gross_margin",
      label: "Gross margin",
      description: "Revenue minus hosting, support, and delivery COGS.",
      lowPct: 70,
      highPct: 85,
      kind: "floor",
    },
    {
      id: "sales_marketing",
      label: "Sales & marketing",
      description: "Early-stage SaaS often invests heavily in growth.",
      lowPct: 20,
      highPct: 40,
      kind: "target",
    },
    {
      id: "rd",
      label: "R&D / product",
      description: "Engineering and product investment vs revenue.",
      lowPct: 15,
      highPct: 25,
      kind: "target",
    },
    {
      id: "net_margin",
      label: "Operating margin (mature)",
      description: "Mature SaaS aims higher; early stage may run negative.",
      lowPct: 10,
      highPct: 25,
      kind: "target",
    },
  ],
  CONSTRUCTION: [
    {
      id: "labor",
      label: "Direct labor",
      description: "Job labor as a share of project revenue.",
      lowPct: 20,
      highPct: 40,
      kind: "target",
    },
    {
      id: "materials",
      label: "Materials / job COGS",
      description: "Materials and subcontracted job costs.",
      lowPct: 30,
      highPct: 50,
      kind: "target",
    },
    {
      id: "overhead",
      label: "Overhead",
      description: "Office, insurance, equipment, and admin overhead.",
      lowPct: 10,
      highPct: 20,
      kind: "ceiling",
    },
    {
      id: "gross_margin",
      label: "Gross margin",
      description: "After direct job costs.",
      lowPct: 15,
      highPct: 25,
      kind: "floor",
    },
    {
      id: "net_margin",
      label: "Net profit margin",
      description: "Typical contractor net after overhead.",
      lowPct: 5,
      highPct: 10,
      kind: "target",
    },
  ],
  PROFESSIONAL: [
    {
      id: "labor",
      label: "People cost",
      description: "Salaries and contractors delivering client work.",
      lowPct: 40,
      highPct: 60,
      kind: "target",
    },
    {
      id: "rent",
      label: "Rent / occupancy",
      description: "Office cost relative to billings.",
      lowPct: 4,
      highPct: 10,
      kind: "ceiling",
    },
    {
      id: "utilization",
      label: "Billable utilization",
      description: "Share of available hours that are billable (not % of revenue).",
      lowPct: 60,
      highPct: 75,
      kind: "floor",
      unit: "% of available hours",
    },
    {
      id: "net_margin",
      label: "Net profit margin",
      description: "Healthy professional practices after partner draws vary.",
      lowPct: 15,
      highPct: 25,
      kind: "target",
    },
  ],
  HEALTHCARE: [
    {
      id: "labor",
      label: "Staff & clinical labor",
      description: "Payroll is usually the largest clinic cost.",
      lowPct: 40,
      highPct: 55,
      kind: "target",
    },
    {
      id: "supplies",
      label: "Supplies & clinical COGS",
      description: "Medical/dental supplies and related variable costs.",
      lowPct: 5,
      highPct: 15,
      kind: "ceiling",
    },
    {
      id: "rent",
      label: "Rent / occupancy",
      description: "Clinic space relative to collections.",
      lowPct: 5,
      highPct: 10,
      kind: "ceiling",
    },
    {
      id: "net_margin",
      label: "Net profit margin",
      description: "Varies widely by specialty and payer mix.",
      lowPct: 8,
      highPct: 18,
      kind: "target",
    },
  ],
  MANUFACTURING: [
    {
      id: "cogs",
      label: "Cost of goods (COGS)",
      description: "Materials, factory labor, and production overhead.",
      lowPct: 50,
      highPct: 70,
      kind: "target",
    },
    {
      id: "gross_margin",
      label: "Gross margin",
      description: "After manufacturing COGS.",
      lowPct: 25,
      highPct: 40,
      kind: "floor",
    },
    {
      id: "opex",
      label: "Operating expenses",
      description: "SG&A outside the plant.",
      lowPct: 15,
      highPct: 25,
      kind: "ceiling",
    },
    {
      id: "net_margin",
      label: "Net / operating margin",
      description: "Typical SMB manufacturing after overhead.",
      lowPct: 5,
      highPct: 15,
      kind: "target",
    },
  ],
  OTHER: [
    {
      id: "labor",
      label: "Labor / people cost",
      description: "Wages and contractors as a share of revenue.",
      lowPct: 25,
      highPct: 50,
      kind: "target",
    },
    {
      id: "rent",
      label: "Rent / occupancy",
      description: "Occupancy cost relative to revenue.",
      lowPct: 5,
      highPct: 12,
      kind: "ceiling",
    },
    {
      id: "gross_margin",
      label: "Gross margin",
      description: "A broad SMB planning band after direct costs.",
      lowPct: 30,
      highPct: 60,
      kind: "target",
    },
    {
      id: "net_margin",
      label: "Net profit margin",
      description: "Many healthy SMBs aim for double-digit net when possible.",
      lowPct: 5,
      highPct: 15,
      kind: "target",
    },
  ],
};

function formatPct(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

function rentInsight(
  ratios: RatioBenchmark[],
  monthlyRent: number,
  monthlyRevenue: number
): PersonalizedInsight | null {
  const rentRatio = ratios.find((r) => r.id === "rent");
  if (!rentRatio || monthlyRevenue <= 0) return null;

  const actualPct = (monthlyRent / monthlyRevenue) * 100;
  const outside =
    actualPct > rentRatio.highPct || actualPct < rentRatio.lowPct * 0.5;

  let message: string;
  if (actualPct > rentRatio.highPct) {
    message = `Your estimated rent is about ${formatPct(actualPct)} of revenue — above the typical ${formatPct(rentRatio.lowPct)}–${formatPct(rentRatio.highPct)} guideline. Consider whether revenue can grow into the space, or renegotiate occupancy costs.`;
  } else if (actualPct < rentRatio.lowPct) {
    message = `Your estimated rent is about ${formatPct(actualPct)} of revenue — below the usual ${formatPct(rentRatio.lowPct)}–${formatPct(rentRatio.highPct)} band, which can leave more room for labor and growth investment.`;
  } else {
    message = `Your estimated rent is about ${formatPct(actualPct)} of revenue, within the typical ${formatPct(rentRatio.lowPct)}–${formatPct(rentRatio.highPct)} guideline.`;
  }

  return {
    id: "rent_vs_revenue",
    label: "Your rent vs revenue",
    message,
    outsideGuideline: outside && actualPct > rentRatio.highPct,
  };
}

function employeeInsight(
  businessType: BusinessTypeId,
  employeeRange: EmployeeRangeId | undefined,
  monthlyRevenue: number | null | undefined
): PersonalizedInsight | null {
  if (!employeeRange || !monthlyRevenue || monthlyRevenue <= 0) return null;

  // Very rough revenue-per-employee heuristics for SMB planning (annualized).
  const midpoints: Record<EmployeeRangeId, number> = {
    SOLO: 1,
    SMALL: 6,
    MEDIUM: 30,
    LARGE: 120,
    ENTERPRISE: 250,
  };
  const heads = midpoints[employeeRange];
  const annualRevenue = monthlyRevenue * 12;
  const perEmployee = annualRevenue / heads;

  // Soft floors by industry (annual revenue per FTE); below = watch staffing vs sales.
  const softFloor: Record<BusinessTypeId, number> = {
    RESTAURANT: 80_000,
    RETAIL: 100_000,
    SERVICES: 100_000,
    SAAS: 150_000,
    CONSTRUCTION: 120_000,
    PROFESSIONAL: 150_000,
    HEALTHCARE: 120_000,
    MANUFACTURING: 150_000,
    OTHER: 100_000,
  };

  const floor = softFloor[businessType];
  const outside = perEmployee < floor * 0.7;
  const message = outside
    ? `At ~${EMPLOYEE_RANGE_LABELS[employeeRange]} people and your revenue estimate, annual revenue per employee looks low vs a rough ${formatCurrencyRough(floor)} guideline. That can be fine in early stage — just watch labor cost %.`
    : `With ~${EMPLOYEE_RANGE_LABELS[employeeRange]} people, your revenue estimate implies roughly ${formatCurrencyRough(perEmployee)} per employee per year — a useful staffing check as you grow.`;

  return {
    id: "revenue_per_employee",
    label: "Staffing vs revenue",
    message,
    outsideGuideline: outside,
  };
}

function formatCurrencyRough(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${Math.round(value)}`;
}

/** Returns industry ratio guidelines plus optional personalized insights. */
export function getRecommendations(input: BusinessContextInput): RecommendationResult {
  const ratios = BY_TYPE[input.businessType] ?? BY_TYPE.OTHER;
  const insights: PersonalizedInsight[] = [];

  const rent = input.monthlyRent ?? null;
  const revenue = input.monthlyRevenue ?? null;
  if (rent != null && rent > 0 && revenue != null && revenue > 0) {
    const insight = rentInsight(ratios, rent, revenue);
    if (insight) insights.push(insight);
  }

  const staffing = employeeInsight(input.businessType, input.employeeRange, revenue);
  if (staffing) insights.push(staffing);

  return {
    businessType: input.businessType,
    businessTypeLabel: BUSINESS_TYPE_LABELS[input.businessType],
    disclaimer: DISCLAIMER,
    ratios,
    insights,
  };
}

/** Formats a ratio band for display, e.g. "25–35% of revenue". */
export function formatRatioRange(ratio: RatioBenchmark): string {
  const band = `${stripPct(ratio.lowPct)}–${formatPct(ratio.highPct)}`;
  if (ratio.unit) {
    // e.g. unit "% of available hours" → "60–75% of available hours"
    const rest = ratio.unit.replace(/^%\s*/, "");
    return `${band} ${rest}`.trim();
  }
  return `${band} of revenue`;
}

function stripPct(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Human-readable target line used in the results UI.
 * e.g. "Aim for at most 25–35% of revenue"
 */
export function formatRatioGuidance(ratio: RatioBenchmark): string {
  const range = `${formatPct(ratio.lowPct)}–${formatPct(ratio.highPct)}`;
  const unit = ratio.unit ?? "of revenue";
  const unitSuffix = unit.startsWith("%") ? unit.slice(1).trim() || "of revenue" : unit;

  switch (ratio.kind) {
    case "ceiling":
      return `Typical range: up to about ${range} ${unitSuffix}`.replace(/\s+/g, " ").trim();
    case "floor":
      return `Typical range: at least about ${range} ${unitSuffix}`.replace(/\s+/g, " ").trim();
    default:
      return `Typical range: about ${range} ${unitSuffix}`.replace(/\s+/g, " ").trim();
  }
}

export function isOnboardingDone(profile: {
  completedAt?: Date | string | null;
  skippedAt?: Date | string | null;
} | null | undefined): boolean {
  if (!profile) return false;
  return Boolean(profile.completedAt || profile.skippedAt);
}
