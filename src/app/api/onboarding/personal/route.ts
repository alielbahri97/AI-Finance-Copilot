import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api/response";
import { getOrCreateProfile } from "@/lib/data";
import {
  getPersonalRecommendations,
  isPersonalOnboardingDone,
  type LifeStageId,
  type PrimaryFocusId,
} from "@/lib/onboarding/personal";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import {
  normalizePersonalOnboardingInput,
  personalOnboardingSchema,
} from "@/lib/validations/personal-onboarding";
import { getWorkspaceContext } from "@/lib/workspace/context";

function serializePersonalProfile(
  row: {
    lifeStage: string;
    primaryFocus: string;
    monthlyIncome: { toString(): string } | null;
    monthlyEssentials: { toString(): string } | null;
    hasDebt: boolean;
    emergencyMonths: number;
    notes: string | null;
    completedAt: Date | null;
    skippedAt: Date | null;
  } | null
) {
  if (!row) return null;
  return {
    lifeStage: row.lifeStage as LifeStageId,
    primaryFocus: row.primaryFocus as PrimaryFocusId,
    monthlyIncome: row.monthlyIncome != null ? Number(row.monthlyIncome) : null,
    monthlyEssentials: row.monthlyEssentials != null ? Number(row.monthlyEssentials) : null,
    hasDebt: row.hasDebt,
    emergencyMonths: row.emergencyMonths,
    notes: row.notes,
    completedAt: row.completedAt?.toISOString() ?? null,
    skippedAt: row.skippedAt?.toISOString() ?? null,
    done: isPersonalOnboardingDone(row),
  };
}

export async function GET() {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await getOrCreateProfile(user);
    const personalProfile = await prisma.personalProfile.findUnique({
      where: { userId: user.id },
    });

    const serialized = serializePersonalProfile(personalProfile);
    const recommendations =
      personalProfile?.completedAt
        ? getPersonalRecommendations({
            lifeStage: personalProfile.lifeStage as LifeStageId,
            primaryFocus: personalProfile.primaryFocus as PrimaryFocusId,
            monthlyIncome:
              personalProfile.monthlyIncome != null
                ? Number(personalProfile.monthlyIncome)
                : null,
            monthlyEssentials:
              personalProfile.monthlyEssentials != null
                ? Number(personalProfile.monthlyEssentials)
                : null,
            hasDebt: personalProfile.hasDebt,
            emergencyMonths: personalProfile.emergencyMonths,
            notes: personalProfile.notes,
          })
        : null;

    return NextResponse.json({
      personalProfile: serialized,
      recommendations,
    });
  } catch (error) {
    return apiError("GET /api/onboarding/personal", "Failed to load personal onboarding", error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ctx = await getWorkspaceContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (ctx.workspace.type !== "PERSONAL") {
      return NextResponse.json(
        { error: "Personal questionnaire is only available on a Personal workspace." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const skipParsed = z.object({ skip: z.literal(true) }).safeParse(body);
    if (skipParsed.success) {
      await getOrCreateProfile(user);
      const now = new Date();
      const personalProfile = await prisma.personalProfile.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          lifeStage: "OTHER",
          primaryFocus: "GENERAL_WEALTH",
          hasDebt: false,
          emergencyMonths: 0,
          skippedAt: now,
        },
        update: {
          skippedAt: now,
        },
      });
      return NextResponse.json({
        personalProfile: serializePersonalProfile(personalProfile),
        recommendations: null,
        skipped: true,
      });
    }

    const parsed = personalOnboardingSchema.safeParse(normalizePersonalOnboardingInput(body));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid questionnaire", fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    await getOrCreateProfile(user);
    const values = parsed.data;
    const now = new Date();
    const personalProfile = await prisma.personalProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        lifeStage: values.lifeStage,
        primaryFocus: values.primaryFocus,
        monthlyIncome: values.monthlyIncome,
        monthlyEssentials: values.monthlyEssentials,
        hasDebt: values.hasDebt,
        emergencyMonths: values.emergencyMonths,
        notes: values.notes,
        completedAt: now,
        skippedAt: null,
      },
      update: {
        lifeStage: values.lifeStage,
        primaryFocus: values.primaryFocus,
        monthlyIncome: values.monthlyIncome,
        monthlyEssentials: values.monthlyEssentials,
        hasDebt: values.hasDebt,
        emergencyMonths: values.emergencyMonths,
        notes: values.notes,
        completedAt: now,
        skippedAt: null,
      },
    });

    const recommendations = getPersonalRecommendations(values);

    return NextResponse.json({
      personalProfile: serializePersonalProfile(personalProfile),
      recommendations,
      skipped: false,
    });
  } catch (error) {
    return apiError("POST /api/onboarding/personal", "Failed to save personal onboarding", error);
  }
}
