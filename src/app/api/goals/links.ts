import "server-only";

import { NextResponse } from "next/server";

import {
  bankAccountBelongsToWorkspace,
  categoryBelongsToWorkspace,
} from "@/lib/personal/goals-data";

/**
 * Checks the optional category and bank-account links a goal can carry against
 * the current workspace. Returns the 400 to send back, or null when both are
 * either absent or ours — an id from a client is otherwise a way to read across
 * workspace boundaries by linking to a row you cannot see.
 */
export async function verifyGoalLinks(
  workspaceId: string,
  links: { categoryId?: string | null; bankAccountId?: string | null }
): Promise<NextResponse | null> {
  if (links.categoryId && !(await categoryBelongsToWorkspace(workspaceId, links.categoryId))) {
    return NextResponse.json({ error: "Unknown category" }, { status: 400 });
  }
  if (
    links.bankAccountId &&
    !(await bankAccountBelongsToWorkspace(workspaceId, links.bankAccountId))
  ) {
    return NextResponse.json({ error: "Unknown account" }, { status: 400 });
  }
  return null;
}
