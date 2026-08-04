"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CopyIcon,
  Loader2Icon,
  LogOutIcon,
  MailPlusIcon,
  ShieldIcon,
  Trash2Icon,
  UserMinusIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  ALL_PERMISSIONS,
  assignableRoles,
  canManageMember,
  PERMISSION_LABELS,
  ROLE_DEFAULT_PERMISSIONS,
  type Permission,
  type WorkspaceRoleName,
} from "@/lib/workspace/permissions";

export interface TeamMemberView {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  role: WorkspaceRoleName;
  joinedAt: string;
  overrides: Partial<Record<Permission, boolean>>;
}

export interface PendingInvitationView {
  id: string;
  email: string;
  role: WorkspaceRoleName;
  expiresAt: string;
}

interface TeamSettingsProps {
  currentUserId: string;
  actorRole: WorkspaceRoleName;
  canManage: boolean;
  members: TeamMemberView[];
  invitations: PendingInvitationView[];
  seatLimit: number | null;
  planName: string;
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  ADMIN: "Everything, including members and billing",
  MEMBER: "View and edit data, no member or billing management",
  VIEWER: "Read-only access",
};

async function api(path: string, method: string, body?: unknown) {
  const response = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export function TeamSettings({
  currentUserId,
  actorRole,
  canManage,
  members,
  invitations,
  seatLimit,
  planName,
}: TeamSettingsProps) {
  const router = useRouter();
  const seatsUsed = members.length + invitations.length;
  const roleOptions = assignableRoles(actorRole);
  const isOwner = actorRole === "OWNER";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {seatsUsed} of {seatLimit ?? "unlimited"} seat{seatLimit === 1 ? "" : "s"} used on the{" "}
          {planName} plan
          {seatLimit !== null && seatsUsed >= seatLimit ? " — upgrade for more seats" : ""}.
        </p>
        {canManage && (
          <InviteDialog
            roleOptions={roleOptions}
            seatFull={seatLimit !== null && seatsUsed >= seatLimit}
            onDone={() => router.refresh()}
          />
        )}
      </div>

      <ul className="flex flex-col divide-y rounded-lg border">
        {members.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            isSelf={member.userId === currentUserId}
            manageable={canManage && canManageMember(actorRole, member.role)}
            roleOptions={roleOptions}
            onChanged={() => router.refresh()}
          />
        ))}
      </ul>

      {canManage && invitations.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Pending invitations</h3>
          <ul className="flex flex-col divide-y rounded-lg border">
            {invitations.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                onChanged={() => router.refresh()}
              />
            ))}
          </ul>
        </div>
      )}

      {!isOwner && (
        <>
          <Separator />
          <LeaveWorkspace />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Invite dialog                                                       */
/* ------------------------------------------------------------------ */

function InviteDialog({
  roleOptions,
  seatFull,
  onDone,
}: {
  roleOptions: WorkspaceRoleName[];
  seatFull: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRoleName>("MEMBER");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<{ inviteLink: string; emailSent: boolean } | null>(null);

  async function invite() {
    setIsLoading(true);
    try {
      const data = await api("/api/workspace/invitations", "POST", { email, role });
      setResult({ inviteLink: data.inviteLink, emailSent: data.emailSent });
      toast.success(
        data.emailSent ? `Invitation emailed to ${email}` : "Invitation created",
        data.emailSent ? undefined : { description: "Share the invite link manually." }
      );
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
      setRole("MEMBER");
      setResult(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={seatFull} title={seatFull ? "All seats are in use" : undefined}>
          <MailPlusIcon />
          Invite member
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>
            They get their own login; you control what they can see and do. Invitations expire
            after 7 days.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {result.emailSent
                ? "The invitation email is on its way. You can also share the link directly:"
                : "Email sending isn't configured — share this link with them instead:"}
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={result.inviteLink} aria-label="Invitation link" />
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy invitation link"
                onClick={() => {
                  navigator.clipboard.writeText(result.inviteLink);
                  toast.success("Link copied");
                }}
              >
                <CopyIcon />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="partner@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={role} onValueChange={(value) => setRole(value as WorkspaceRoleName)}>
                <SelectTrigger id="invite-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      <span className="font-medium">{option.charAt(0) + option.slice(1).toLowerCase()}</span>
                      <span className="text-muted-foreground"> — {ROLE_DESCRIPTIONS[option]}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
/* Member row: role select, permission overrides, remove               */
/* ------------------------------------------------------------------ */

function MemberRow({
  member,
  isSelf,
  manageable,
  roleOptions,
  onChanged,
}: {
  member: TeamMemberView;
  isSelf: boolean;
  manageable: boolean;
  roleOptions: WorkspaceRoleName[];
  onChanged: () => void;
}) {
  const [isBusy, setIsBusy] = useState(false);

  async function changeRole(role: string) {
    setIsBusy(true);
    try {
      await api(`/api/workspace/members/${member.id}`, "PATCH", { role });
      toast.success(`${member.email} is now ${role.toLowerCase()}`);
      onChanged();
    } catch (error) {
      toast.error("Couldn't change the role", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove ${member.email} from this workspace?`)) return;
    setIsBusy(true);
    try {
      await api(`/api/workspace/members/${member.id}`, "DELETE");
      toast.success(`${member.email} removed`);
      onChanged();
    } catch (error) {
      toast.error("Couldn't remove the member", {
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
      {manageable && !isSelf ? (
        <div className="flex items-center gap-1.5">
          <Select value={member.role} onValueChange={changeRole} disabled={isBusy}>
            <SelectTrigger className="h-8 w-28" aria-label={`Role of ${member.email}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roleOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option.charAt(0) + option.slice(1).toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <PermissionsDialog member={member} onChanged={onChanged} />
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive size-8"
            onClick={remove}
            disabled={isBusy}
            aria-label={`Remove ${member.email}`}
          >
            <UserMinusIcon />
          </Button>
        </div>
      ) : (
        <Badge variant={member.role === "OWNER" ? "default" : "secondary"}>
          {member.role.charAt(0) + member.role.slice(1).toLowerCase()}
        </Badge>
      )}
    </li>
  );
}

function PermissionsDialog({
  member,
  onChanged,
}: {
  member: TeamMemberView;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides] = useState(member.overrides);
  const [isSaving, setIsSaving] = useState(false);
  const defaults = new Set(ROLE_DEFAULT_PERMISSIONS[member.role]);

  function effective(permission: Permission): boolean {
    return overrides[permission] ?? defaults.has(permission);
  }

  function toggle(permission: Permission, value: boolean) {
    setOverrides((current) => {
      const next = { ...current };
      // Only keep overrides that differ from the role default.
      if (value === defaults.has(permission)) delete next[permission];
      else next[permission] = value;
      return next;
    });
  }

  async function save() {
    setIsSaving(true);
    try {
      await api(`/api/workspace/members/${member.id}`, "PATCH", { permissions: overrides });
      toast.success(`Permissions updated for ${member.email}`);
      setOpen(false);
      onChanged();
    } catch (error) {
      toast.error("Couldn't save permissions", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setOverrides(member.overrides);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Permissions of ${member.email}`}
        >
          <ShieldIcon />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Permissions — {member.name ?? member.email}</DialogTitle>
          <DialogDescription>
            Fine-tune what this {member.role.toLowerCase()} can access. Toggles start from the
            role defaults.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-80 flex-col gap-3 overflow-y-auto py-1 pr-1">
          {ALL_PERMISSIONS.map((permission) => (
            <div key={permission} className="flex items-center justify-between gap-3">
              <Label htmlFor={`perm-${member.id}-${permission}`} className="text-sm font-normal">
                {PERMISSION_LABELS[permission]}
                {overrides[permission] !== undefined && (
                  <span className="text-muted-foreground ml-1 text-xs">(override)</span>
                )}
              </Label>
              <Switch
                id={`perm-${member.id}-${permission}`}
                checked={effective(permission)}
                onCheckedChange={(value) => toggle(permission, value)}
              />
            </div>
          ))}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOverrides({})} disabled={isSaving}>
            Reset to role defaults
          </Button>
          <Button onClick={save} disabled={isSaving}>
            {isSaving && <Loader2Icon className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Pending invitations                                                 */
/* ------------------------------------------------------------------ */

function InvitationRow({
  invitation,
  onChanged,
}: {
  invitation: PendingInvitationView;
  onChanged: () => void;
}) {
  const [isBusy, setIsBusy] = useState(false);
  const daysLeft = Math.max(
    0,
    Math.ceil((new Date(invitation.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  );

  async function revoke() {
    setIsBusy(true);
    try {
      await api(`/api/workspace/invitations/${invitation.id}`, "DELETE");
      toast.success(`Invitation for ${invitation.email} revoked`);
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
    <li className="flex items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{invitation.email}</p>
        <p className="text-muted-foreground text-xs">
          {invitation.role.charAt(0) + invitation.role.slice(1).toLowerCase()} · expires in{" "}
          {daysLeft} day{daysLeft === 1 ? "" : "s"}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="text-destructive size-8"
        onClick={revoke}
        disabled={isBusy}
        aria-label={`Revoke invitation for ${invitation.email}`}
      >
        <Trash2Icon />
      </Button>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Leave workspace                                                     */
/* ------------------------------------------------------------------ */

function LeaveWorkspace() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  async function leave() {
    if (!window.confirm("Leave this workspace? You will lose access to its data.")) return;
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
        <p className="text-muted-foreground text-xs">
          You will lose access to this workspace&apos;s data. Your own workspace is unaffected.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={leave} disabled={isLoading}>
        {isLoading ? <Loader2Icon className="animate-spin" /> : <LogOutIcon />}
        Leave
      </Button>
    </div>
  );
}
