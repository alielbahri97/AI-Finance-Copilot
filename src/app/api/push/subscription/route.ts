import { NextResponse } from "next/server";

import { getOrCreateProfile } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { pushSubscriptionSchema, pushUnsubscribeSchema } from "@/lib/validations/notification";

/** Registers (or refreshes) this browser's push subscription. */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = pushSubscriptionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }

    await getOrCreateProfile(user);
    await prisma.pushSubscription.upsert({
      where: { endpoint: parsed.data.endpoint },
      update: {
        userId: user.id,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
      },
      create: {
        userId: user.id,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
      },
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("POST /api/push/subscription failed:", error);
    return NextResponse.json({ error: "Failed to save subscription" }, { status: 500 });
  }
}

/** Removes this browser's push subscription. */
export async function DELETE(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = pushUnsubscribeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    await prisma.pushSubscription.deleteMany({
      where: { userId: user.id, endpoint: parsed.data.endpoint },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/push/subscription failed:", error);
    return NextResponse.json({ error: "Failed to remove subscription" }, { status: 500 });
  }
}
