"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Building2Icon,
  CheckIcon,
  ChevronsUpDownIcon,
  Loader2Icon,
  PlusIcon,
  UserIcon,
} from "lucide-react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EDITIONS } from "@/lib/branding";
import { editionForWorkspaceType, type WorkspaceType } from "@/lib/workspace/editions";
import { cn } from "@/lib/utils";

export interface WorkspaceOption {
  id: string;
  name: string;
  type: WorkspaceType;
  role: string;
}

const TYPE_ICONS: Record<WorkspaceType, typeof Building2Icon> = {
  BUSINESS: Building2Icon,
  PERSONAL: UserIcon,
};

function editionLabel(type: WorkspaceType): string {
  return EDITIONS[editionForWorkspaceType(type)].name;
}

export function WorkspaceSwitcher({
  workspaces,
  currentId,
}: {
  workspaces: WorkspaceOption[];
  currentId: string;
}) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const current = workspaces.find((workspace) => workspace.id === currentId);
  const CurrentIcon = TYPE_ICONS[current?.type ?? "BUSINESS"];

  async function switchTo(workspaceId: string) {
    if (workspaceId === currentId) return;
    setIsLoading(true);
    try {
      const response = await fetch("/api/workspace/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error("Couldn't switch workspace", { description: data.error });
        return;
      }
      toast.success(`Switched to ${data.workspace.name}`);
      router.push("/dashboard");
      router.refresh();
    } catch {
      toast.error("Something went wrong", { description: "Please try again." });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="max-w-56 gap-2" disabled={isLoading}>
            {isLoading ? (
              <Loader2Icon className="size-4 animate-spin" aria-hidden />
            ) : (
              <CurrentIcon className="size-4" aria-hidden />
            )}
            <span className="truncate">{current?.name ?? "Workspace"}</span>
            <ChevronsUpDownIcon className="text-muted-foreground size-3.5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Your workspaces</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {workspaces.map((workspace) => {
            const Icon = TYPE_ICONS[workspace.type];
            return (
              <DropdownMenuItem
                key={workspace.id}
                onClick={() => switchTo(workspace.id)}
                className="gap-2"
              >
                <CheckIcon
                  className={cn(
                    "size-4",
                    workspace.id === currentId ? "opacity-100" : "opacity-0"
                  )}
                  aria-hidden
                />
                <Icon className="text-muted-foreground size-4" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  {workspace.name}
                  <span className="text-muted-foreground block text-xs">
                    {editionLabel(workspace.type)}
                  </span>
                </span>
                <span className="text-muted-foreground text-xs">
                  {workspace.role.charAt(0) + workspace.role.slice(1).toLowerCase()}
                </span>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateOpen(true)} className="gap-2">
            <PlusIcon className="size-4" aria-hidden />
            Create workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

/**
 * Creating a workspace is where the edition is chosen for the second time in a
 * user's life (the first was at signup), so it asks the same question in the
 * same words the landing page used.
 */
function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [type, setType] = useState<WorkspaceType>("BUSINESS");
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [policy, setPolicy] = useState<{
    canCreatePersonal: boolean;
    canCreateBusiness: boolean;
    personalBlockedReason: string | null;
    businessBlockedReason: string | null;
    crossEditionUnlocked: boolean;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/workspace/creation-policy");
        const data = await response.json().catch(() => null);
        if (!cancelled && response.ok && data?.policy) {
          setPolicy(data.policy);
          if (data.policy.canCreateBusiness) setType("BUSINESS");
          else if (data.policy.canCreatePersonal) setType("PERSONAL");
        }
      } catch {
        /* keep dialog usable; API still enforces */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const typeBlocked =
    type === "PERSONAL" ? policy?.personalBlockedReason : policy?.businessBlockedReason;
  const canSubmit =
    type === "PERSONAL"
      ? policy?.canCreatePersonal !== false
      : policy?.canCreateBusiness !== false;

  async function create() {
    setIsSaving(true);
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, ...(name.trim() ? { name: name.trim() } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error("Couldn't create the workspace", { description: data.error });
        return;
      }
      toast.success(`${data.workspace.name} is ready`);
      onOpenChange(false);
      setName("");
      router.push("/dashboard");
      router.refresh();
    } catch {
      toast.error("Something went wrong", { description: "Please try again." });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a workspace</DialogTitle>
          <DialogDescription>
            Company and individual money stay on separate editions unless you are on Enterprise or
            Premium. You can own only one Personal workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {(["BUSINESS", "PERSONAL"] as const).map((option) => {
              const branding = EDITIONS[editionForWorkspaceType(option)];
              const Icon = TYPE_ICONS[option];
              const isSelected = type === option;
              const blocked =
                option === "PERSONAL"
                  ? policy?.personalBlockedReason
                  : policy?.businessBlockedReason;
              const disabled = Boolean(blocked);
              return (
                <button
                  key={option}
                  type="button"
                  disabled={disabled}
                  onClick={() => setType(option)}
                  aria-pressed={isSelected}
                  title={blocked ?? undefined}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
                    disabled && "cursor-not-allowed opacity-50",
                    isSelected
                      ? "border-primary bg-accent/50"
                      : "hover:bg-accent/40 border-input"
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Icon className={cn("size-4", branding.accentClassName)} aria-hidden />
                    {branding.choiceLabel}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {blocked ?? branding.choiceDescription}
                  </span>
                </button>
              );
            })}
          </div>

          {typeBlocked ? (
            <p className="text-muted-foreground text-xs">{typeBlocked}</p>
          ) : null}

          {!policy?.crossEditionUnlocked ? (
            <p className="text-muted-foreground text-xs">
              Need both? Upgrade to Enterprise (Business) or Premium (Personal).
            </p>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="workspace-name">Name (optional)</Label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={type === "PERSONAL" ? "Personal" : "Acme BV"}
              maxLength={80}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={() => void create()} disabled={isSaving || !canSubmit}>
            {isSaving && <Loader2Icon className="size-4 animate-spin" />}
            Create workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
