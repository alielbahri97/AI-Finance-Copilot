"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2Icon, CheckIcon, ChevronsUpDownIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface WorkspaceOption {
  id: string;
  name: string;
  role: string;
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
  const current = workspaces.find((workspace) => workspace.id === currentId);

  // Only one workspace: show the name without switcher chrome.
  if (workspaces.length <= 1) {
    return (
      <div className="text-muted-foreground hidden items-center gap-2 text-sm font-medium sm:flex">
        <Building2Icon className="size-4" aria-hidden />
        <span className="max-w-40 truncate">{current?.name ?? "Workspace"}</span>
      </div>
    );
  }

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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-56 gap-2" disabled={isLoading}>
          {isLoading ? (
            <Loader2Icon className="size-4 animate-spin" aria-hidden />
          ) : (
            <Building2Icon className="size-4" aria-hidden />
          )}
          <span className="truncate">{current?.name ?? "Workspace"}</span>
          <ChevronsUpDownIcon className="text-muted-foreground size-3.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.id}
            onClick={() => switchTo(workspace.id)}
            className="gap-2"
          >
            <CheckIcon
              className={cn("size-4", workspace.id === currentId ? "opacity-100" : "opacity-0")}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
            <span className="text-muted-foreground text-xs">
              {workspace.role.charAt(0) + workspace.role.slice(1).toLowerCase()}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
