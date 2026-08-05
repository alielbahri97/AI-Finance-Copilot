"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  LinkIcon,
  Loader2Icon,
  LockIcon,
  MailPlusIcon,
  Trash2Icon,
  UserMinusIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  api,
  InviteLinkPanel,
  LeaveWorkspace,
  type InviteResult,
  type PendingInvitationView,
} from "@/components/team/invite-link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { EditionSharingCopy } from "@/lib/branding";
import type { WorkspaceRoleName } from "@/lib/workspace/permissions";

/**
 * Everyone in the workspace, as a household renders them: no role to show and
 * no overrides to edit, so this is deliberately narrower than the team view the
 * same page hands to Business.
 */
export interface HouseholdPersonView {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  role: WorkspaceRoleName;
}

/**
 * Sharing a workspace, shrunk to a couple.
 *
 * Everything underneath is the Business team machinery — the same members, the
 * same hashed single-use invitations, the same seat limit — with the two things
 * a household has no use for taken away: there is no role to pick (the partner
 * joins as an equal, decided server-side) and no per-permission overrides. The
 * plan stays with the owner, which the edition matrix enforces rather than this
 * component. Every edition-specific word arrives in `copy`.
 */
interface HouseholdSettingsProps {
  currentUserId: string;
  isOwner: boolean;
  canManage: boolean;
  members: HouseholdPersonView[];
  invitations: PendingInvitationView[];
  seatLimit: number | null;
  planName: string;
  /** Cheapest plan in this edition with room for a second person, if any. */
  upgradePlanName: string | null;
  copy: EditionSharingCopy;
}

