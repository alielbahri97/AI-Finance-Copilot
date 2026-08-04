"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function AcceptInvitation({
  token,
  workspaceName,
}: {
  token: string;
  workspaceName: string;
}) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  async function accept() {
    setIsLoading(true);
    try {
      const response = await fetch("/api/workspace/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error("Couldn't accept the invitation", { description: data.error });
        return;
      }
      toast.success(`Welcome to ${workspaceName}`);
      router.push("/dashboard");
      router.refresh();
    } catch {
      toast.error("Something went wrong", { description: "Please try again." });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Button onClick={accept} disabled={isLoading}>
      {isLoading ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
      Accept invitation
    </Button>
  );
}
