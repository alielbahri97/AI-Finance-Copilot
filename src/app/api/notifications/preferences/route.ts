import { NextResponse } from "next/server";

import { getOrCreateProfile } from "@/lib/data";
import { getOrCreatePreferences, serializePreferences } from "@/lib/notifications/preferences";
import { isEmailConfigured } from "@/lib/notifications/email";
import { isPushConfigured } from "@/lib/notifications/push";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { notificationPreferencesSchema } from "@/lib/validations/notification";
import { apiError } from "@/lib/api/response";

export async function GET() {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await getOrCreateProfile(user);
    const prefs = await getOrCreatePreferences(user.id);

    return NextResponse.json({
      preferences: serializePreferences(prefs),
      channels: { emailConfigured: isEmailConfigured(), pushConfigured: isPushConfigured() },
    });
  } catch (error) {
    return apiError("GET /api/notifications/preferences", "Failed to load preferences", error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = notificationPreferencesSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid preferences", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    await getOrCreateProfile(user);
    await getOrCreatePreferences(user.id);
    const updated = await prisma.notificationPreference.update({
      where: { userId: user.id },
      data: parsed.data,
    });

    return NextResponse.json({ preferences: serializePreferences(updated) });
  } catch (error) {
    return apiError("PATCH /api/notifications/preferences", "Failed to update preferences", error);
  }
}
