"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function WorkspaceNameForm({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [isLoading, setIsLoading] = useState(false);

  async function save() {
    setIsLoading(true);
    try {
      const response = await fetch("/api/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error("Couldn't rename the workspace", { description: data.error });
        return;
      }
      toast.success("Workspace renamed");
      router.refresh();
    } catch {
      toast.error("Something went wrong", { description: "Please try again." });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex max-w-md items-end gap-2">
      <div className="grid flex-1 gap-2">
        <Label htmlFor="workspace-name">Workspace name</Label>
        <Input
          id="workspace-name"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <Button
        onClick={save}
        disabled={isLoading || name.trim().length === 0 || name.trim() === defaultName}
      >
        {isLoading && <Loader2Icon className="animate-spin" />}
        Save
      </Button>
    </div>
  );
}
