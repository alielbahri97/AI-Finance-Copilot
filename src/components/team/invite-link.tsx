"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CopyIcon, Loader2Icon, LogOutIcon, Share2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { BRAND } from "@/lib/branding";
import type { EmailDeliveryResult } from "@/lib/notifications/email";
import type { WorkspaceRoleName } from "@/lib/workspace/permissions";

/**
 * The parts of sharing a workspace that read the same in both editions: the
 * invite link and its delivery report, and leaving a workspace you were
 * invited to. A Business team and a Personal household frame the surrounding
 * page very differently but hand out exactly the same single-use link.
 */

export interface PendingInvitationView {
  id: string;
  email: string;
  role: WorkspaceRoleName;
  expiresAt: string;
}

export interface InviteResult {
  invitation: PendingInvitationView;
  inviteLink: string;
  emailDelivery: EmailDeliveryResult;
}

export async function api(path: string, method: string, body?: unknown) {
  const response = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

/** navigator.share is mobile-only; resolved after mount to keep SSR stable. */
function useCanShare(): boolean {
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);
  return canShare;
}

/**
 * The link is the part that always works, so it leads. Email delivery is
 * reported underneath as a fact, never as an assumption.
 */
export function InviteLinkPanel({ result }: { result: InviteResult }) {
  const canShare = useCanShare();
  const email = result.invitation.email;

  async function share() {
    try {
      await navigator.share({
        title: `Join my ${BRAND.name} workspace`,
        text: `Join my ${BRAND.name} workspace — sign in with ${email}.`,
        url: result.inviteLink,
      });
    } catch {
      // The user dismissed the share sheet; nothing to report.
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Invitation created. Send this link to <span className="font-medium">{email}</span> — they
        will need to sign in with that address.
      </p>
      <div className="flex items-center gap-2">
        <Input readOnly value={result.inviteLink} aria-label="Invitation link" />
        <Button
          aria-label="Copy invitation link"
          onClick={() => {
            void navigator.clipboard.writeText(result.inviteLink);
            toast.success("Link copied");
          }}
        >
          <CopyIcon />
          Copy
        </Button>
        {canShare && (
          <Button
            variant="outline"
            size="icon"
            aria-label="Share invitation link"
            onClick={() => void share()}
          >
            <Share2Icon />
          </Button>
        )}
      </div>
      <EmailDeliveryNote email={email} delivery={result.emailDelivery} />
    </div>
  );
}

function EmailDeliveryNote({ email, delivery }: { email: string; delivery: EmailDeliveryResult }) {
  if (delivery.status === "sent") {
    return <p className="text-muted-foreground text-xs">We also emailed the link to {email}.</p>;
  }

  if (delivery.status === "not_configured") {
    return (
      <div className="text-muted-foreground flex flex-col gap-1 text-xs">
        <p>Email delivery isn&apos;t set up, so use the link above.</p>
        <details>
          <summary className="cursor-pointer">Enable email (admin)</summary>
          <p className="mt-1">
            Set <code className="font-mono">RESEND_API_KEY</code> and{" "}
            <code className="font-mono">EMAIL_FROM</code> on the server, then restart it.
          </p>
        </details>
      </div>
    );
  }

  return (
    <div className="text-muted-foreground flex flex-col gap-1 text-xs">
      {delivery.domainRestricted ? (
        <p>
          Resend only delivers to your own address until you verify a domain — share the link
          instead, or verify a domain in Resend.
        </p>
      ) : (
        <p>The invitation email couldn&apos;t be sent, so share the link above.</p>
      )}
      {delivery.error && (
        <details>
          <summary className="cursor-pointer">Provider response</summary>
          <p className="mt-1 break-words">{delivery.error}</p>
        </details>
      )}
    </div>
  );
}

/** Offered to anyone who is not the owner: the way back out of a workspace. */
export function LeaveWorkspace({ description }: { description: string }) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  async function leave() {
    setIsLoading(true);
    try {
      await api("/api/workspace/leave", "POST");
      toast.success("You left the workspace");
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      toast.error("Couldn't leave the workspace", {
        description: error instanceof Error ? error.message : undefined,
      });
      setIsLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium">Leave workspace</p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <ConfirmDialog
        title="Leave this workspace?"
        description="You will lose access to its data. Your own workspace is unaffected."
        confirmLabel="Leave"
        onConfirm={leave}
        trigger={
          <Button variant="outline" size="sm" disabled={isLoading}>
            {isLoading ? <Loader2Icon className="animate-spin" /> : <LogOutIcon />}
            Leave
          </Button>
        }
      />
    </div>
  );
}
