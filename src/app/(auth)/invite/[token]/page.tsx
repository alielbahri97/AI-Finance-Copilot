import type { Metadata } from "next";
import Link from "next/link";
import { MailQuestionIcon, UsersIcon } from "lucide-react";

import { AcceptInvitation } from "@/components/team/accept-invitation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { classifyDatabaseFailure, describeDatabaseError } from "@/lib/db-errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { assessInvitation, hashInviteToken } from "@/lib/workspace/invitations";

export const metadata: Metadata = {
  title: "Workspace invitation",
  description: "Join a shared FinPilot workspace.",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const INVALID_MESSAGES: Record<string, { title: string; body: string }> = {
  accepted: {
    title: "Invitation already used",
    body: "This invitation has already been accepted. If that was you, just sign in.",
  },
  revoked: {
    title: "Invitation revoked",
    body: "This invitation was revoked by the workspace. Ask them to send a new one.",
  },
  expired: {
    title: "Invitation expired",
    body: "Invitations are valid for 7 days. Ask the workspace to send a new one.",
  },
};

type InvitationRow = Awaited<ReturnType<typeof findInvitation>>;

function findInvitation(token: string) {
  return prisma.workspaceInvitation.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      workspace: { select: { name: true } },
      invitedBy: { select: { fullName: true, email: true } },
    },
  });
}

/**
 * This is a public page, so a database problem must not turn into a 500 on an
 * unauthenticated route. "unavailable" is distinct from "not found": we cannot
 * tell whether the invitation is valid, so nothing is offered — fail closed.
 */
async function loadInvitation(
  token: string
): Promise<{ ok: true; invitation: InvitationRow } | { ok: false }> {
  try {
    return { ok: true, invitation: await findInvitation(token) };
  } catch (error) {
    logger.error("invite_lookup_failed", {
      failure: classifyDatabaseFailure(error) ?? "unknown",
      error: describeDatabaseError(error),
    });
    return { ok: false };
  }
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [user, lookup] = await Promise.all([
    // An unresolvable session just means "not signed in yet" here.
    getUser().catch(() => null),
    loadInvitation(token),
  ]);

  if (!lookup.ok) {
    return (
      <Card>
        <CardHeader className="text-center">
          <MailQuestionIcon className="text-muted-foreground mx-auto size-8" aria-hidden />
          <CardTitle className="text-xl">We can&apos;t check this invitation</CardTitle>
          <CardDescription>
            FinPilot is having trouble reading its database, so we can&apos;t confirm whether
            this invitation is still valid. Your link is not used up — try again in a few
            minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button asChild variant="outline">
            <Link href="/">Back to FinPilot</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const invitation = lookup.invitation;

  if (!invitation) {
    return (
      <Card>
        <CardHeader className="text-center">
          <MailQuestionIcon className="text-muted-foreground mx-auto size-8" aria-hidden />
          <CardTitle className="text-xl">Invitation not found</CardTitle>
          <CardDescription>
            This invitation link is invalid. Check that you copied the full link, or ask for a new
            invitation.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button asChild variant="outline">
            <Link href="/">Back to FinPilot</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const inviterName = invitation.invitedBy.fullName ?? invitation.invitedBy.email;
  const invitePath = `/invite/${token}`;

  // Assess validity (skip the email check until we know who is logged in).
  const assessment = assessInvitation(invitation, user?.email ?? invitation.email);
  if (!assessment.valid && assessment.reason !== "email_mismatch") {
    const message = INVALID_MESSAGES[assessment.reason];
    return (
      <Card>
        <CardHeader className="text-center">
          <MailQuestionIcon className="text-muted-foreground mx-auto size-8" aria-hidden />
          <CardTitle className="text-xl">{message.title}</CardTitle>
          <CardDescription>{message.body}</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button asChild variant="outline">
            <Link href="/">Back to FinPilot</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <UsersIcon className="text-muted-foreground mx-auto size-8" aria-hidden />
        <CardTitle className="text-xl">
          Join {invitation.workspace.name}
        </CardTitle>
        <CardDescription>
          {inviterName} invited <strong>{invitation.email}</strong> to join the{" "}
          <strong>{invitation.workspace.name}</strong> workspace as{" "}
          {invitation.role.toLowerCase()}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!user ? (
          <>
            <p className="text-muted-foreground text-center text-sm">
              Sign in or create an account with <strong>{invitation.email}</strong> to accept.
            </p>
            <Button asChild>
              <Link href={`/login?next=${encodeURIComponent(invitePath)}`}>Sign in</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/signup?next=${encodeURIComponent(invitePath)}`}>Create an account</Link>
            </Button>
          </>
        ) : user.email?.toLowerCase() !== invitation.email.toLowerCase() ? (
          <Alert>
            <AlertTitle>Signed in with a different email</AlertTitle>
            <AlertDescription>
              You are signed in as {user.email}, but this invitation was sent to{" "}
              {invitation.email}. Sign out and use the invited account to accept.
            </AlertDescription>
          </Alert>
        ) : (
          <AcceptInvitation token={token} workspaceName={invitation.workspace.name} />
        )}
      </CardContent>
    </Card>
  );
}
