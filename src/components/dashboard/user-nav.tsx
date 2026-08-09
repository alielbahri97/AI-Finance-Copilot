"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BugIcon, LogOutIcon, SettingsIcon, UserIcon } from "lucide-react";
import { toast } from "@/lib/toast";

import { ReportIssueButton } from "@/components/report-issue/report-issue-button";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { clearSessionLock } from "@/lib/auth/session-lock";
import { createClient } from "@/lib/supabase/client";
import { getInitials } from "@/lib/utils";

interface UserNavProps {
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

export function UserNav({ email, fullName, avatarUrl }: UserNavProps) {
  const router = useRouter();
  const [reportOpen, setReportOpen] = useState(false);

  async function handleSignOut() {
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Sign out failed", { description: error.message });
      return;
    }
    clearSessionLock();
    toast.success("Signed out");
    router.push("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative size-9 rounded-full" aria-label="User menu">
          <Avatar className="size-9">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={fullName ?? email} /> : null}
            <AvatarFallback>{getInitials(fullName, email)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium">{fullName ?? "Your account"}</p>
            <p className="text-muted-foreground truncate text-xs">{email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href="/profile">
              <UserIcon />
              Profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <SettingsIcon />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setReportOpen(true);
            }}
          >
            <BugIcon />
            Report issue
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
      <ReportIssueButton open={reportOpen} onOpenChange={setReportOpen} showTrigger={false} />
    </DropdownMenu>
  );
}
