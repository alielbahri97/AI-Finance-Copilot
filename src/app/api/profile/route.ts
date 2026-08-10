import { NextResponse } from "next/server";
import { z } from "zod";

import { getOrCreateProfile } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { SUPPORTED_CURRENCIES } from "@/lib/validations/profile";
import { apiError } from "@/lib/api/response";
import {
  serializeBusinessProfile,
  serializePersonalProfile,
  serializeProfile,
} from "@/lib/api/serializers/profile";
import { getWorkspaceContext, requireWorkspace } from "@/lib/workspace/context";
import { editionForWorkspaceType } from "@/lib/workspace/editions";

/**
 * The profile screen: the account itself, plus whichever first-run
 * questionnaire the current workspace's edition owns.
 *
 * A session is all this needs — the web page checks nothing beyond being signed
 * in and having a workspace, and a person's own name is not a permission.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.ok) return auth.response;
    const { user, workspace } = auth.ctx;

    const profile = await getOrCreateProfile(user);
    const [businessProfile, personalProfile] = await Promise.all([
      prisma.businessProfile.findUnique({ where: { userId: user.id } }),
      prisma.personalProfile.findUnique({ where: { userId: user.id } }),
    ]);

    const edition = editionForWorkspaceType(workspace.type);

    return NextResponse.json({
      profile: serializeProfile(profile),
      edition,
      workspace: { id: workspace.id, name: workspace.name, type: workspace.type, edition },
      // Not behind the edition branch: the page seeds the currency form's
      // location hint from the business profile in both editions, because a
      // person who also runs a company has already told us where they are.
      locationHint: businessProfile?.location ?? null,
      supportedCurrencies: [...SUPPORTED_CURRENCIES],
      personal: edition === "personal" ? serializePersonalProfile(personalProfile) : null,
      business: edition === "business" ? serializeBusinessProfile(businessProfile) : null,
    });
  } catch (error) {
    return apiError("GET /api/profile", "Failed to load profile", error);
  }
}

const updateSchema = z
  .object({
    fullName: z.string().min(2).max(80).optional(),
    currency: z.enum(SUPPORTED_CURRENCIES).optional(),
    aiProvider: z.enum(["OPENAI", "ANTHROPIC", "GROQ"]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update" });

export async function PATCH(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid profile data", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    await getOrCreateProfile(user);
    const profile = await prisma.profile.update({
      where: { id: user.id },
      data: parsed.data,
    });

    // Currency drives how business data is displayed, so it lives on the
    // workspace. Sync it when the member is allowed to manage settings.
    if (parsed.data.currency) {
      const ctx = await getWorkspaceContext();
      if (ctx && ctx.permissions.has("manage_settings")) {
        await prisma.workspace.update({
          where: { id: ctx.workspace.id },
          data: { currency: parsed.data.currency },
        });
      }
    }

    return NextResponse.json({
      profile: {
        fullName: profile.fullName,
        currency: profile.currency,
        aiProvider: profile.aiProvider,
      },
    });
  } catch (error) {
    return apiError("PATCH /api/profile", "Failed to update profile", error);
  }
}
