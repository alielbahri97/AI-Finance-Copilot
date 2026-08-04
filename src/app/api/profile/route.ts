import { NextResponse } from "next/server";
import { z } from "zod";

import { getOrCreateProfile } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { SUPPORTED_CURRENCIES } from "@/lib/validations/profile";
import { apiError } from "@/lib/api/response";
import { getWorkspaceContext } from "@/lib/workspace/context";

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
