import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import { serializeEntitlements } from "@/lib/api/serializers/billing";
import { serializeProfile } from "@/lib/api/serializers/profile";
import { serializeWorkspace, sortedPermissions } from "@/lib/api/serializers/workspace";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getOrCreateProfile } from "@/lib/data";
import { isOnboardingDone } from "@/lib/onboarding/benchmarks";
import { isPersonalOnboardingDone } from "@/lib/onboarding/personal";
import { prisma } from "@/lib/prisma";
import { listUserWorkspaces, requireWorkspace } from "@/lib/workspace/context";
import type { WorkspaceType } from "@/lib/workspace/editions";

export const dynamic = "force-dynamic";

/**
 * Whether the first-run questionnaire is behind the user, for the workspace
 * they are actually in. Business workspaces get industry benchmarks, Personal
 * ones a short goals questionnaire, and both count as done once completed *or*
 * skipped — the same two predicates the dashboard layout redirects on, so a
 * native client sends the user to onboarding exactly when the web app would.
 */
async function isOnboardingComplete(userId: string, type: WorkspaceType): Promise<boolean> {
  if (type === "PERSONAL") {
    const personal = await prisma.personalProfile.findUnique({
      where: { userId },
      select: { completedAt: true, skippedAt: true },
    });
    return isPersonalOnboardingDone(personal);
  }
  const business = await prisma.businessProfile.findUnique({
    where: { userId },
    select: { completedAt: true, skippedAt: true },
  });
  return isOnboardingDone(business);
}

/**
 * Everything a client needs before it can draw anything: who you are, which
 * workspace you are in and what you may do in it, what your plan allows, and
 * whether you still owe the app an onboarding answer.
 *
 * One call rather than five because these are the five things every screen
 * depends on, and a launch that fans out to five round trips shows five
 * spinners. No permission is required: the answer is *what* you have access to.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.ok) return auth.response;
    const { user, workspace, role, memberId, permissions } = auth.ctx;

    // Sequential: the profile row (and, on a first-ever request, the personal
    // workspace) has to exist before the rest is worth asking for.
    const profile = await getOrCreateProfile(user);

    const [workspaces, entitlements, onboardingComplete] = await Promise.all([
      listUserWorkspaces(user.id),
      getEntitlements(workspace.id),
      isOnboardingComplete(user.id, workspace.type),
    ]);

    return NextResponse.json({
      profile: serializeProfile(profile),
      workspaces,
      workspace: serializeWorkspace(workspace),
      membership: { role, memberId, permissions: sortedPermissions(permissions) },
      entitlements: serializeEntitlements(entitlements),
      onboardingComplete,
    });
  } catch (error) {
    return apiError("GET /api/session/bootstrap", "Failed to load the session", error);
  }
}
