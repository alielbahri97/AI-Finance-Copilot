import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import {
  assumptionSchema,
  assumptionToggleSchema,
  toAssumptionData,
  validateDateWindow,
} from "@/lib/validations/assumption";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json();

    const existing = await prisma.assumption.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Assumption not found" }, { status: 404 });
    }

    // A body with "kind" is a full edit; otherwise it's an enable/disable toggle.
    if (body && typeof body === "object" && "kind" in body) {
      const parsed = assumptionSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid assumption", issues: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }
      const windowError = validateDateWindow(parsed.data);
      if (windowError) {
        return NextResponse.json({ error: windowError }, { status: 400 });
      }
      const assumption = await prisma.assumption.update({
        where: { id },
        data: toAssumptionData(parsed.data),
      });
      return NextResponse.json({ assumption });
    }

    const toggle = assumptionToggleSchema.safeParse(body);
    if (!toggle.success) {
      return NextResponse.json({ error: "Invalid update" }, { status: 400 });
    }
    const assumption = await prisma.assumption.update({
      where: { id },
      data: { enabled: toggle.data.enabled },
    });
    return NextResponse.json({ assumption });
  } catch (error) {
    return apiError("PATCH /api/assumptions/[id]", "Failed to update assumption", error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const result = await prisma.assumption.deleteMany({ where: { id, userId: user.id } });
    if (result.count === 0) {
      return NextResponse.json({ error: "Assumption not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError("DELETE /api/assumptions/[id]", "Failed to delete assumption", error);
  }
}
