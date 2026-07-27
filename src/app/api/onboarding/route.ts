import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api/response";
import { getOrCreateProfile } from "@/lib/data";
import {
  getRecommendations,
  isOnboardingDone,
  type BusinessTypeId,
  type EmployeeRangeId,
} from "@/lib/onboarding/benchmarks";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { onboardingSchema, normalizeOnboardingInput } from "@/lib/validations/onboarding";

function serializeBusinessProfile(
  row: {
    businessType: string;
    employeeRange: string;
    monthlyRent: { toString(): string } | null;
    monthlyRevenue: { toString(): string } | null;
    location: string | null;
    businessNotes: string | null;
    completedAt: Date | null;
    skippedAt: Date | null;
  } | null
) {
  if (!row) return null;
  return {
    businessType: row.businessType as BusinessTypeId,
    employeeRange: row.employeeRange as EmployeeRangeId,
    monthlyRent: row.monthlyRent != null ? Number(row.monthlyRent) : null,
    monthlyRevenue: row.monthlyRevenue != null ? Number(row.monthlyRevenue) : null,
    location: row.location,
    businessNotes: row.businessNotes,
    completedAt: row.completedAt?.toISOString() ?? null,
    skippedAt: row.skippedAt?.toISOString() ?? null,
    done: isOnboardingDone(row),
  };
}

export async function GET() {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await getOrCreateProfile(user);
    const businessProfile = await prisma.businessProfile.findUnique({
      where: { userId: user.id },
    });

    const serialized = serializeBusinessProfile(businessProfile);
    const recommendations =
      businessProfile?.completedAt
        ? getRecommendations({
            businessType: businessProfile.businessType,
            employeeRange: businessProfile.employeeRange,
            monthlyRent:
              businessProfile.monthlyRent != null
                ? Number(businessProfile.monthlyRent)
                : null,
            monthlyRevenue:
              businessProfile.monthlyRevenue != null
                ? Number(businessProfile.monthlyRevenue)
                : null,
          })
        : null;

    return NextResponse.json({
      businessProfile: serialized,
      recommendations,
    });
  } catch (error) {
    return apiError("GET /api/onboarding", "Failed to load onboarding", error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const skipParsed = z.object({ skip: z.literal(true) }).safeParse(body);
    if (skipParsed.success) {
      await getOrCreateProfile(user);
      const now = new Date();
      const businessProfile = await prisma.businessProfile.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          // Placeholder defaults so the row satisfies required fields; user
          // can replace them later from Profile → Business profile.
          businessType: "OTHER",
          employeeRange: "SOLO",
          skippedAt: now,
        },
        update: {
          skippedAt: now,
        },
      });

      return NextResponse.json({
        businessProfile: serializeBusinessProfile(businessProfile),
        recommendations: null,
        skipped: true,
      });
    }

    const parsed = onboardingSchema.safeParse(normalizeOnboardingInput(body));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid onboarding data", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    await getOrCreateProfile(user);
    const data = parsed.data;
    const now = new Date();

    const businessProfile = await prisma.businessProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        businessType: data.businessType,
        employeeRange: data.employeeRange,
        monthlyRent: data.monthlyRent,
        monthlyRevenue: data.monthlyRevenue,
        location: data.location,
        businessNotes: data.businessNotes,
        completedAt: now,
        skippedAt: null,
      },
      update: {
        businessType: data.businessType,
        employeeRange: data.employeeRange,
        monthlyRent: data.monthlyRent,
        monthlyRevenue: data.monthlyRevenue,
        location: data.location,
        businessNotes: data.businessNotes,
        completedAt: now,
        skippedAt: null,
      },
    });

    const recommendations = getRecommendations({
      businessType: data.businessType,
      employeeRange: data.employeeRange,
      monthlyRent: data.monthlyRent,
      monthlyRevenue: data.monthlyRevenue,
    });

    return NextResponse.json({
      businessProfile: serializeBusinessProfile(businessProfile),
      recommendations,
      skipped: false,
    });
  } catch (error) {
    return apiError("POST /api/onboarding", "Failed to save onboarding", error);
  }
}