export function HouseholdSettings({
  currentUserId,
  isOwner,
  canManage,
  members,
  invitations,
  seatLimit,
  planName,
  upgradePlanName,
  copy,
}: HouseholdSettingsProps) {
  const router = useRouter();
  const seatsUsed = members.length + invitations.length;
  const sharingUnlocked = seatLimit === null || seatLimit > 1;
  const others = members.filter((member) => member.userId !== currentUserId);
  const alone = others.length === 0 && invitations.length === 0;

  // A plan that no longer has room, with someone already in: downgrading is a
  // Stripe-side action this app never sees, so the honest thing is to keep
  // everyone's access and say plainly what it costs to invite again.
  if (!sharingUnlocked && alone) {
    return <LockedTeaser planName={planName} upgradePlanName={upgradePlanName} copy={copy} />;
  }

  const overLimit = seatLimit !== null && seatsUsed > seatLimit;
  const seatFull = seatLimit !== null && seatsUsed >= seatLimit;

  return (
    <div className="flex flex-col gap-5">
      {overLimit && (
        <Alert>
          <LockIcon className="size-4" />
          <AlertTitle>Your {planName} plan is smaller than your household</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span>
              {others.map((member) => member.name ?? member.email).join(", ")} keeps full access
              and nothing has been lost. To invite anyone else, move back to{" "}
              {upgradePlanName ?? "a larger plan"} or remove them below.
            </span>
            {isOwner && (
              <Button asChild size="sm">
                <Link href="/billing">See plans</Link>
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {seatsUsed} of {seatLimit ?? "unlimited"} {seatsUsed === 1 ? "person" : "people"} on the{" "}
          {planName} plan.
        </p>
        {canManage && (
          <InvitePartnerDialog
            copy={copy}
            seatFull={seatFull}
            onDone={() => router.refresh()}
          />
        )}
      </div>

      {alone ? (
        <EmptyState
          className="py-8"
          icon={UsersIcon}
          title={copy.emptyTitle}
          description={copy.emptyDescription}
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {members.map((member) => (
            <PersonRow
              key={member.id}
              member={member}
              isSelf={member.userId === currentUserId}
              removable={canManage && member.role !== "OWNER"}
              copy={copy}
              onChanged={() => router.refresh()}
            />
          ))}
        </ul>
      )}

      {canManage && invitations.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border">
          {invitations.map((invitation) => (
            <PendingInviteRow
              key={invitation.id}
              invitation={invitation}
              onChanged={() => router.refresh()}
            />
          ))}
        </ul>
      )}

      {!isOwner && (
        <>
          <Separator />
          <LeaveWorkspace description="You keep your own workspace; you just stop seeing this one." />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Locked teaser                                                       */
/* ------------------------------------------------------------------ */

function LockedTeaser({
  planName,
  upgradePlanName,
  copy,
}: {
  planName: string;
  upgradePlanName: string | null;
  copy: EditionSharingCopy;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <LockIcon className="size-4" />
        <AlertTitle>
          {copy.lockedSubject} is part of {upgradePlanName ?? "the paid plans"}
        </AlertTitle>
        <AlertDescription className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span>
            Your current plan is {planName}. Everything else you have keeps working exactly as it
            does now.
          </span>
          <Button asChild size="sm">
            <Link href="/billing">Upgrade plan</Link>
          </Button>
        </AlertDescription>
      </Alert>
      <ul className="text-muted-foreground list-disc space-y-1.5 pl-5 text-sm">
        {copy.lockedHighlights.map((highlight) => (
          <li key={highlight}>{highlight}</li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Invite: email in, link out — no role picker                         */
/* ------------------------------------------------------------------ */

function InvitePartnerDialog({
  copy,
  seatFull,
  onDone,
}: {
  copy: EditionSharingCopy;
  seatFull: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<InviteResult | null>(null);

  async function invite() {
    setIsLoading(true);
    try {
      // No role: the server assigns the household's own, so the picker and the
      // permission overrides simply do not exist here.
      const data = (await api("/api/workspace/invitations", "POST", { email })) as InviteResult;
      setResult(data);
      toast.success("Invitation created", {
        description:
          data.emailDelivery.status === "sent"
            ? `Emailed to ${email}. The link is in the dialog too.`
            : "Copy the link in the dialog and send it to them.",
      });
      onDone();
    } catch (error) {
      toast.error("Couldn't send the invitation", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsLoading(false);
    }
  }

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setEmail("");
      setResult(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          disabled={seatFull}
          title={seatFull ? "Your plan has no room for another person" : undefined}
        >
          <MailPlusIcon />
          {copy.inviteAction}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.inviteAction}</DialogTitle>
          <DialogDescription>{copy.inviteDescription}</DialogDescription>
        </DialogHeader>
        {result ? (
          <InviteLinkPanel result={result} />
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="household-invite-email">Email</Label>
            <Input
              id="household-invite-email"
              type="email"
              placeholder="partner@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
        )}
        <DialogFooter>
          {result ? (
            <Button variant="outline" onClick={() => reset(false)}>
              Done
            </Button>
          ) : (
            <Button onClick={invite} disabled={isLoading || email.trim().length === 0}>
              {isLoading && <Loader2Icon className="animate-spin" />}
              Send invitation
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

function PersonRow({
  member,
  isSelf,
  removable,
  copy,
  onChanged,
}: {
  member: HouseholdPersonView;
  isSelf: boolean;
  removable: boolean;
  copy: EditionSharingCopy;
  onChanged: () => void;
}) {
  const [isBusy, setIsBusy] = useState(false);

  async function remove() {
    setIsBusy(true);
    try {
      await api(`/api/workspace/members/${member.id}`, "DELETE");
      toast.success(`${member.email} removed`);
      onChanged();
    } catch (error) {
      toast.error(`Couldn't remove your ${copy.personLabel}`, {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {member.name ?? member.email}
          {isSelf && <span className="text-muted-foreground font-normal"> (you)</span>}
        </p>
        <p className="text-muted-foreground truncate text-xs">{member.email}</p>
      </div>
      {removable && !isSelf && (
        <ConfirmDialog
          title={`Remove ${member.name ?? member.email}?`}
          description={`They lose access to these accounts, transactions and budgets straight away. Nothing either of you entered is deleted.`}
          confirmLabel="Remove"
          onConfirm={remove}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive size-8"
              disabled={isBusy}
              aria-label={`Remove ${member.email}`}
            >
              <UserMinusIcon />
            </Button>
          }
        />
      )}
    </li>
  );
}

function PendingInviteRow({
  invitation,
  onChanged,
}: {
  invitation: PendingInvitationView;
  onChanged: () => void;
}) {
  const [isBusy, setIsBusy] = useState(false);
  const [link, setLink] = useState<InviteResult | null>(null);
  // Regenerating replaces the row server-side; tracking the live invitation
  // here keeps the freshly issued link on screen instead of refreshing it away.
  const [current, setCurrent] = useState(invitation);
  const daysLeft = Math.max(
    0,
    Math.ceil((new Date(current.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  );

  async function regenerate() {
    setIsBusy(true);
    try {
      const data = (await api(
        `/api/workspace/invitations/${current.id}/regenerate`,
        "POST"
      )) as InviteResult;
      setCurrent(data.invitation);
      setLink(data);
    } catch (error) {
      toast.error("Couldn't create a new link", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function revoke() {
    setIsBusy(true);
    try {
      await api(`/api/workspace/invitations/${current.id}`, "DELETE");
      toast.success(`Invitation for ${current.email} revoked`);
      onChanged();
    } catch (error) {
      toast.error("Couldn't revoke the invitation", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{current.email}</p>
          <p className="text-muted-foreground text-xs">
            Invited · expires in {daysLeft} day{daysLeft === 1 ? "" : "s"}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void regenerate()}
          disabled={isBusy}
          title="Issues a new link and invalidates the previous one"
        >
          {isBusy ? <Loader2Icon className="animate-spin" /> : <LinkIcon />}
          Get link
        </Button>
        <ConfirmDialog
          title="Revoke this invitation?"
          description={`The link sent to ${current.email} stops working. You can invite them again afterwards.`}
          confirmLabel="Revoke"
          onConfirm={revoke}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive size-8"
              disabled={isBusy}
              aria-label={`Revoke invitation for ${current.email}`}
            >
              <Trash2Icon />
            </Button>
          }
        />
      </div>
      {link && (
        <div className="bg-muted/40 flex flex-col gap-2 rounded-md border p-3">
          <p className="text-muted-foreground text-xs">
            The original link was stored hashed and can&apos;t be shown again, so this is a fresh
            one — the previous link no longer works.
          </p>
          <InviteLinkPanel result={link} />
        </div>
      )}
    </li>
  );
}
