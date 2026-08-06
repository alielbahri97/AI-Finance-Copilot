import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import { getUser } from "@/lib/supabase/server";
import { getWorkspaceCreationPolicy } from "@/lib/workspace/limits";

/** Lets the create-workspace dialog disable invalid edition choices. */
export async function GET() {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const policy = await getWorkspaceCreationPolicy(user.id);
    return NextResponse.json({ policy });
  } catch (error) {
    return apiError("GET /api/workspace/creation-policy", "Could not load creation policy", error);
  }
}
